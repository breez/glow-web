import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

/**
 * Chrome Custom Tabs / SFSafariViewController on native; a new browser
 * context on web. The web path clicks a real anchor instead of
 * window.open(): installed PWAs (iOS standalone especially) navigate
 * window.open() in place, which replaces the app and forces a cold
 * start to get back, while anchor clicks honor target="_blank". Must
 * be called from a user-gesture handler or popup blockers eat it.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url });
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
