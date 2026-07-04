import { Capacitor } from '@capacitor/core';

/**
 * Web counterpart of the native adjustResize keyboard model (#219).
 *
 * Mobile browsers overlay the soft keyboard and pan the visual
 * viewport to reveal the caret, which visibly slides the whole page.
 * iOS Safari also restores that pan without firing any resize or
 * scroll event, so event-driven tracking always ends up stale.
 *
 * This manager pins the page instead: while an input is focused or
 * the keyboard is up, an animation-frame poll counter-translates
 * #root by visualViewport.pageTop, so content stays visually static
 * no matter how the browser pans. It also mirrors the native
 * keyboard signals from main.tsx on web: the `keyboard-visible`
 * class and `--keyboard-height` var on <html>.
 */

/** Viewport shrink (px) below which we do not call it a keyboard. */
const KEYBOARD_MIN_PX = 150;
/** Idle frames (~1.5s) before the poll loop goes back to sleep. */
const SLEEP_AFTER_IDLE_FRAMES = 90;
/**
 * Frames (~300ms) the keyboard must stay gone before the class drops.
 * Moving focus between two fields fires a transient hide/show pair;
 * dropping the class mid-switch flaps hide-on-keyboard rows and the
 * card skirt on every switch.
 */
const KEYBOARD_OFF_FRAMES = 18;

const EDITABLE_SELECTOR = 'input, textarea, [contenteditable="true"]';

/**
 * iOS home-screen web apps and native iOS apps lay the page out in
 * a viewport that stops above the home-indicator strip: 100dvh, the
 * containing block, and #root all end there, and the strip below is
 * painted by the canvas background alone; no content can render in
 * it. Meanwhile the bottom bar still pads itself by
 * env(safe-area-inset-bottom) INSIDE that short viewport, so the
 * wallet footer showed a void-colored OS strip below the bar plus the
 * bar's own duplicate inset padding above it.
 *
 * When a bottom gap is measurable, hand the clearance job to the OS
 * strip: zero --safe-area-inset-bottom (every safe-area consumer
 * reads the var first and falls back to env) and mark <html> so
 * index.css paints the canvas in the bottom-bar glass composite. On
 * iOS versions whose viewport reaches the physical bottom the gap
 * measures 0 and nothing activates.
 */
const IOS_STANDALONE_GAP_MAX_PX = 80;

function applyIosStandaloneBottomGap(): void {
  const html = document.documentElement;
  const portrait = window.matchMedia('(orientation: portrait)').matches;
  const gap = Math.round(window.screen.height - html.clientHeight);
  const active = portrait && gap > 0 && gap <= IOS_STANDALONE_GAP_MAX_PX;
  html.classList.toggle('ios-standalone-bottom-gap', active);
  if (active) {
    html.style.setProperty('--safe-area-inset-bottom', '0px');
  } else {
    html.style.removeProperty('--safe-area-inset-bottom');
  }
}

let rafId: number | null = null;
let idleFrames = 0;
let appliedPageTop = 0;
let keyboardVisible = false;
let appliedKeyboardPx = 0;
let keyboardOffFrames = 0;

/**
 * One measure-and-apply step. Returns true while there is keyboard or
 * pan activity that should keep the poll loop awake. Exported for
 * tests; production calls it once per animation frame via the loop.
 */
export function pollWebViewport(): boolean {
  const html = document.documentElement;
  const height = window.visualViewport?.height ?? window.innerHeight;
  const pageTop = window.visualViewport?.pageTop ?? 0;

  if (pageTop !== appliedPageTop) {
    appliedPageTop = pageTop;
    const root = document.getElementById('root');
    if (root) {
      root.style.transform =
        pageTop !== 0 ? `translateY(${pageTop}px)` : '';
    }
  }

  const keyboardPx = Math.round(html.clientHeight - height);
  if (keyboardPx > KEYBOARD_MIN_PX) {
    keyboardOffFrames = 0;
    if (!keyboardVisible || keyboardPx !== appliedKeyboardPx) {
      keyboardVisible = true;
      appliedKeyboardPx = keyboardPx;
      html.classList.add('keyboard-visible');
      html.style.setProperty('--keyboard-height', `${keyboardPx}px`);
      html.style.setProperty('--sheet-kb-offset', `-${keyboardPx}px`);
    }
  } else if (keyboardVisible) {
    keyboardOffFrames += 1;
    if (keyboardOffFrames > KEYBOARD_OFF_FRAMES) {
      keyboardVisible = false;
      appliedKeyboardPx = 0;
      html.classList.remove('keyboard-visible');
      html.style.setProperty('--keyboard-height', '0px');
      html.style.setProperty('--sheet-kb-offset', '0px');
    }
  }

  return (
    keyboardVisible ||
    pageTop !== 0 ||
    (document.activeElement?.matches(EDITABLE_SELECTOR) ?? false)
  );
}

function loop(): void {
  if (pollWebViewport()) {
    idleFrames = 0;
  } else {
    idleFrames += 1;
  }
  if (idleFrames > SLEEP_AFTER_IDLE_FRAMES) {
    rafId = null;
    return;
  }
  rafId = requestAnimationFrame(loop);
}

function wake(): void {
  idleFrames = 0;
  if (rafId === null) {
    rafId = requestAnimationFrame(loop);
  }
}

/**
 * Start the manager. On web platforms, manages keyboard panning and
 * viewport tracking. On native iOS, applies the home-indicator bottom-gap
 * fix (same logic as PWA standalone). Android native is skipped entirely
 * since adjustResize resizes the WebView instead of panning.
 */
export function initWebViewportManager(): void {
  const isNative = Capacitor.isNativePlatform();
  const iOSNative = isNative && Capacitor.getPlatform() === 'ios';
  const isWeb = !isNative;

  // iOS (native and PWA standalone) applies the bottom-gap fix to clear
  // the home indicator from double-padding the footer. On iOS native,
  // this runs unconditionally; on PWA, only if navigator.standalone.
  const shouldApplyIosBottomGap =
    iOSNative || ((navigator as { standalone?: boolean }).standalone === true);

  if (shouldApplyIosBottomGap) {
    applyIosStandaloneBottomGap();
    window.addEventListener('resize', applyIosStandaloneBottomGap);
  }

  // Web keyboard management and viewport polling (no-op on Android native).
  if (isWeb) {
    document.addEventListener('focusin', wake);
    window.visualViewport?.addEventListener('resize', wake);
    window.visualViewport?.addEventListener('scroll', wake);
    wake();
  }
}
