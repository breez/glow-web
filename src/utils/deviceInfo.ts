import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { App } from '@capacitor/app';
import { logger, LogCategory } from '@/services/logger';

/**
 * Log device + app metadata once at startup to aid debugging from the
 * in-app log viewer (Settings -> Share Logs). Native shells pin
 * loggingBehavior:'none', so bridged console output never reaches
 * logcat / Console.app: this structured breadcrumb is the record of
 * what hardware / OS / app build a session ran on.
 */
export async function logStartupDeviceInfo(): Promise<void> {
  try {
    const info = await Device.getInfo();
    const context: Record<string, unknown> = {
      platform: info.platform,
      operatingSystem: info.operatingSystem,
      osVersion: info.osVersion,
      manufacturer: info.manufacturer,
      model: info.model,
      webViewVersion: info.webViewVersion,
      isVirtual: info.isVirtual,
    };
    // App.getInfo is native-only (rejects on web); version + build are
    // the most useful fields for correlating a report to a released build.
    if (Capacitor.isNativePlatform()) {
      try {
        const app = await App.getInfo();
        context.appVersion = app.version;
        context.appBuild = app.build;
      } catch {
        /* App.getInfo unavailable on this host — omit */
      }
    }
    logger.info(LogCategory.SESSION, 'Device info', context);
  } catch (err) {
    logger.warn(LogCategory.SESSION, 'Failed to read device info', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
