/**
 * UnlockingPage — branded placeholder shown on cold launch while the
 * auto-triggered system BiometricPrompt is visible.
 *
 * Pure status screen: Glow logo + "Authenticating…" spinner, no
 * interactive controls. Content is top-aligned with a generous
 * safe-area-aware padding because on some OEM skins the system
 * biometric dialog occupies roughly the bottom half of the
 * viewport, and we want the branded content to stay visible
 * above it rather than being hidden behind the dialog.
 *
 * On cancel / lockout / retry, useBreezSdk transitions
 * startupState to 'native-locked' which renders the separate,
 * interactive UnlockPage.
 */

import React, { useEffect } from 'react';
import { logger, LogCategory } from '../services/logger';

const UnlockingPage: React.FC = () => {
  useEffect(() => {
    logger.info(LogCategory.UI, 'UnlockingPage:mounted');
    // Second effect runs after paint (via rAF) so we can distinguish
    // mount-commit from paint-on-screen in shared logs.
    requestAnimationFrame(() => {
      logger.info(LogCategory.UI, 'UnlockingPage:painted');
    });
  }, []);

  return (
    <div className="min-h-dvh h-dvh w-full flex flex-col bg-spark-surface relative">
      <div
        className="w-full flex flex-col items-center px-6"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3rem)' }}
      >
        <div className="max-w-sm w-full flex flex-col items-center gap-8">
          <img
            src="/assets/Glow_Logo.svg"
            alt="Glow"
            className="w-28 h-28"
          />

          <div className="flex items-center justify-center gap-3 text-spark-text-secondary text-sm">
            <div className="w-5 h-5 rounded-full border-2 border-spark-primary border-t-transparent animate-spin" />
            <span>Authenticating…</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnlockingPage;
