import React, { useEffect, useState } from 'react';
import { PrimaryButton } from '../../../components/ui';

export interface InputStepProps {
  paymentInput: string;
  isLoading: boolean;
  error: string | null;
  onContinue: (paymentInput: string) => void;
}

const InputStep: React.FC<InputStepProps> = ({ paymentInput, isLoading, error, onContinue }) => {
  const [localPaymentInput, setLocalPaymentInput] = useState<string>(paymentInput || '');

  useEffect(() => {
    setLocalPaymentInput(paymentInput || '');
  }, [paymentInput]);

  return (
    <div className="space-y-6">
      {/* Icon */}
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-2xl bg-spark-electric/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-spark-electric" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
          </svg>
        </div>
      </div>

      {/* Title */}
      <div className="text-center">
        <h3 className="font-display text-lg font-semibold text-spark-text-primary mb-1">
          Where to send?
        </h3>
        <p className="text-spark-text-secondary text-sm">
          Paste an invoice, address, or Lightning URL
        </p>
      </div>

      {/* Input */}
      <div className="space-y-3">
        <textarea
          value={localPaymentInput}
          onChange={(e) => setLocalPaymentInput(e.target.value)}
          placeholder="lnbc... / bc1... / sp1... / user@domain.com"
          className="w-full p-4 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary placeholder-spark-text-muted focus:border-spark-electric focus:ring-2 focus:ring-spark-electric/20 resize-none font-mono text-sm transition-all"
          rows={4}
          disabled={isLoading}
        />

        {/* Supported formats hint */}
        <div className="flex flex-wrap gap-2 justify-center">
          {['Lightning', 'Bitcoin', 'Spark', 'LNURL'].map((type) => (
            <span 
              key={type}
              className="px-2 py-1 text-xs font-medium bg-spark-surface border border-spark-border rounded-lg text-spark-text-muted"
            >
              {type}
            </span>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-spark-error/10 border border-spark-error/30 rounded-xl text-spark-error text-sm">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Continue button */}
        <PrimaryButton
          onClick={() => onContinue(localPaymentInput)}
          disabled={isLoading || !localPaymentInput.trim()}
          className="w-full"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Processing...
            </span>
          ) : 'Continue'}
        </PrimaryButton>
      </div>
    </div>
  );
};

export default InputStep;
