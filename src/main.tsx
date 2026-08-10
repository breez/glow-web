import ReactDOM from 'react-dom/client';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard } from '@capacitor/keyboard';
import App from './App';
import AppErrorBoundary from './components/AppErrorBoundary';
// Font faces are declared in index.css (pointing at @fontsource's woff2 files)
// rather than importing @fontsource's own stylesheets, which hardcode
// font-display: swap. See the comment there.
import './index.css';
import { logger, LogCategory } from '@/services/logger';
import { initWebViewportManager } from '@/utils/webViewportManager';
import { installUserAgentStrippingFetch } from '@/utils/stripUserAgentFetch';
import { startDeepLinks } from '@/utils/deepLink';
import { logStartupDeviceInfo } from '@/utils/deviceInfo';
import { startSdkInit } from '@/services/sdkReady';
import { prfAvailability } from '@/services/passkeyService';

// Strip the SDK's custom User-Agent from outgoing requests before the SDK
// (or anything else) issues one. User-Agent is a forbidden fetch header
// that some engines forward (WebKit/iOS, Firefox), tripping CORS
// preflights on strict third-party hosts (blockstream, LNURL hosts). This
// replaces the previous native HTTP routing (CapacitorHttp, now disabled).
installUserAgentStrippingFetch();

// Allow JSON.stringify to handle BigInt values (e.g. payment amounts/fees from SDK)
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

// Start listening for payment deep links (lightning:, bitcoin:, lnurlp:,
// lnurlw:, keyauth:, glow:) before anything renders, so a link that
// cold-started the app is buffered by the time there is a screen to open it on.
// Self-guarding: no-op on web.
startDeepLinks();

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
  let keyboardHideClassTimer: ReturnType<typeof setTimeout> | null = null;
  let keyboardFreeInnerHeight: number | null = null;
  void Keyboard.addListener('keyboardWillShow', (info) => {
    if (keyboardHideClassTimer) {
      clearTimeout(keyboardHideClassTimer);
      keyboardHideClassTimer = null;
    }
    // Keyboard-free baseline for the stale-state check below. Only
    // captured while the keyboard is down: a field switch fires
    // willShow again with the viewport already shrunk.
    if (!document.documentElement.classList.contains('keyboard-visible')) {
      keyboardFreeInnerHeight = window.innerHeight;
    }
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
    // Hold the class through the transient hide/show pair fired when
    // focus moves between two fields; dropping it at once flaps
    // hide-on-keyboard rows and the card skirt mid-switch.
    keyboardHideClassTimer = setTimeout(() => {
      keyboardHideClassTimer = null;
      document.documentElement.style.setProperty('--keyboard-height', '0px');
      document.documentElement.classList.remove('keyboard-visible');
    }, 250);
    logger.debug(LogCategory.UI, 'Keyboard will hide');
  });

  // Android fires no keyboard hide events when the app leaves the
  // foreground with the keyboard up (Home, app switch): the var and
  // class above then stay stale, and the next sheet mount seeds its
  // keyboard-free height one keyboard too tall, parking the sheet
  // below the viewport. The window does resize back to full height
  // right away, so a keyboard-free-height resize while the class is
  // still set IS the missed hide.
  window.addEventListener('resize', () => {
    if (
      keyboardFreeInnerHeight !== null &&
      window.innerHeight >= keyboardFreeInnerHeight &&
      document.documentElement.classList.contains('keyboard-visible')
    ) {
      if (keyboardHideClassTimer) {
        clearTimeout(keyboardHideClassTimer);
        keyboardHideClassTimer = null;
      }
      document.documentElement.style.setProperty('--keyboard-height', '0px');
      document.documentElement.classList.remove('keyboard-visible');
      logger.debug(LogCategory.UI, 'Cleared stale keyboard state on resize');
    }
  });
}

// On web the same keyboard signals (`keyboard-visible` class +
// `--keyboard-height` var) come from the viewport manager, which also
// pins the page against browser focus panning. No-op on native.
initWebViewportManager();

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
/**
 * Hold the reveal until the bundled font faces have loaded.
 *
 * The faces use `font-display: block` (see index.css), so text is invisible
 * until its font is ready. Revealing first would expose a screen of empty text
 * that pops in a moment later. The splash is already covering startup, so it
 * covers this too and the app is revealed fully styled.
 *
 * By the time any caller hides the splash, React has already rendered behind
 * it, so the fonts are in flight and `fonts.ready` waits for them. The race is
 * a safety bound: a font that never resolves must not strand the splash
 * forever. The fonts are local, so in practice this resolves in tens of ms.
 */
