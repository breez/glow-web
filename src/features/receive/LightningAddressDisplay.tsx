import React from 'react';
import type { LightningAddressInfo } from '@breeztech/breez-sdk-spark';
import LoadingSpinner from '../../components/LoadingSpinner';
import { SimpleAlert } from '../../components/AlertCard';
import { QRCodeContainer, PrimaryButton, SecondaryButton, FormError, CopyableText, TextButton } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';
import { EditIcon, LightningBoltIcon } from '../../components/Icons';
import { dismissKeyboard } from '../../utils/keyboard';

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
    <EditIcon />
    Edit
  </button>
);

// Separate component to handle keyboard visibility
interface EditingFormProps {
  address: LightningAddressInfo | null;
  editValue: string;
  error: string | null;
  isLoading: boolean;
  onEditValueChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

const EditingForm: React.FC<EditingFormProps> = ({
  address,
  editValue,
  error,
  isLoading,
  onEditValueChange,
  onCancel,
  onSave,
}) => {
  return (
    <div className="pt-2 space-y-5">
      {/* Header with icon */}
      <div className="flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
          <LightningBoltIcon className="w-7 h-7 text-spark-primary" />
        </div>
        <h3 className="font-display text-lg font-semibold text-spark-text-primary">
          {address ? 'Edit Address' : 'Create Address'}
        </h3>
      </div>

      {/* Input with suffix */}
      <div className="space-y-4">
        <div className="flex items-center bg-spark-dark border border-spark-border rounded-xl overflow-hidden focus-within:border-spark-primary transition-all">
          <textarea
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value.toLowerCase().replace(/[^a-z0-9\n]/g, '').replace(/\n/g, ''))}
            onKeyDown={async (e) => {
              // Last and only field in this form — Enter submits
              // via the same path as the Save button. Soft keyboard
              // shows "Done" via enterKeyHint.
              if (e.key === 'Enter') {
                e.preventDefault();
                if (!isLoading && editValue.trim()) {
                  await dismissKeyboard();
                  onSave();
                } else {
                  // Empty / invalid input: still retract the
                  // keyboard so the user can see the Save button.
                  await dismissKeyboard();
                }
              }
            }}
            enterKeyHint="done"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder="satoshi"
            disabled={isLoading}
            rows={1}
            className="flex-1 min-w-0 bg-transparent px-4 py-3 text-spark-text-primary text-lg font-mono placeholder-spark-text-muted focus:outline-hidden resize-none"
          />
          <span className="shrink-0 px-4 py-3 text-spark-text-muted font-medium text-sm">
            @breez.tips
          </span>
        </div>

        <FormError error={error} />
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 justify-center pt-2 pb-4">
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
};

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
      <EditingForm
        address={address}
        editValue={editValue}
        error={error}
        isLoading={isLoading}
        onEditValueChange={onEditValueChange}
        onCancel={onCancel}
        onSave={onSave}
      />
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
