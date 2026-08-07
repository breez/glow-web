import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

/**
 * Native share sheet on Capacitor, Web Share API on the web. Android System
 * WebView does not implement `navigator.share`, which is why the plugin path
 * exists. Fixed for the page lifetime, so it is safe to read once.
 */
export const canShare = (): boolean =>
  Capacitor.isNativePlatform() || (typeof navigator !== 'undefined' && !!navigator.share);

/**
 * Share plain text. A dismissed sheet resolves: web rejects with `AbortError`
 * and the native plugin with a "canceled" message, neither worth surfacing.
 * Rejects only on a real failure.
 */
export async function shareText(title: string, text: string): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Share.share({ title, text });
    } else {
      await navigator.share({ title, text });
    }
  } catch (err) {
    const name = (err as Error).name;
    const message = (err as Error).message ?? '';
    if (name !== 'AbortError' && !/cancel/i.test(message)) throw err;
  }
}
