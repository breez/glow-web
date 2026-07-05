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
 * padding and the web layer must consume the insets itself, otherwise
 * content renders under the status bar (breez/glow-app#87). But raw
 * `env(safe-area-inset-*)` is NOT a reliable carrier there: measured on
 * an Android 16 emulator (WebView 141, viewport-fit=cover, WebView drawn
 * edge-to-edge and receiving a 54px top inset), `env()` still computes
 * to 0px; in practice it only reflects display cutouts. Capacitor knows
 * this, which is why SystemBars injects the real values as
 * `--safe-area-inset-*` custom properties on :root (Android 15+, i.e.
 * every OS version where passthrough padding loss actually occurs). So
 * the passthrough path consumes the Capacitor variable first and falls
 * back to `env()` (Android 14 + new WebView, where native still pads or
 * nothing is injected), with a 0.5rem floor either way. Bonus: Capacitor
 * zeroes the injected bottom inset while the keyboard is visible.
 *
 * On iOS the safe-area insets work correctly and are necessary for the
 * notch / Dynamic Island; on the desktop / PWA web path they resolve
 * to 0 through the CSS fallback. Every path reads the
 * `--safe-area-inset-*` custom property first and falls back to
 * `env()`: the variable is written by Capacitor's SystemBars on
 * Android native and by webViewportManager in iOS standalone web
 * apps (which zeroes the bottom inset when the OS already reserves
 * the home-indicator strip outside the layout viewport); everywhere
 * else it is undefined and `env()` behavior is unchanged.
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
 * - Android native, WebView >= 140: max(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)), 0.5rem)
 * - Android native, older WebView : 0.5rem (fixed gap below the opaque status bar)
 * - iOS / web                     : var(--safe-area-inset-top, env(safe-area-inset-top, 0px))
 */
export const safeAreaTop = isAndroidNative
  ? isPassthroughInsets
    ? 'max(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)), 0.5rem)'
    : '0.5rem'
  : 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))';

/**
 * CSS value for bottom padding that clears the home indicator /
 * navigation bar. Mirrors safeAreaTop on the Android paths.
 */
export const safeAreaBottom = isAndroidNative
  ? isPassthroughInsets
    ? 'max(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)), 0.5rem)'
    : '0.5rem'
  : 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))';