const BUNDLED_FACES = [
  '300 1rem "Plus Jakarta Sans"',
  '400 1rem "Plus Jakarta Sans"',
  '500 1rem "Plus Jakarta Sans"',
  '600 1rem "Plus Jakarta Sans"',
  '700 1rem "Plus Jakarta Sans"',
  '800 1rem "Plus Jakarta Sans"',
  '400 1rem "JetBrains Mono"',
  '500 1rem "JetBrains Mono"',
  '600 1rem "JetBrains Mono"',
];

async function fontsSettled(): Promise<void> {
  if (!document.fonts) return;
  // Request every bundled face, not just the ones the first screen happens to
  // use. Browsers load faces lazily, so JetBrains Mono (the balance) is not
  // fetched by the welcome screen and would load later — blanking the balance
  // for a moment when the home screen first paints, under font-display: block.
  // These are local and small, so warming all of them costs tens of ms of
  // splash that is already on screen.
  const warm = Promise.all(
    BUNDLED_FACES.map((f) => document.fonts.load(f).catch(() => undefined)),
  ).then(() => document.fonts.ready);

  await Promise.race([
    warm,
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]).catch(() => { /* never block the reveal on a font failure */ });
}

/**
 * Hold the reveal until the passkey-availability check has settled.
 *
 * The welcome screen picks its onboarding flow from that check and defaults to
 * the non-passkey one until it resolves, so revealing early flashes the wrong
 * flow — and a first-time user could tap into mnemonic onboarding in that
 * window. On native this is a quick bridge call. On web it goes through the
 * SDK's PasskeyProvider and so waits on the WASM module; that is the deliberate
 * cost of showing the right screen the first time. Bounded, like the fonts.
 */
async function passkeyCheckSettled(): Promise<void> {
  await Promise.race([
    prfAvailability(),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]).catch(() => { /* never block the reveal on a failed check */ });
}

export async function hideSplash(): Promise<void> {
  const splash = document.getElementById('splash');
  if (!splash) return;

  // Both gates run concurrently: the reveal waits on the slower of the two.
  await Promise.all([fontsSettled(), passkeyCheckSettled()]);

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

// The native launch splash (@capacitor/splash-screen) is pinned up for a
// fixed `launchShowDuration` (2s, capacitor.config.ts) before it auto-hides.
// That floor is a holdover — the in-HTML `#splash` (same #0f0f18 bg + centred
// logo) is already painted by the time this module runs, so we can hand the
// native splash off to it as soon as the WebView is up instead of waiting out
// the timer. This is the same native→DOM handoff that used to happen at the 2s
// mark, just moved to first-paint, so it removes ~1.3s of fixed splash from a
// cold start without introducing a new visual seam. Accessed via registerPlugin
// (the plugin is a native-shell dependency, not bundled into the web build), so
// on web the proxy call simply rejects and the catch swallows it. The
// launchShowDuration auto-hide still stands as the fallback if JS never runs.
const NativeSplashScreen = registerPlugin<{
  hide(options?: { fadeOutDuration?: number }): Promise<void>;
}>('SplashScreen');

function handOffNativeSplash(): void {
  if (!Capacitor.isNativePlatform()) return;
  // One frame's grace so the DOM #splash is guaranteed painted before the
  // native splash lifts off it (belt-and-braces; the module running already
  // implies index.html parsed).
  requestAnimationFrame(() => {
    void NativeSplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {
      /* web (no native plugin) or already hidden — nothing to do */
    });
  });
}

/**
 * Terminal screen for a WebView with WebAssembly switched off. In practice that
 * means Apple's Lockdown Mode: WebKit disables WASM there, which takes the SDK
 * (and therefore all of Glow) with it. Nothing is fixable app-side, because
 * opting a page out of Lockdown Mode needs the `com.apple.developer.web-browser`
 * entitlement that only real browsers get. So the only useful thing to render is
 * the way out. Plain DOM: this runs before React mounts, and the splash node is
 * removed directly rather than via hideSplash(), whose passkey gate would itself
 * wait on the WASM module that isn't coming. The logo keeps the 144 box every
 * launch-path logo uses (index.html's .splash-logo, LockScreen) so it does not
 * resize as the splash hands over, and the layout mirrors UnlockPage (same
 * surface canvas, container, and logo / title / subtitle spacing) since that is
 * the sibling screen for a launch that cannot proceed. It drops UnlockPage's
 * h-dvh, though: the step list is taller than that page's content and would
 * clip on a short screen rather than scroll.
 */
