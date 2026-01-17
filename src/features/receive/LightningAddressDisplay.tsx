import React, { useState, useEffect } from 'react';
import type { LightningAddressInfo } from '@breeztech/breez-sdk-spark';
import LoadingSpinner from '../../components/LoadingSpinner';
import { QRCodeContainer, PrimaryButton, FormGroup, FormInput, FormError } from '../../components/ui';
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

const EditableAddressText: React.FC<{
  text: string;
  onEdit: () => void;
}> = ({ text, onEdit }) => {
  const { showToast } = useToast();
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && !!navigator.share);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('success', 'Copied!');
    } catch {
      // no-op fallback
    }
  };

  const handleShare = async () => {
    try {
      await navigator.share({
        title: 'Lightning Address',
        text: text,
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        showToast('error', 'Failed to share');
      }
    }
  };

  return (
    <div className="flex flex-col items-center w-full gap-3">
      {/* Centered address text */}
      <div className="text-center font-mono text-spark-amber text-sm sm:text-base break-all px-2">
        {text}
      </div>
      
      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleCopy}
          className="flex items-center gap-2 px-4 py-2 bg-spark-amber text-black rounded-xl font-medium text-sm hover:bg-spark-amber-light transition-colors"
          title="Copy Lightning Address"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M8 2a2 2 0 00-2 2v1H5a2 2 0 00-2 2v7a2 2 0 002 2h6a2 2 0 002-2v-1h1a2 2 0 002-2V6l-4-4H8zm6 6h-2a2 2 0 01-2-2V4H8v1h3a1 1 0 011 1v2h2v2z"/>
          </svg>
          Copy
        </button>

        {canShare && (
          <button
            onClick={handleShare}
            className="flex items-center gap-2 px-4 py-2 border border-spark-border text-spark-text-secondary rounded-xl font-medium text-sm hover:text-spark-text-primary hover:border-spark-border-light transition-colors"
            title="Share Lightning Address"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z"/>
            </svg>
            Share
          </button>
        )}

        <button
          onClick={onEdit}
          className="flex items-center gap-2 px-4 py-2 border border-spark-border text-spark-text-secondary rounded-xl font-medium text-sm hover:text-spark-text-primary hover:border-spark-border-light transition-colors"
          title="Edit Lightning Address"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
          </svg>
          Edit
        </button>
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
  onEdit,
  onSave,
  onCancel,
  onEditValueChange,
  onCustomizeAmount,
}) => {
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
      <div className="pt-4 space-y-6">
        <div className="text-center">
          <h3 className="font-display text-lg font-semibold text-spark-text-primary mb-2">
            {address ? 'Edit Lightning Address' : 'Create Lightning Address'}
          </h3>
        </div>

        <FormGroup>
          <FormInput
            id="lightning-address"
            type="text"
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            placeholder="username"
            disabled={isLoading}
          />
          <FormError error={error} />
        </FormGroup>

        <div className="flex gap-3 justify-center">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-spark-text-secondary border border-spark-border rounded-xl hover:text-spark-text-primary hover:border-spark-border-light transition-colors"
          >
            Cancel
          </button>
          <PrimaryButton onClick={onSave} disabled={isLoading}>
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
        <EditableAddressText text={address?.lightningAddress || ''} onEdit={onEdit} />

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
