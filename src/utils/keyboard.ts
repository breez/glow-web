import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

/**
 * Dismiss the soft keyboard and blur any currently-focused input.
 *
 * Call this from form submit handlers (Save / Send / Continue buttons)
 * so the keyboard disappears when the user commits an action. Blurring
 * the active element is usually enough for the WebView to tell the
 * IME to hide, but on some devices the IME stays open if there is
 * another focusable element under the touch. Calling Capacitor's
 * `Keyboard.hide()` directly is a reliable belt-and-braces mechanism
 * on native Android/iOS.
 *
 * Safe to call from any platform: on the web the `Keyboard` plugin
 * is a no-op and we only run the blur path.
 */
export async function dismissKeyboard(): Promise<void> {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  if (Capacitor.isNativePlatform()) {
    try {
      await Keyboard.hide();
    } catch {
      // plugin not available, keyboard already hidden, or platform
      // doesn't support programmatic hide — safely ignore.
    }
  }
}
