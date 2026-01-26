import React, { useEffect, useMemo, useState } from 'react';
import type { LnurlPayRequestDetails, PrepareLnurlPayRequest, PrepareLnurlPayResponse } from '@breeztech/breez-sdk-spark';
import type { PaymentStep } from '../../../types/domain';
import { FormError, PrimaryButton, SecondaryButton } from '../../../components/ui';
import ConfirmStep from '../steps/ConfirmStep';

interface LnurlWorkflowProps {
  parsed: LnurlPayRequestDetails;
  onBack: () => void;
  onRun: (runner: () => Promise<void>) => Promise<void>;
  onPrepare: (args: PrepareLnurlPayRequest) => Promise<PrepareLnurlPayResponse>;
  onPay: (prepareResponse: PrepareLnurlPayResponse) => Promise<void>;
}

const LnurlWorkflow: React.FC<LnurlWorkflowProps> = ({ parsed, onBack, onRun, onPrepare, onPay }) => {

  const [step, setStep] = useState<PaymentStep>('amount');
  const [amount, setAmount] = useState<string>('');
  const [comment, setComment] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [prepareResponse, setPrepareResponse] = useState<PrepareLnurlPayResponse | null>(null);

  // derive constraints
  const minSats = useMemo(() => {
    const msat = parsed.minSendable ?? 0;
    return Math.ceil(msat / 1000);
  }, [parsed]);
  const maxSats = useMemo(() => {
    const msat = parsed.maxSendable ?? 0;
    return Math.max(1, Math.floor(msat / 1000));
  }, [parsed]);
  const commentMaxLen = parsed.commentAllowed ?? 0;
  const commentAllowed = commentMaxLen > 0;
  const description = useMemo(() => {
    let metadataArr = JSON.parse(parsed.metadataStr);
    for (let i = 0; i < metadataArr.length; i++) {
      if (metadataArr[i][0] === "text/plain") {
        return metadataArr[i][1];
      }
    }
    return parsed.url;
  }, [parsed]);

  useEffect(() => {
    setError(null);
  }, [step]);

  const onAmountNext = async () => {
    const sats = parseInt(amount, 10);
    if (!sats || sats <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (minSats && sats < minSats) {
      setError(`Amount must be at least ${minSats} sats`);
      return;
    }
    if (maxSats && sats > maxSats) {
      setError(`Amount must be at most ${maxSats} sats`);
      return;
    }
    if (commentAllowed && commentMaxLen && comment.length > commentMaxLen) {
      setError(`Comment must be at most ${commentMaxLen} characters`);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const resp = await onPrepare({ amountSats: sats, comment: comment ? comment : undefined, payRequest: parsed });
      setPrepareResponse(resp);
      setStep('confirm');
    } catch (err) {
      console.error('Failed to prepare LNURL Pay:', err);
      setError(`Failed to prepare LNURL Pay: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const onConfirm = async () => {
    if (!prepareResponse) return;
    await onRun(() => onPay(prepareResponse));
  };

  const feesSat: number | null = useMemo(() => {
    return prepareResponse?.feeSats ?? null;
  }, [prepareResponse]);

  if (step === 'confirm' && prepareResponse) {
    return (
      <ConfirmStep amountSats={BigInt(parseInt(amount, 10))} feesSat={feesSat} error={error} isLoading={isLoading} onConfirm={onConfirm} />
    );
  }

  const amountNum = parseInt(amount) || 0;

  // amount + optional comment form
  return (
    <div className="space-y-5">
      {/* Description */}
      <div className="text-center">
        <p className="text-spark-text-primary font-medium">{description}</p>
      </div>

      {/* Amount input */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-spark-text-primary">Amount (sats)</label>
          <span className="text-xs text-spark-text-secondary">
            {minSats.toLocaleString('en-US').replace(/,/g, ' ')} – {maxSats.toLocaleString('en-US').replace(/,/g, ' ')}
          </span>
        </div>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`Between ${minSats.toLocaleString('en-US').replace(/,/g, ' ')} and ${maxSats.toLocaleString('en-US').replace(/,/g, ' ')} sats`}
          className="w-full p-4 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary placeholder-spark-text-muted focus:border-spark-electric focus:ring-2 focus:ring-spark-electric/20 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          disabled={isLoading}
          min={minSats}
          max={maxSats}
        />
        
        {/* Quick amount buttons */}
        <div className="flex gap-2 mt-3">
          {[100, 1000, 10000, 100000].filter(v => v >= minSats && v <= maxSats).slice(0, 4).map((quickAmount) => (
            <button
              key={quickAmount}
              onClick={() => setAmount(String(quickAmount))}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                amountNum === quickAmount
                  ? 'bg-spark-primary text-white'
                  : 'bg-transparent border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
              }`}
            >
              {quickAmount.toLocaleString('en-US').replace(/,/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Optional comment */}
      {commentAllowed && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-spark-text-primary">Comment (optional)</label>
            <span className="text-xs text-spark-text-secondary">{comment.length}/{commentMaxLen}</span>
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a message..."
            className="w-full p-4 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary placeholder-spark-text-muted focus:border-spark-electric focus:ring-2 focus:ring-spark-electric/20 resize-none transition-all"
            rows={3}
            maxLength={commentMaxLen}
            disabled={isLoading}
          />
        </div>
      )}

      <FormError error={error} />

      {/* Action buttons */}
      <div className="flex gap-3 pt-2">
        <SecondaryButton onClick={onBack} disabled={isLoading} className="flex-1">
          Back
        </SecondaryButton>
        <PrimaryButton onClick={onAmountNext} disabled={isLoading || !amount} className="flex-1">
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
    </div>
  );
};

export default LnurlWorkflow;
