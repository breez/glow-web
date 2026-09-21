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
 * A sheet the user dismissed. The web rejects with `AbortError`, the native
 * plugin with "Share canceled" and no name, so a name test alone reads a
 * dismissal as a failure and sends the caller down its fallback path.
 */
export function isShareCancel(err: unknown): boolean {
  const e = err as Error | undefined;
  return e?.name === 'AbortError' || /cancel/i.test(e?.message ?? '');
}

/**
 * Share plain text. A dismissed sheet resolves, rejects only on a real failure.
 */
export async function shareText(title: string, text: string): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Share.share({ title, text });
    } else {
      await navigator.share({ title, text });
    }
  } catch (err) {
    if (!isShareCancel(err)) throw err;
  }
}
