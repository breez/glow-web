import React from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import { AlertCard } from '../components/AlertCard';
import { PrimaryButton } from '../components/ui';
import { CheckCircleIcon, ExternalLinkIcon } from '../components/Icons';
import { useStatusBarColor } from '../hooks/useStatusBarColor';
import { STATUS_BAR_LOADING } from '../utils/statusBarManager';
import { ACCOUNT_DELETION_GUIDE_URL } from '@/services/accountDeletion';
import { openExternalUrl } from '@/utils/externalLink';

interface AccountDeletedPageProps {
  phase: 'deleting' | 'done';
  /**
   * Captured before the wipe: isPasskeyMode() reads localStorage,
   * which is already cleared by the time this page shows 'done'.
   */
  wasPasskey: boolean;
  onDone: () => void;
}

/**
 * Full-screen overlay for the deletion flow. Replaces the whole
 * screen tree (no useWallet consumers) so the SDK can disconnect and
 * null its client while this is up, and doubles as the confirmation
 * step App Review expects at the end of account deletion.
 */
const AccountDeletedPage: React.FC<AccountDeletedPageProps> = ({ phase, wasPasskey, onDone }) => {
  useStatusBarColor(STATUS_BAR_LOADING);

  if (phase === 'deleting') {
    return (
      <div className="absolute inset-0 bg-spark-void z-50 flex flex-col items-center justify-center gap-4 p-6">
        <LoadingSpinner />
        <p className="text-spark-text-secondary text-sm">Deleting your account...</p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-spark-void z-50 flex items-center justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-sm space-y-5 text-center">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-spark-success/15 flex items-center justify-center">
            <CheckCircleIcon size="xl" className="text-spark-success" />
          </div>
        </div>
        <h1 className="font-display text-2xl font-bold text-spark-text-primary">
          Account Deleted
        </h1>
        <p className="text-spark-text-secondary text-sm">
          Your Lightning address has been released and all Glow data on this device has
          been erased.
        </p>

        {wasPasskey ? (
          <AlertCard variant="warning" title="Your passkey still exists">
            <p className="text-left">
              If your account held funds, keep the passkey (or a saved recovery phrase) to
              restore access. To remove the passkey as well, delete it from your password
              manager.
            </p>
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium underline"
              onClick={() => { void openExternalUrl(ACCOUNT_DELETION_GUIDE_URL); }}
            >
              How to remove your passkey
              <ExternalLinkIcon size="xs" />
            </button>
          </AlertCard>
        ) : (
          <p className="text-spark-text-muted text-sm">
            If you saved your recovery phrase, you can restore your account with it at any
            time.
          </p>
        )}

        <PrimaryButton className="w-full" onClick={onDone}>
          Done
        </PrimaryButton>
      </div>
    </div>
  );
};

export default AccountDeletedPage;
