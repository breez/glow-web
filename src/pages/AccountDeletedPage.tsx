import React from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import { PrimaryButton } from '../components/ui';
import { CheckCircleIcon, ExternalLinkIcon } from '../components/Icons';
import { useStatusBarColor } from '../hooks/useStatusBarColor';
import { STATUS_BAR_LOADING } from '../utils/statusBarManager';
import { safeAreaBottom } from '../utils/safeAreaInsets';
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
    <div
      className="absolute inset-0 bg-spark-void z-50 flex flex-col px-6 pt-6"
      style={{ paddingBottom: `calc(${safeAreaBottom} + 16px)` }}
    >
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-spark-success/15 flex items-center justify-center">
              <CheckCircleIcon size="xl" className="text-spark-success" />
            </div>
          </div>
          <h1 className="font-display text-2xl font-bold text-spark-text-primary">
            Account Deleted
          </h1>
          <p className="text-spark-text-secondary text-sm">
            You have been signed out and all Glow data on this device has been erased.
          </p>
          {wasPasskey && (
            <button
              type="button"
              className="mx-auto flex items-center gap-1 text-sm text-spark-text-muted underline hover:text-spark-text-secondary transition-colors"
              onClick={() => { void openExternalUrl(ACCOUNT_DELETION_GUIDE_URL); }}
            >
              How to remove your passkey
              <ExternalLinkIcon size="xs" />
            </button>
          )}
        </div>
      </div>
      <div className="w-full max-w-sm mx-auto shrink-0">
        <PrimaryButton className="w-full" onClick={onDone}>
          Done
        </PrimaryButton>
      </div>
    </div>
  );
};

export default AccountDeletedPage;
