import React from 'react';
import type { LightningAddressInfo } from '@breeztech/breez-sdk-spark';
import LoadingSpinner from '../../components/LoadingSpinner';
import { SimpleAlert } from '../../components/AlertCard';
import { QRCodeContainer, PrimaryButton, CopyableText, TextButton } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';
import { EditIcon } from '../../components/Icons';

export interface LightningAddressDisplayProps {
  address: LightningAddressInfo | null;
  isLoading: boolean;
  isSupported: boolean;
  supportMessage: string | null;
  /** Opens the edit sheet, which also creates the first address. */
  onEdit: () => void;
  onCustomizeAmount: () => void;
}

const EditButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-2 px-4 border border-spark-border text-spark-text-secondary rounded-xl font-medium text-sm hover:text-spark-text-primary hover:border-spark-border-light transition-colors"
    title="Edit Lightning Address"
  >
    <EditIcon />
    Edit
  </button>
);

const LightningAddressDisplay: React.FC<LightningAddressDisplayProps> = ({
  address,
  isLoading,
  isSupported,
  supportMessage,
  onEdit,
  onCustomizeAmount,
}) => {
  const { showToast } = useToast();

  if (!isSupported) {
    return (
      <div className="pt-4 space-y-6 flex flex-col items-center text-center">
        <SimpleAlert
          variant="info"
          className="w-full text-left"
          dataTestId="lightning-address-unsupported"
        >
          <h3 className="font-display text-lg font-semibold text-spark-text-primary mb-2">Lightning Address</h3>
          <p className="text-spark-text-secondary text-sm">
            {supportMessage ?? 'Lightning addresses are not available in this environment.'}
          </p>
        </SimpleAlert>

        <div className="w-full flex justify-center">
          <TextButton
            onClick={onCustomizeAmount}
            className="text-sm show-amount-panel-button"
            data-testid="show-amount-panel-button"
          >
            Create invoice with specific amount →
          </TextButton>
        </div>
      </div>
    );
  }

  // Loading state — gated on `!address` so we only show the spinner
  // while the address is genuinely unknown. The first open after
  // passkey onboarding (new label, no LN address registered yet)
  // lands here: `useLightningAddress.load()` hits
  // `getLightningAddress() → null`, auto-registers a random
  // username, then re-fetches. `isLoading=true` and `address=null`
  // for the full lookup→register→re-lookup span — without this
  // branch the user saw the `!address && !isEditing` fallback
  // ("Create Lightning Address" button) flash during auto-creation,
  // which is confusing because they didn't ask to create anything.
  //
  // The earlier version of this branch gated on plain `isLoading`
  // and caused a spinner flash on every tab switch because
  // `load()` refires on Lightning-tab re-entry even when `address`
  // is already cached. Gating on `!address` fixes that regression
  // too: cached-address + in-flight refresh now stays on the QR
  // view.
  if (isLoading && !address) {
    return (
      <div className="text-center py-8">
        <LoadingSpinner text="Loading Lightning Address..." />
      </div>
    );
  }

  if (!address) {
    return (
      <div className="pt-4 space-y-6 flex flex-col items-center">
        <div className="text-center">
          <h3 className="font-display text-lg font-semibold text-spark-text-primary mb-2">Lightning Address</h3>
          <p className="text-spark-text-secondary text-sm mb-4">
            Create a Lightning Address to receive payments easily
          </p>
          <PrimaryButton onClick={onEdit}>Create Lightning Address</PrimaryButton>
        </div>

        <div className="w-full flex justify-center">
          <TextButton
            onClick={onCustomizeAmount}
            className="text-sm show-amount-panel-button"
            data-testid="show-amount-panel-button"
          >
            Create invoice with specific amount →
          </TextButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <QRCodeContainer value={address?.lnurl.bech32.toUpperCase() || ''} />

      <div className="w-full flex flex-col items-center gap-4">
        <CopyableText
          text={address?.lightningAddress || ''}
          truncate
          showShare
          label="Lightning Address"
          textColor="text-spark-primary"
          onCopied={() => showToast('success', 'Copied!')}
          onShareError={() => showToast('error', 'Failed to share')}
          additionalActions={<EditButton onClick={onEdit} />}
          textToCopy={address?.lightningAddress || ''}
          textToShare={address?.lnurl.bech32 || ''}
          shareLabel="LNURL-Pay"
          data-testid="lightning-address-text"
        />

        <TextButton
          onClick={onCustomizeAmount}
          className="mt-2 show-amount-panel-button"
          data-testid="show-amount-panel-button"
        >
          Create invoice with specific amount →
        </TextButton>
      </div>
    </div>
  );
};

export default LightningAddressDisplay;
