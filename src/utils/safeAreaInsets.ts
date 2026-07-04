import { Capacitor } from '@capacitor/core';

/**
 * Safe-area inset helpers for layouts that need to clear the system
 * status bar / notch / home indicator.
 *
 * Why this exists:
 *
 * On legacy Android Capacitor WebViews (< 140), `env(safe-area-inset-top)`
 * reports a non-zero value even when `StatusBar.setOverlaysWebView(false)`
 * places the WebView below the opaque status bar. The value is populated
 * asynchronously after the first layout pass, which produces a visible
 * top-padding jump right after the initial render: content briefly sits
 * at the top of the WebView, then suddenly shifts down by the status bar
 * height once CSS re-evaluates. On that path we bypass `env()` entirely
 * and use a fixed 0.5rem gap; native already keeps content clear of the
 * system bars.
 *
 * On WebView >= 140 (Android 15/16 edge-to-edge), Capacitor's SystemBars
 * switches to a "passthrough" inset mode: native applies NO system-bar
 * padding and the web layer is expected to consume `env(safe-area-inset-*)`
 * itself. The fixed 0.5rem is not enough there and content renders under
 * the status bar (breez/glow-app#87). On those WebViews `env()` is
 * synchronous and reports 0 when the WebView is not overlapped by system
 * bars, so `max(env(), 0.5rem)` is safe on non-edge-to-edge devices too;
 * the phantom-env quirk above only existed on older WebViews, which keep
 * the fixed-gap path.
 *
 * On iOS the safe-area insets work correctly and are necessary for the
 * notch / Dynamic Island; on the desktop / PWA web path they resolve
 * to 0 through the CSS fallback.
 */
const isAndroidNative =
  typeof window !== 'undefined' &&
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'android';

// Android WebView versions itself via the Chrome/NNN token in the UA.
const webViewMajorVersion = isAndroidNative
  ? Number(navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? 0)
  : 0;

// Capacitor's passthrough inset mode (no native system-bar padding)
// applies on WebView >= 140 with viewport-fit=cover.
const isPassthroughInsets = webViewMajorVersion >= 140;

/**
 * CSS value for top padding that clears the status bar / notch.
 *
 *   style={{ paddingTop: safeAreaTop }}
 *
 * - Android native, WebView >= 140: max(env(safe-area-inset-top, 0px), 0.5rem)
 * - Android native, older WebView : 0.5rem (fixed gap below the opaque status bar)
 * - iOS / web                     : env(safe-area-inset-top, 0px)
 */
export const safeAreaTop = isAndroidNative
  ? isPassthroughInsets
    ? 'max(env(safe-area-inset-top, 0px), 0.5rem)'
    : '0.5rem'
  : 'env(safe-area-inset-top, 0px)';

/**
 * CSS value for bottom padding that clears the home indicator /
 * navigation bar. Mirrors safeAreaTop on the Android paths.
 */
export const safeAreaBottom = isAndroidNative
  ? isPassthroughInsets
    ? 'max(env(safe-area-inset-bottom, 0px), 0.5rem)'
    : '0.5rem'
  : 'env(safe-area-inset-bottom, 0px)';
