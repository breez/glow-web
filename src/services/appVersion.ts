import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

/**
 * The version to show the user. On a native build that is the shell's own
 * version, read at runtime rather than baked in: it is the number the store
 * listing and App Review show, and asking for it means a shell release can
 * never drift from the label. The web bundle has no shell to ask, so it falls
 * back to its build-time version, which is kept in step with the shell's.
 */
export async function getAppVersion(): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    try {
      return (await App.getInfo()).version;
    } catch {
      // App.getInfo is unavailable on this host — fall back to the bundle's.
    }
  }
  return __APP_VERSION__;
}
