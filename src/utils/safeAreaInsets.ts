import { Capacitor } from '@capacitor/core';

/**
 * Safe-area inset helpers for layouts that need to clear the system
 * status bar / notch / home indicator.
 *
 * Why this exists:
 *
 * On Android native builds, raw `env(safe-area-inset-*)` is not a
 * trustworthy source, on any WebView version:
 *
 * - Legacy WebViews (< 140) report a non-zero top inset even when
 *   `StatusBar.setOverlaysWebView(false)` places the WebView below the
 *   opaque status bar. The value is populated asynchronously after the
 *   first layout pass, which produces a visible top-padding jump right
 *   after the initial render.
 * - Modern WebViews (>= 140 ship the Chromium safe-area fix, and the
 *   WebView auto-updates independently of the OS) surface the display
 *   cutout inset of the root window. On a notched pre-Android-15 device
 *   the WebView never extends under the status bar (Capacitor only goes
 *   edge-to-edge where the OS enforces it, Android 15+), yet
 *   `env(safe-area-inset-top)` still resolves to the cutout height:
 *   measured 85px on a Huawei P20 (Android 10, WebView 150, EMUI pins
 *   layoutInDisplayCutoutMode=always), which double-padded every header
 *   by one status-bar height. The PWA on the same device resolves 0.
 *
 * The trustworthy carrier on Android is the `--safe-area-inset-*`
 * custom property injected by Capacitor's SystemBars plugin. It is
 * written exactly on the OS versions where the web layer must consume
 * insets itself (Android 15+): real values in passthrough mode
 * (WebView >= 140 + viewport-fit=cover, no native padding), zeros when
 * native pads the WebView parent instead, and the bottom value is
 * zeroed while the keyboard is visible. On Android < 15 the variable
 * is never written and native keeps the WebView clear of the system
 * bars, so a fixed 0.5rem breathing gap is all the page needs. Hence:
 * consume the variable with a 0px default and a 0.5rem floor, and
 * never consult `env()` on Android native.
 *
 * On iOS the safe-area insets work correctly and are necessary for the
 * notch / Dynamic Island; on the desktop / PWA web path they resolve
 * to 0 through the CSS fallback. Both paths read the
 * `--safe-area-inset-*` custom property first and fall back to
 * `env()`: the variable is written by webViewportManager on iOS
 * native / standalone (as max(latched inset, env()), so it can only
 * raise the bottom inset, never hide a live env() value); everywhere
 * else it is undefined and `env()` behavior is unchanged.
 */
const isAndroidNative =
  typeof window !== 'undefined' &&
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'android';

/**
 * CSS value for top padding that clears the status bar / notch.
 *
 *   style={{ paddingTop: safeAreaTop }}
 *
 * - Android native: max(var(--safe-area-inset-top, 0px), 0.5rem)
 * - iOS / web     : var(--safe-area-inset-top, env(safe-area-inset-top, 0px))
 */
export const safeAreaTop = isAndroidNative
  ? 'max(var(--safe-area-inset-top, 0px), 0.5rem)'
  : 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))';

/**
 * CSS value for bottom padding that clears the home indicator /
 * navigation bar. Mirrors safeAreaTop on the Android path.
 */
export const safeAreaBottom = isAndroidNative
  ? 'max(var(--safe-area-inset-bottom, 0px), 0.5rem)'
  : 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))';
