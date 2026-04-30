import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard } from '@capacitor/keyboard';
import App from './App';
import './index.css';
import { logger, LogCategory } from '@/services/logger';
import initBreezSDK from '@breeztech/breez-sdk-spark';

// Allow JSON.stringify to handle BigInt values (e.g. payment amounts/fees from SDK)
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

// Pin the system bars to the Glow "surface" tone on native builds so they
// blend with the app bar glassmorphism. setStyle controls icon brightness;
// setBackgroundColor is Android-only (iOS ignores it; Android 15+ no-ops due
// to edge-to-edge). setOverlaysWebView(false) forces the WebView to start
// below the status bar on Android so env(safe-area-inset-top) resolves to 0
// and the CollapsingWalletHeader padding stops double-counting the status
// bar height. The pre-JS dark theme in android/app/src/main/res/values/
// styles.xml is the belt-and-braces fallback before this init runs.
//
// Color is #151520 (spark.surface from tailwind.config.js) rather than the
// deeper #0a0a0f canvas so the system bars visibly match the header
// glassmorphism surface rather than disappearing into near-black.
if (Capacitor.isNativePlatform()) {
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {
    /* unsupported platform or Android 15+ edge-to-edge — ignore */
  });
  // #13131d = spark-surface (#151520) composited at 80% opacity over the
  // spark-void canvas (#0a0a0f), the exact effective color produced by
  // the CollapsingWalletHeader's bg-spark-surface/80 glassmorphism and
  // the .bottom-bar rgba(21,21,32,0.8). Setting the system bars to this
  // value makes the wallet home page glass appear to extend seamlessly
  // through the status/nav bars rather than meeting a visibly different
  // shade at their edges. Off by ~2 rgb units from the solid spark-surface
  // used on SlideInPage / PageLayout headers — imperceptible on dark UIs.
  StatusBar.setBackgroundColor({ color: '#13131d' }).catch(() => {
    /* iOS ignores setBackgroundColor; Android 15+ no-op — ignore */
  });
  if (Capacitor.getPlatform() === 'android') {
    StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {
      /* Android 15+ edge-to-edge enforcement — ignore */
    });
  }

  // Track the soft keyboard height via @capacitor/keyboard events and
  // publish it as a `--keyboard-height` CSS custom property on :root
  // (plus a `keyboard-visible` class on <html>). Components that care
  // about keyboard visibility can read the CSS var / class instead of
  // subscribing to the Keyboard plugin directly from every callsite.
  //
  // The `void` on each addListener suppresses the unhandled-promise
  // warning; we don't store the handle because main.tsx runs once at
  // startup and the listener lifetime is the app lifetime.
  void Keyboard.addListener('keyboardWillShow', (info) => {
    document.documentElement.style.setProperty(
      '--keyboard-height',
      `${info.keyboardHeight}px`,
    );
    document.documentElement.classList.add('keyboard-visible');
    logger.debug(LogCategory.UI, 'Keyboard will show', {
      keyboardHeight: info.keyboardHeight,
    });
  });
  void Keyboard.addListener('keyboardDidShow', () => {
    // Scroll the focused input into the visible portion of its
    // nearest intentionally-scrollable ancestor (the
    // BottomSheetCard's overflow-y-auto content area). Done
    // manually with getBoundingClientRect deltas rather than
    // element.scrollIntoView() — the CSSOM scrollIntoView algorithm
    // walks up every scrolling box, including overflow:hidden
    // ancestors like WalletPage's root, and would drag them off
    // screen.
    requestAnimationFrame(() => {
      const focused = document.activeElement as HTMLElement | null;
      if (
        !focused ||
        !(
          focused.tagName === 'INPUT' ||
          focused.tagName === 'TEXTAREA' ||
          focused.isContentEditable
        )
      ) {
        return;
      }

      let scrollable: HTMLElement | null = focused.parentElement;
      while (scrollable) {
        const style = getComputedStyle(scrollable);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') break;
        scrollable = scrollable.parentElement;
      }
      if (scrollable) {
        const focusedRect = focused.getBoundingClientRect();
        const scrollRect = scrollable.getBoundingClientRect();
        const padding = 24;
        if (focusedRect.top < scrollRect.top + padding) {
          scrollable.scrollTop -= scrollRect.top + padding - focusedRect.top;
        } else if (focusedRect.bottom > scrollRect.bottom - padding) {
          scrollable.scrollTop +=
            focusedRect.bottom - scrollRect.bottom + padding;
        }
      }
    });
  });
  void Keyboard.addListener('keyboardWillHide', () => {
    document.documentElement.style.setProperty('--keyboard-height', '0px');
    document.documentElement.classList.remove('keyboard-visible');
    logger.debug(LogCategory.UI, 'Keyboard will hide');
  });
}

/**
 * Fades out and removes the initial splash screen, resolving once the
 * fade has fully completed and the node is detached.
 *
 * Uses the Web Animations API (`Element.animate()`) instead of the
 * original CSS-transition approach because `transitionend` proved to
 * be unreliable on Android WebView — production logs captured the
 * old 300ms fallback firing instead of `transitionend`, meaning the
 * opacity transition was being janked on the main thread, leaving the
 * splash partially visible while the biometric prompt raced in on top
 * of it. WAAPI runs the interpolation on the native compositor, so
 * it isn't starved by the React commit that happens right before we
 * kick off the fade, and `animation.finished` is the canonical signal
 * that every keyframe has been composited.
 *
 * Safe to call when there is no splash (returns an already-resolved
 * Promise), and safe to call fire-and-forget from non-paint-sensitive
 * call sites that just want the splash gone.
 */
export async function hideSplash(): Promise<void> {
  const splash = document.getElementById('splash');
  if (!splash) return;

  const animation = splash.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: 100, easing: 'ease-out', fill: 'forwards' },
  );

  try {
    await animation.finished;
  } catch {
    /* animation cancelled (e.g. node removed mid-flight) — swallow;
       the remove below still detaches the node if it's still there. */
  } finally {
    splash.remove();
  }
}

async function init() {
  try {
    logger.info(LogCategory.UI, 'Initializing application');
    // Initialize WASM module
    logger.info(LogCategory.SDK, 'Initializing WASM module');
    await initBreezSDK();
    logger.info(LogCategory.SDK, 'WASM module initialized successfully');

    // Render the app - splash stays visible until App signals it's ready
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <App />
    );
    logger.info(LogCategory.UI, 'Application initialized successfully');

    // Note: splash is now hidden by App.tsx when initial loading completes
  } catch (error) {
    logger.error(LogCategory.UI, 'Failed to initialize app', {
      error: error instanceof Error ? error.message : String(error),
    });
    void hideSplash();
    document.getElementById('root')!.innerHTML = `
      <div style="color: #ef4444; padding: 20px; text-align: center; background: #0a0a0f; min-height: 100vh; display: flex; flex-direction: column; justify-content: center;">
        <h2>Failed to load application</h2>
        <p>There was an error starting Glow. Please refresh and try again.</p>
      </div>
    `;
  }
}

init();
