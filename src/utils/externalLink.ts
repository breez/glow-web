import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

/**
 * Open a URL without stranding the user outside the app.
 *
 * - Native: Chrome Custom Tabs / SFSafariViewController (Done returns).
 * - Installed PWA + same-origin URL: in-app overlay (below). Same-origin
 *   pages are inside the PWA scope, and iOS standalone keeps in-scope
 *   navigations in the app window with no back affordance, so any real
 *   navigation would replace the app and force a cold start to return.
 * - Anything else on web: a real anchor click. Anchors honor
 *   target="_blank" where window.open() in installed PWAs does not.
 *   Must be called from a user-gesture handler or popup blockers eat it.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url });
    return;
  }
  if (isStandalonePwa() && new URL(url, location.href).origin === location.origin) {
    openInAppOverlay(url);
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

const isStandalonePwa = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches
  || (navigator as Navigator & { standalone?: boolean }).standalone === true;

// Full-screen same-origin iframe with a Done button. A history entry
// is pushed so the Android back gesture pops the overlay instead of
// exiting the app; Done pops that same entry. Plain DOM (no React) so
// every call site works, including pages rendered outside the app's
// provider tree.
function openInAppOverlay(url: string): void {
  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Guide');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;background:#0a0a0f;display:flex;flex-direction:column;';

  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;justify-content:flex-end;padding:calc(env(safe-area-inset-top, 0px) + 4px) 8px 4px;';

  const done = document.createElement('button');
  done.type = 'button';
  done.textContent = 'Done';
  done.style.cssText =
    'background:none;border:0;color:#fbbf24;font:600 16px -apple-system,sans-serif;padding:10px 14px;cursor:pointer;';

  // Scroll wrapper guards against legacy WebKit frame flattening
  // (iframes sized to their content); harmless where unsupported.
  const scroller = document.createElement('div');
  scroller.style.cssText = 'flex:1;overflow:auto;-webkit-overflow-scrolling:touch;';

  const frame = document.createElement('iframe');
  frame.src = url;
  frame.title = 'Guide';
  frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:#0a0a0f;';

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('popstate', cleanup);
    overlay.remove();
  };

  history.pushState({ glowGuideOverlay: true }, '');
  window.addEventListener('popstate', cleanup);
  done.addEventListener('click', () => {
    history.back();
    // Fallback where history.back() doesn't dispatch popstate.
    setTimeout(cleanup, 100);
  });

  header.appendChild(done);
  scroller.appendChild(frame);
  overlay.append(header, scroller);
  document.body.appendChild(overlay);
}
