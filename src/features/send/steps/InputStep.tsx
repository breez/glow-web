import React, { useEffect, useState } from 'react';
import { SimpleAlert } from '../../../components/AlertCard';
import { PrimaryButton } from '../../../components/ui';
import { logger, LogCategory } from '@/services/logger';
import { ClipboardIcon, QrCodeIcon, SpinnerIcon } from '@/components/Icons';

export interface InputStepProps {
  paymentInput: string;
  isLoading: boolean;
  error: string | null;
  onContinue: (paymentInput: string) => void;
  onScanQr?: () => void;
}

const InputStep: React.FC<InputStepProps> = ({ paymentInput, isLoading, error, onContinue, onScanQr }) => {
  const [localPaymentInput, setLocalPaymentInput] = useState<string>(paymentInput || '');

  useEffect(() => {
    setLocalPaymentInput(paymentInput || '');
  }, [paymentInput]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text?.trim()) {
        setLocalPaymentInput(text);
        // Auto-process if pasted value looks valid
        onContinue(text);
      }
    } catch (err) {
      logger.error(LogCategory.UI, 'Failed to read clipboard contents', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Input */}
      <textarea
        value={localPaymentInput}
        onChange={(e) => setLocalPaymentInput(e.target.value)}
        placeholder="lnbc... / bc1... / sp1... / user@domain.com"
        className="w-full p-4 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary placeholder-spark-text-muted focus:border-spark-electric focus:ring-2 focus:ring-spark-electric/20 resize-none font-mono text-sm transition-all"
        rows={3}
        disabled={isLoading}
        data-testid="payment-input"
      />

      {/* Error */}
      {error && (
        <SimpleAlert variant="error" dataTestId="send-error-banner">
          {error}
        </SimpleAlert>
      )}

      {/* Quick action buttons */}
      <div className="flex gap-3">
        <button
          onClick={handlePaste}
          disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-spark-surface border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light transition-colors disabled:opacity-50"
        >
          <ClipboardIcon />
          <span className="font-medium">Paste</span>
        </button>
        <button
          onClick={onScanQr}
          disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-spark-surface border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light transition-colors disabled:opacity-50"
        >
          <QrCodeIcon />
          <span className="font-medium">Scan</span>
        </button>
      </div>

      {/* Continue button */}
      <PrimaryButton
        onClick={() => onContinue(localPaymentInput)}
        disabled={isLoading || !localPaymentInput.trim()}
        className="w-full"
        data-testid="continue-button"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <SpinnerIcon />
            Processing...
          </span>
        ) : 'Continue'}
      </PrimaryButton>
    </div>
  );
};

export default InputStep;
