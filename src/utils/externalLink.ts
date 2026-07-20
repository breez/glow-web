import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

/** Chrome Custom Tabs / SFSafariViewController on native, new tab on web. */
export async function openExternalUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
