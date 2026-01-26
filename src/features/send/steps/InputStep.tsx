import React, { useEffect, useState } from 'react';
import { PrimaryButton } from '../../../components/ui';

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
      console.error('Failed to read clipboard:', err);
    }
  };

  return (
    <div className="flex flex-col gap-4 py-2">
      {/* Input */}
      <textarea
        value={localPaymentInput}
        onChange={(e) => setLocalPaymentInput(e.target.value)}
        placeholder="lnbc... / bc1... / sp1... / user@domain.com"
        className="w-full p-4 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary placeholder-spark-text-muted focus:border-spark-electric focus:ring-2 focus:ring-spark-electric/20 resize-none font-mono text-sm transition-all"
        rows={3}
        disabled={isLoading}
      />

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-spark-error/10 border border-spark-error/30 rounded-xl text-spark-error text-sm">
          <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Quick action buttons */}
      <div className="flex gap-3">
        <button
          onClick={handlePaste}
          disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-spark-surface border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light transition-colors disabled:opacity-50"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span className="font-medium">Paste</span>
        </button>
        <button
          onClick={onScanQr}
          disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-spark-surface border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light transition-colors disabled:opacity-50"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3 11h8V3H3v8zm2-6h4v4H5V5zM3 21h8v-8H3v8zm2-6h4v4H5v-4zM13 3v8h8V3h-8zm6 6h-4V5h4v4zM19 13h2v2h-2zM13 13h2v2h-2zM15 15h2v2h-2zM13 17h2v2h-2zM15 19h2v2h-2zM17 17h2v2h-2zM17 13h2v2h-2zM19 15h2v2h-2zM19 19h2v2h-2z" />
          </svg>
          <span className="font-medium">Scan</span>
        </button>
      </div>

      {/* Continue button */}
      <PrimaryButton
        onClick={() => onContinue(localPaymentInput)}
        disabled={isLoading || !localPaymentInput.trim()}
        className="w-full"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-5 h-5 animate-spin">
              <svg className="w-full h-full" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </span>
            Processing...
          </span>
        ) : 'Continue'}
      </PrimaryButton>
    </div>
  );
};

export default InputStep;
