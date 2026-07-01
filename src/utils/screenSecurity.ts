import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { PrivacyScreen } from '@capacitor/privacy-screen';

/**
 * OS-level screen-capture protection for the seed-reveal screens, via
 * @capacitor/privacy-screen (toggled per-screen with enable/disable).
 *
 *   - Android: FLAG_SECURE (applied automatically on enable) blocks
 *     screenshots, renders the view black in screen recordings, hides
 *     the recents / app-switcher thumbnail, and blocks mirroring to
 *     non-secure external displays.
 *   - iOS: blurs the app-switcher snapshot. iOS has no API to block a
 *     live screenshot or recording, so that channel stays open there.
 *
 * No-op on web (the plugin has no web behavior we need). Scoped
 * per-screen because onboarding's Generate screen deliberately stays
 * capturable (users legitimately screenshot a fresh phrase to back it
 * up); only Backup (re-display) and Restore (entry) are protected.
 */
export async function setScreenCaptureProtection(enabled: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (enabled) {
      await PrivacyScreen.enable({ ios: { blurEffect: 'dark' } });
    } else {
      await PrivacyScreen.disable();
    }
  } catch {
    /* best-effort — protection is defense-in-depth, never block the UI */
  }
}

/**
 * Enables screen-capture protection while `active` is true and clears it
 * on unmount / when `active` flips false.
 */
export function useScreenCaptureProtection(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    void setScreenCaptureProtection(true);
    return () => {
      void setScreenCaptureProtection(false);
    };
  }, [active]);
}
