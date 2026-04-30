import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';

/**
 * Handler invoked when the Android hardware back button is pressed.
 * Return `true` to indicate the event was handled (and walk stops).
 * Return `false` (or `void`) to pass through to the next handler.
 */
export type BackButtonHandler = () => boolean | void | Promise<boolean | void>;

// LIFO stack of back-button handlers. The topmost (last-registered)
// handler runs first. Each open dialog / sheet / drawer / menu pushes
// its close callback here on mount and removes it on unmount, so the
// natural "close the most recently opened thing first" ordering is
// preserved without each component needing to know about the others.
const handlers: BackButtonHandler[] = [];

let listenerPromise: Promise<PluginListenerHandle> | null = null;

/**
 * Register the global `App.backButton` listener exactly once. Called
 * lazily on first push so apps that never open a modal don't pay the
 * cost of wiring it up.
 */
function ensureListener(): void {
  if (listenerPromise) return;
  if (!Capacitor.isNativePlatform()) return;

  listenerPromise = App.addListener('backButton', async () => {
    // Walk handlers from the top of the stack downward. First one to
    // return anything other than `false` wins and absorbs the event.
    // Most components return void from their close callback, which
    // counts as handled.
    for (let i = handlers.length - 1; i >= 0; i--) {
      try {
        const result = await handlers[i]();
        if (result !== false) return;
      } catch {
        // A broken handler shouldn't blow up the next one in the stack.
      }
    }
    // No handler absorbed the event. Minimise the app instead of
    // exiting: App.exitApp() destroys the activity process, and if
    // a system-UI dialog (e.g. BiometricPrompt) is live at the time,
    // SystemUI keeps it on screen as an orphan with an unresponsive
    // Cancel button until the device is rebooted. minimizeApp() is
    // lifecycle-safe (same as pressing Home) so any pending dialogs
    // get torn down through the normal onPause / onStop path.
    try {
      await App.minimizeApp();
    } catch {
      // minimizeApp is Android-only; harmless defensive catch.
    }
  });
}

/**
 * Push a handler onto the back-button stack. Returns a disposer that
 * removes it — always call the disposer in a `useEffect` cleanup or
 * on the component's unmount.
 */
export function pushBackButtonHandler(handler: BackButtonHandler): () => void {
  handlers.push(handler);
  ensureListener();
  return () => {
    const idx = handlers.lastIndexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  };
}
