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
 * iOS flaps between two window layouts across launch / resume / theme
 * change, usually without firing resize: a full-bleed viewport (the
 * page reaches the physical bottom) and a short viewport (the layout
 * viewport ends above the home-indicator strip; only the canvas
 * background paints there). Worse, env(safe-area-inset-bottom) is not
 * trustworthy in either state: it can report 0 in the full-bleed
 * layout, which would leave the bottom bar with no clearance at all.
 *
 * Policy: pad for the success mode, always.
 *
 *   --safe-area-inset-bottom = the device's home-indicator inset,
 *   unconditionally, on iOS native / standalone.
 *
 * The short-viewport state is a broken OS state regardless of what we
 * do (the black band below the shortened window is the system root
 * window; no web pixel can paint it), so layout is not adapted to it.
 * kickViewportRelayout() tries to escape it; until that lands the UI
 * shows the band plus normal padding, and the full-bleed success mode
 * is always rendered correctly, even when env() misreports 0 there.
 *
 * The inset is LATCHED once per device from whichever source first
 * reveals it (a nonzero env() reading, or the viewport gap the broken
 * state itself exposes; both equal the indicator inset) and persisted
 * so every later launch starts calibrated. Devices without a home
 * indicator never observe a nonzero source and latch 0. The
 * ios-standalone-bottom-gap class (index.css paints the canvas and
 * the bar in the same solid composite) stays static as well.
 */
const IOS_STANDALONE_GAP_MAX_PX = 80;
const IOS_BOTTOM_INSET_STORE_KEY = 'glow-ios-bottom-inset';

let iosBottomGapEnabled = false;
let latchedBottomInsetPx = 0;
let lastAppliedInsetVar = '';

/** Probe what env(safe-area-inset-bottom) currently resolves to. */
function readEnvBottomPx(): number {
  if (!document.body) return 0;
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom, 0px)';
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();
  return px;
}

function latchBottomInset(candidatePx: number): void {
  const px = Math.round(candidatePx);
  if (px > latchedBottomInsetPx && px <= IOS_STANDALONE_GAP_MAX_PX) {
    latchedBottomInsetPx = px;
    try {
      localStorage.setItem(IOS_BOTTOM_INSET_STORE_KEY, String(px));
    } catch {
      /* storage unavailable (private mode): stays session-latched */
    }
  }
}

function measureBottomGapPx(): number {
  const raw = Math.round(
    window.screen.height - document.documentElement.clientHeight
  );
  return raw > 0 && raw <= IOS_STANDALONE_GAP_MAX_PX ? raw : 0;
}

function applyIosBottomInset(): void {
  const html = document.documentElement;
  // screen.height is portrait-major on iOS; the gap arithmetic is only
  // meaningful in portrait. The app is portrait-designed; freeze the
  // last value in landscape rather than computing garbage.
  if (!window.matchMedia('(orientation: portrait)').matches) return;
  latchBottomInset(measureBottomGapPx());
  const value = `${latchedBottomInsetPx}px`;
  if (value !== lastAppliedInsetVar) {
    lastAppliedInsetVar = value;
    html.style.setProperty('--safe-area-inset-bottom', value);
  }
}

/**
 * The short-viewport state after a resume is (at least partly) a
 * WebKit failure to restore the standalone window geometry; the band
 * under the shortened window is the system root window, which no web
 * pixel can paint. Toggling viewport-fit off and back on forces
 * WebKit to recompute the window geometry, which restores the
 * full-bleed layout when the short state is that bug rather than
 * legitimate layout. Rate-limited; when the short state is legitimate
 * the toggle changes nothing and the inset invariant still holds.
 */
let lastViewportKickMs = 0;

function kickViewportRelayout(): void {
  const now = Date.now();
  if (now - lastViewportKickMs < 2000) return;
  lastViewportKickMs = now;
  // Cheapest nudges first: clear any pan WebKit restored along with
  // the stale geometry, and force a synchronous reflow so everything
  // below negotiates against a settled layout.
  window.scrollTo(0, 0);
  void document.documentElement.offsetHeight;
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="viewport"]'
  );
  const content = meta?.getAttribute('content');
  if (!meta || !content || !content.includes('viewport-fit=cover')) return;
  meta.setAttribute(
    'content',
    content.replace(/,?\s*viewport-fit=cover/, '')
  );
  requestAnimationFrame(() => {
    meta.setAttribute('content', content);
    // Some WebKit builds only re-lay the window when the root's own
    // geometry actually changes: grow #root by 1px for one frame.
    const root = document.getElementById('root');
    if (root) {
      root.style.minHeight = 'calc(100dvh + 1px)';
      requestAnimationFrame(() => {
        root.style.minHeight = '';
        applyIosBottomInset();
      });
    }
    window.setTimeout(applyIosBottomInset, 250);
  });
}

/**
 * Re-measure now and again after the viewport settles. iOS applies
 * resume / theme-change / rotation geometry lazily and often without
 * firing resize, so a single synchronous read can see a stale
 * clientHeight; the extra frame + 250ms taps catch the settled value.
 * Event-time is also when the env() probe runs (too costly per frame).
 */
function refreshIosBottomGap(): void {
  latchBottomInset(readEnvBottomPx());
  applyIosBottomInset();
  requestAnimationFrame(applyIosBottomInset);
  window.setTimeout(() => {
    applyIosBottomInset();
    // Still short after the settle window while visible: likely the
    // resume geometry bug; try to talk WebKit into full-bleed again.
    if (
      document.visibilityState === 'visible' &&
      window.matchMedia('(orientation: portrait)').matches &&
      measureBottomGapPx() > 0
    ) {
      kickViewportRelayout();
    }
  }, 250);
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

  if (iosBottomGapEnabled) {
    applyIosBottomInset();
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
    iosBottomGapEnabled = true;
    try {
      latchedBottomInsetPx =
        Number(localStorage.getItem(IOS_BOTTOM_INSET_STORE_KEY)) || 0;
    } catch {
      /* storage unavailable: latch during this session instead */
    }
    // Static canvas paint: correct whether or not a gap is currently
    // measurable (covered by content when there is none).
    document.documentElement.classList.add('ios-standalone-bottom-gap');
    refreshIosBottomGap();
    // iOS re-lays the window on resume, theme change, and rotation,
    // frequently without a resize event; listen to every signal that
    // correlates with those transitions. The web poll loop re-checks
    // per frame as well; on native (no loop) these are the only hooks.
    window.addEventListener('resize', refreshIosBottomGap);
    window.addEventListener('pageshow', refreshIosBottomGap);
    window.addEventListener('focus', refreshIosBottomGap);
    document.addEventListener('visibilitychange', refreshIosBottomGap);
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', refreshIosBottomGap);
  }

  // Web keyboard management and viewport polling (no-op on Android native).
  if (isWeb) {
    document.addEventListener('focusin', wake);
    window.visualViewport?.addEventListener('resize', wake);
    window.visualViewport?.addEventListener('scroll', wake);
    wake();
  }
}