function showWebAssemblyBlocked(): void {
  logger.error(LogCategory.UI, 'WebAssembly unavailable (Lockdown Mode?), halting startup');
  handOffNativeSplash();
  document.getElementById('splash')?.remove();

  const isIos = Capacitor.getPlatform() === 'ios';
  // Lockdown Mode's per-app exception list is deliberately not offered here.
  // Glow never appears in it: Capacitor serves the app from capacitor://
  // through a WKURLSchemeHandler, so the WebView performs no web navigation,
  // and it is a web navigation that triggers WebKit's first-use panel and the
  // registration behind that list. There is no opt-in API. Verified on device:
  // a clean launch under Lockdown Mode still leaves Glow off the list. Turning
  // Lockdown Mode off is the only route that actually works on native. Safari
  // does support per-site exceptions, so the web copy still points at those.
  const heading = isIos ? 'Turn off Lockdown Mode to use Glow' : 'Lockdown Mode is stopping Glow';
  const intro = isIos
    ? 'Lockdown Mode is stopping Glow from running.'
    : 'Lockdown Mode is stopping Glow from running. Add an exception for Glow in your browser settings, or open Glow in another browser.';
  const steps = isIos
    ? [
        'Open Settings',
        'Go to Privacy &amp; Security, then Lockdown Mode',
        'Tap Turn Off Lockdown Mode',
        'Confirm, and your iPhone restarts',
      ]
    : [];

  document.getElementById('root')!.innerHTML = `
    <div class="min-h-dvh w-full flex flex-col bg-spark-surface relative">
      <div class="flex-1 flex items-center justify-center p-6">
        <div class="max-w-sm w-full space-y-8">
          <div class="flex flex-col items-center gap-4">
            <img src="/assets/Glow_Logo.svg" alt="Glow" class="w-36 h-36 object-contain" />
            <h1 class="font-display text-2xl font-bold text-spark-text-primary text-center">${heading}</h1>
            <p class="text-sm text-spark-text-secondary text-center">${intro}</p>
          </div>
          ${steps.length ? `
          <ol class="bg-spark-elevated border border-spark-border rounded-2xl p-5 space-y-4">
            ${steps.map((step, i) => `
            <li class="flex gap-3 items-baseline">
              <span class="font-mono text-xs text-spark-primary shrink-0">${i + 1}</span>
              <span class="text-sm text-spark-text-primary leading-snug">${step}</span>
            </li>`).join('')}
          </ol>` : ''}
        </div>
      </div>
    </div>
  `;

  // Retry when the user returns from Settings. WebKit swaps the web process
  // between Lockdown and non-Lockdown pages, so a reload is the cheapest shot
  // at picking the exemption up without making the user find the app switcher.
  // If it doesn't take, the guard just paints this screen again, and relaunching
  // the app is the fallback.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') location.reload();
  });
}

async function init() {
  // Lockdown Mode leaves the WebView running but takes WebAssembly with it, so
  // startup would otherwise paint a working-looking welcome screen and fail at
  // the first SDK call. Bail out here with something actionable instead.
  if (typeof WebAssembly === 'undefined') {
    showWebAssemblyBlocked();
    return;
  }

  try {
    handOffNativeSplash();
    logger.info(LogCategory.UI, 'Initializing application');
    // Startup debugging breadcrumb: what hardware / OS / build this ran on.
    void logStartupDeviceInfo();

    // Kick off the ~11 MB SDK WASM compile in the BACKGROUND. We no longer
    // await it before rendering: the welcome / onboarding screen does not
    // touch the SDK, so blocking first paint on it just delayed cold start.
    // Every SDK call site awaits sdkReady() instead (see services/sdkReady.ts).
    startSdkInit();

    // Warm up the native KnownCredentialsStore so the iCloud-synced
    // Keychain (iOS) / Block Store (Android) read pays its first-touch
    // cost off the user-visible critical path. Fire-and-forget; failures
    // here just mean we pay it later inside the onboarding flow.
    if (Capacitor.isNativePlatform()) {
      void import('@/services/passkeyService').then(({ getKnownCredentialIdsBase64 }) => {
        getKnownCredentialIdsBase64().catch(() => undefined);
      });
    }

    // Render the app - splash stays visible until App signals it's ready
    // The splash is torn down below, so an uncaught render throw would
    // leave a flat black screen with no reload affordance on native.
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    );
    logger.info(LogCategory.UI, 'Application initialized successfully');

    // Note: splash is now hidden by App.tsx when initial loading completes
  } catch (error) {
    logger.error(LogCategory.UI, 'Failed to initialize app', {
      error: error instanceof Error ? error.message : String(error),
    });
    void hideSplash();
    document.getElementById('root')!.innerHTML = `
      <div style="color: #d4a574; padding: 20px; text-align: center; background: #0a0a0f; min-height: 100vh; display: flex; flex-direction: column; justify-content: center;">
        <h2>Failed to load application</h2>
        <p>There was an error starting Glow. Please refresh and try again.</p>
      </div>
    `;
  }
}

init();
