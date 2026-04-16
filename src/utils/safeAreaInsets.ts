import { Capacitor } from '@capacitor/core';

/**
 * Safe-area inset helpers for layouts that need to clear the system
 * status bar / notch / home indicator.
 *
 * Why this exists:
 *
 * On Android Capacitor WebView, `env(safe-area-inset-top)` reports a
 * non-zero value even when `StatusBar.setOverlaysWebView(false)` places
 * the WebView below the opaque status bar. The value is populated
 * asynchronously after the first layout pass, which produces a visible
 * top-padding jump right after the initial render — content briefly
 * sits at the top of the WebView, then suddenly shifts down by the
 * status bar height once CSS re-evaluates.
 *
 * Bypass `env()` on Android native entirely and use a fixed 0.5rem gap
 * below the status bar instead. The status bar is a separate system
 * surface on that path (no notch to clear), so an 8dp visual gap reads
 * as generous breathing room without the layout thrash.
 *
 * On iOS the safe-area insets work correctly and are necessary for the
 * notch / Dynamic Island; on the desktop / PWA web path they resolve
 * to 0 through the CSS fallback.
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
 * - Android native: 0.5rem  (fixed gap below the opaque status bar)
 * - iOS / web     : env(safe-area-inset-top, 0px)
 */
export const safeAreaTop = isAndroidNative ? '0.5rem' : 'env(safe-area-inset-top, 0px)';

/**
 * CSS value for bottom padding that clears the home indicator /
 * navigation bar. Mirrors safeAreaTop on the Android workaround path.
 */
export const safeAreaBottom = isAndroidNative ? '0.5rem' : 'env(safe-area-inset-bottom, 0px)';
