import React from 'react';
import type { LightningAddressInfo } from '@breeztech/breez-sdk-spark';
import LoadingSpinner from '../../components/LoadingSpinner';
import { QRCodeContainer, PrimaryButton, FormError, CopyableText } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';

export interface LightningAddressDisplayProps {
  address: LightningAddressInfo | null;
  isLoading: boolean;
  isEditing: boolean;
  editValue: string;
  error: string | null;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onEditValueChange: (value: string) => void;
  onCustomizeAmount: () => void;
}

const EditButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-2 px-4 py-2 border border-spark-border text-spark-text-secondary rounded-xl font-medium text-sm hover:text-spark-text-primary hover:border-spark-border-light transition-colors"
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
  onEdit,
  onSave,
  onCancel,
  onEditValueChange,
  onCustomizeAmount,
}) => {
  const { showToast } = useToast();
  if (isLoading) {
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
              className="flex-1 bg-transparent px-4 py-3 text-spark-text-primary text-lg font-mono placeholder-spark-text-muted focus:outline-none"
              autoComplete="off"
              autoCapitalize="off"
            />
            <span className="px-4 py-3 text-spark-text-muted font-medium text-sm">
              @breez.tips
            </span>
          </div>
          
          <FormError error={error} />
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-3 text-spark-text-secondary border border-spark-border rounded-xl font-medium hover:text-spark-text-primary hover:border-spark-border-light transition-colors"
          >
            Cancel
          </button>
          <PrimaryButton 
            onClick={onSave} 
            disabled={isLoading || !editValue.trim()}
            className="flex-1"
          >
            {isLoading ? <LoadingSpinner size="small" /> : 'Save'}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 py-2">
      <QRCodeContainer value={address?.lnurl || ''} />

      <div className="w-full flex flex-col items-center gap-4">
        <CopyableText
          text={address?.lightningAddress || ''}
          showShare
          label="Lightning Address"
          textColor="text-spark-primary"
          onCopied={() => showToast('success', 'Copied!')}
          onShareError={() => showToast('error', 'Failed to share')}
          additionalActions={<EditButton onClick={onEdit} />}
        />

        <button
          onClick={onCustomizeAmount}
          className="text-spark-text-muted text-xs hover:text-spark-text-secondary transition-colors mt-2"
        >
          Create invoice with specific amount →
        </button>
      </div>
    </div>
  );
};

export default LightningAddressDisplay;
