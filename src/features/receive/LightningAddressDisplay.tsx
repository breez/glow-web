import React from 'react';
import type { LightningAddressInfo } from '@breeztech/breez-sdk-spark';
import LoadingSpinner from '../../components/LoadingSpinner';
import { SimpleAlert } from '../../components/AlertCard';
import { QRCodeContainer, PrimaryButton, SecondaryButton, FormError, CopyableText, TextButton } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';

export interface LightningAddressDisplayProps {
  address: LightningAddressInfo | null;
  isLoading: boolean;
  isEditing: boolean;
  editValue: string;
  error: string | null;
  isSupported: boolean;
  supportMessage: string | null;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onEditValueChange: (value: string) => void;
  onCustomizeAmount: () => void;
}

const EditButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-2 px-4 border border-spark-border text-spark-text-secondary rounded-xl font-medium text-sm hover:text-spark-text-primary hover:border-spark-border-light transition-colors"
    title="Edit Lightning Address"
  >
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
    </svg>
    Edit
  </button>
);

const LightningAddressDisplay: React.FC<LightningAddressDisplayProps> = ({
  address,
  isLoading,
  isEditing,
  editValue,
  error,
  isSupported,
  supportMessage,
  onEdit,
  onSave,
  onCancel,
  onEditValueChange,
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

  /* TODO: Bug: Currently shows loading state switching between BTC and Lightning Address tabs when lightning address is set.
  if (isLoading) {
    return (
      <div className="text-center py-8">
        <LoadingSpinner text="Loading Lightning Address..." />
      </div>
    );
  }
    */

  if (!address && !isEditing) {
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

  if (isEditing) {
    return (
      <div className="pt-2 space-y-5">
        {/* Header with icon */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
            <svg className="w-7 h-7 text-spark-primary" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
            </svg>
          </div>
          <h3 className="font-display text-lg font-semibold text-spark-text-primary">
            {address ? 'Edit Address' : 'Create Address'}
          </h3>
        </div>

        {/* Input with suffix */}
        <div className="space-y-4">
          <div className="flex items-center bg-spark-dark border border-spark-border rounded-xl overflow-hidden focus-within:border-spark-primary focus-within:ring-2 focus-within:ring-spark-primary/20 transition-all">
            <input
              id="lightning-address"
              type="text"
              value={editValue}
              onChange={(e) => onEditValueChange(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
              placeholder="satoshi"
              disabled={isLoading}
              className="flex-1 min-w-0 bg-transparent px-4 py-3 text-spark-text-primary text-lg font-mono placeholder-spark-text-muted focus:outline-none"
              autoComplete="off"
              autoCapitalize="off"
            />
            <span className="flex-shrink-0 px-4 py-3 text-spark-text-muted font-medium text-sm">
              @breez.tips
            </span>
          </div>

          <FormError error={error} />
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 justify-center pt-2">
          <SecondaryButton onClick={onCancel} className="flex-1">
            Cancel
          </SecondaryButton>
          <PrimaryButton
            onClick={onSave}
            disabled={isLoading || !editValue.trim()}
            className="flex-1"
            data-testid="save-address-button"
          >
            {isLoading ? <LoadingSpinner size="small" /> : 'Save'}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <QRCodeContainer value={address?.lnurl || ''} />

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
          textToShare={address?.lnurl || ''}
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
