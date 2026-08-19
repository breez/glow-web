import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { logger, LogCategory } from '../services/logger';

/**
 * Cash App publishes no scheme, so the widely cited `cashme` and the Square
 * Cash-era `squarecash` are both probed, first hit wins. Each must also sit in
 * LSApplicationQueriesSchemes (glow-app ios/App/App/Info.plist) or canOpenURL
 * answers false whatever is installed, hiding the entry with no error. The log
 * below is how a device tells those two failures apart.
 */
const CASH_APP_SCHEMES = ['cashme://', 'squarecash://'];

// Probed once per launch: iOS answers canOpenURL from a static declaration
// list, so installing Cash App while Glow is running needs a relaunch anyway.
let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

async function probe(): Promise<boolean> {
  for (const url of CASH_APP_SCHEMES) {
    try {
      const { value } = await AppLauncher.canOpenUrl({ url });
      if (value) {
        logger.info(LogCategory.UI, 'Cash App detected', { scheme: url });
        return true;
      }
    } catch {
      // Plugin unavailable or scheme rejected — treat as not installed.
    }
  }
  logger.info(LogCategory.UI, 'Cash App not detected', { probed: CASH_APP_SCHEMES });
  return false;
}

/**
 * Whether Cash App is installed. Only iOS gates on this, so other platforms
 * report true without probing (Android canOpenUrl wants a package name, and the
 * web has no answer to give).
 */
export function useCashAppInstalled(): boolean {
  const isIos = Capacitor.getPlatform() === 'ios';
  // Starts false on iOS so the entry appears once, rather than flashing in and
  // then vanishing when the probe comes back negative.
  const [installed, setInstalled] = useState(cached ?? !isIos);

  useEffect(() => {
    if (!isIos || cached !== null) return;
    let active = true;
    inflight ??= probe().then((v) => (cached = v));
    inflight.then((v) => { if (active) setInstalled(v); });
    return () => { active = false; };
  }, [isIos]);

  return installed;
}
