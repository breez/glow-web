import React, { useEffect, useState } from 'react';
import SlideInPage from '../components/layout/SlideInPage';
import { AlertCard } from '../components/AlertCard';
import { ConfirmDialog } from '../components/ui';
import { ChevronRightIcon, ExternalLinkIcon, TrashIcon } from '../components/Icons';
import { useWallet, useWalletInfo } from '@/contexts/WalletContext';
import { isPasskeyMode } from '@/services/passkeyService';
import { isAppLockSupported } from '@/services/appLock';
import { ACCOUNT_DELETION_GUIDE_URL } from '@/services/accountDeletion';
import { openExternalUrl } from '@/utils/externalLink';
import { formatWithSpaces } from '@/utils/formatNumber';

interface DeleteAccountPageProps {
  onBack: () => void;
  /** Fire-and-forget: App swaps in the deletion overlay immediately. */
  onDelete: () => void;
  onOpenSecurity: () => void;
  onOpenBackup: () => void;
}

/**
 * In-app account deletion (App Store Guideline 5.1.1(v)). Explains
 * what deletion covers (Lightning address release + full local wipe),
 * what it cannot cover (the passkey, the funds themselves), and gates
 * the destructive action behind a confirm dialog.
 */
const DeleteAccountPage: React.FC<DeleteAccountPageProps> = ({
  onBack,
  onDelete,
  onOpenSecurity,
  onOpenBackup,
}) => {
  const wallet = useWallet();
  const walletInfo = useWalletInfo();
  const [showConfirm, setShowConfirm] = useState(false);
  const [lightningAddress, setLightningAddress] = useState<string | null>(null);
  const isPasskey = isPasskeyMode();
  const balanceSats = walletInfo?.balanceSats ?? 0;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const address = await wallet.getLightningAddress();
        if (!cancelled) setLightningAddress(address?.lightningAddress ?? null);
      } catch { /* page copy falls back to a generic mention */ }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  const footer = (
    <button
      type="button"
      onClick={() => setShowConfirm(true)}
      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-spark-warning/15 border border-spark-warning/40 text-spark-warning rounded-xl font-display font-semibold hover:bg-spark-warning/25 transition-colors"
    >
      <TrashIcon size="md" />
      Delete Account
    </button>
  );

  return (
    <SlideInPage title="Delete Account" onClose={onBack} closeStyle="back" slideFrom="right" footer={footer}>
      <div className="p-4">
        <div className="max-w-xl mx-auto w-full space-y-4">
          <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
            <h3 className="font-display font-semibold text-spark-text-primary mb-3">
              What deleting your account does
            </h3>
            <ul className="text-sm text-spark-text-secondary space-y-2 list-disc pl-4">
              <li>
                Releases your Lightning address
                {lightningAddress ? (
                  <> (<span className="text-spark-text-primary">{lightningAddress}</span>)</>
                ) : null}
                , so it can no longer receive payments and the name becomes available to others.
              </li>
              <li>
                Erases all Glow data from this device, including your recovery phrase,
                payment history, and settings.
              </li>
            </ul>
          </div>

          {balanceSats > 0 && (
            <AlertCard variant="error" title="Your account still holds funds">
              <p>
                Your balance is ₿{formatWithSpaces(balanceSats)}. Deleting your account does
                not move or destroy funds; they stay locked to your keys. Send them to
                another account first, or make sure you can restore access with your{' '}
                {isPasskey ? 'passkey or recovery phrase' : 'recovery phrase'}.
              </p>
            </AlertCard>
          )}

          {isPasskey ? (
            <AlertCard variant="warning" title="Your passkey is not deleted">
              <p>
                Glow cannot remove passkeys. Yours stays in your password manager until you
                delete it there yourself. Save your recovery phrase before removing it:
                without the passkey or the phrase, any remaining funds are lost forever.
              </p>
            </AlertCard>
          ) : (
            <AlertCard variant="warning" title="Save your recovery phrase">
              <p>
                Your recovery phrase is erased from this device along with everything else.
                Without a saved copy, any remaining funds are lost forever.
              </p>
            </AlertCard>
          )}

          <div className="bg-spark-dark border border-spark-border rounded-2xl p-4 space-y-2">
            <button
              type="button"
              className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors"
              onClick={isAppLockSupported() ? onOpenSecurity : onOpenBackup}
            >
              <span>Show Recovery Phrase</span>
              <ChevronRightIcon size="md" />
            </button>
            {isPasskey && (
              <button
                type="button"
                className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors"
                onClick={() => { void openExternalUrl(ACCOUNT_DELETION_GUIDE_URL); }}
              >
                <span>How to remove your passkey</span>
                <ExternalLinkIcon size="sm" />
              </button>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showConfirm}
        title="Delete Account?"
        message={
          'This permanently erases all Glow data from this device and releases your Lightning address. It cannot be undone.\n\nYour funds are not moved. Afterwards they can only be restored with your '
          + (isPasskey ? 'passkey or recovery phrase.' : 'recovery phrase.')
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          setShowConfirm(false);
          onDelete();
        }}
        onCancel={() => setShowConfirm(false)}
      />
    </SlideInPage>
  );
};

export default DeleteAccountPage;
