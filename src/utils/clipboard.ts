import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';

/**
 * Write text to the clipboard through the native Clipboard plugin on
 * Capacitor hosts, falling back to navigator.clipboard on the web.
 *
 * The WebView's navigator.clipboard.writeText is unreliable on Android
 * (blocked without a secure context / recent user activation, and it
 * fails silently), so copy actions there could no-op with no feedback.
 * This mirrors the native read path in the Send flow's paste handler.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Clipboard.write({ string: text });
  } else {
    await navigator.clipboard.writeText(text);
  }
}
