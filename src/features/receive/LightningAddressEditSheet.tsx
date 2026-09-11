import React from 'react';
import type { LightningAddressInfo } from '@breeztech/breez-sdk-spark';
import { BottomSheetContainer, BottomSheetCard, DialogHeader, FormError, LoadingSpinner, PrimaryButton } from '../../components/ui';
import { LightningBoltIcon } from '../../components/Icons';
import { dismissKeyboard } from '../../utils/keyboard';

interface LightningAddressEditSheetProps {
  isOpen: boolean;
  /** The current address, or null when creating the first one. */
  address: LightningAddressInfo | null;
  editValue: string;
  error: string | null;
  isLoading: boolean;
  onEditValueChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

const LightningAddressEditSheet: React.FC<LightningAddressEditSheetProps> = ({
  isOpen,
  address,
  editValue,
  error,
  isLoading,
  onEditValueChange,
  onSave,
  onClose,
}) => (
  <BottomSheetContainer isOpen={isOpen} onClose={onClose} showBackdrop>
    <BottomSheetCard>
      <DialogHeader
        title={address ? 'Edit Address' : 'Create Address'}
        onClose={onClose}
        icon={<LightningBoltIcon />}
      />

      <div className="space-y-4">
        <div className="flex items-center bg-spark-dark border border-spark-border rounded-xl overflow-hidden focus-within:border-spark-primary transition-all">
          <textarea
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value.toLowerCase().replace(/[^a-z0-9\n]/g, '').replace(/\n/g, ''))}
            onKeyDown={async (e) => {
              // Last and only field in this form: Enter submits
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
            // A textarea (not an input) to keep Android's autofill bar away,
            // so it soft-wraps a long username onto a second row. wrap="off"
            // makes it scroll horizontally like a single-line field (#328).
            wrap="off"
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

        <PrimaryButton
          onClick={onSave}
          disabled={isLoading || !editValue.trim()}
          className="w-full"
          data-testid="save-address-button"
        >
          {isLoading ? <LoadingSpinner size="small" /> : 'Save'}
        </PrimaryButton>
      </div>
    </BottomSheetCard>
  </BottomSheetContainer>
);

export default LightningAddressEditSheet;
