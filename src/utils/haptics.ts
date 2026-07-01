import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

/**
 * Extremely light single tap for confirming a meaningful moment
 * (payment sent / received, QR captured). Deliberately ImpactStyle.Light
 * only: no heavier notification/success buzz. No-op on web and on
 * devices without a haptic engine.
 */
export async function hapticLight(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* no haptic engine on this device — ignore */
  }
}
