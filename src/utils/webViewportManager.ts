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

const EDITABLE_SELECTOR = 'input, textarea, [contenteditable="true"]';

let rafId: number | null = null;
let idleFrames = 0;
let appliedPageTop = 0;
let keyboardVisible = false;

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

  const kb = html.clientHeight - height > KEYBOARD_MIN_PX;
  if (kb !== keyboardVisible) {
    keyboardVisible = kb;
    html.classList.toggle('keyboard-visible', kb);
    html.style.setProperty(
      '--keyboard-height',
      kb ? `${Math.round(html.clientHeight - height)}px` : '0px',
    );
  }

  return (
    kb ||
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
 * Start the manager (web only; no-op on native, where adjustResize
 * resizes the WebView and no panning exists). The listeners only wake
 * the poll loop; all state changes flow through pollWebViewport so
 * event-less changes are caught while the loop is awake.
 */
export function initWebViewportManager(): void {
  if (Capacitor.isNativePlatform()) return;
  document.addEventListener('focusin', wake);
  window.visualViewport?.addEventListener('resize', wake);
  window.visualViewport?.addEventListener('scroll', wake);
  wake();
}
