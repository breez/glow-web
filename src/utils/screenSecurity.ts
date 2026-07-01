import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { PrivacyScreen } from '@capacitor/privacy-screen';

/**
 * OS-level screen-capture protection for the seed-reveal screens, via
 * @capacitor/privacy-screen (toggled per-screen).
 *
 *   - Android: FLAG_SECURE (applied on enable) blocks screenshots,
 *     renders the view black in screen recordings, hides the recents /
 *     app-switcher thumbnail, and blocks mirroring to non-secure
 *     external displays.
 *   - iOS: blurs the app-switcher snapshot. iOS has no API to block a
 *     live screenshot or recording, so that channel stays open there.
 *
 * No-op on web. Scoped per-screen because onboarding's Generate screen
 * deliberately stays capturable; only Backup and Restore are protected.
 *
 * Protection is STICKY: enabling is immediate, but disabling is deferred
 * by a grace period and cancelled by any re-enable. The native toggle is
 * async, so without this a screen could paint a frame of the seed before
 * FLAG_SECURE lands, or clear it mid slide-out animation. Callers enable
 * on screen mount (before any seed renders), and the grace window covers
 * the exit animation and quick reveal -> hide -> reveal.
 */
const DISABLE_GRACE_MS = 600;
let pendingDisable: ReturnType<typeof setTimeout> | null = null;

function clearPending(): void {
  if (pendingDisable !== null) {
    clearTimeout(pendingDisable);
    pendingDisable = null;
  }
}

export async function setScreenCaptureProtection(enabled: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (enabled) {
    clearPending();
    try {
      await PrivacyScreen.enable({ ios: { blurEffect: 'dark' } });
    } catch {
      /* best-effort — protection is defense-in-depth, never block the UI */
    }
    return;
  }
  // Defer the clear so a page's slide-out (seed still on screen while
  // animating away) stays covered; a re-enable cancels it.
  clearPending();
  pendingDisable = setTimeout(() => {
    pendingDisable = null;
    PrivacyScreen.disable().catch(() => {
      /* best-effort */
    });
  }, DISABLE_GRACE_MS);
}

/**
 * Enables screen-capture protection while `active` is true and schedules
 * the deferred clear on unmount / when `active` flips false.
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
