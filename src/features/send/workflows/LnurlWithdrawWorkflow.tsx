import React, { useMemo, useState } from 'react';
import type { LnurlWithdrawRequestDetails, LnurlWithdrawResponse } from '@breeztech/breez-sdk-spark';
import { FormError, PrimaryButton, SecondaryButton } from '../../../components/ui';
import { logger, LogCategory } from '../../../services/logger';
import { formatError } from '../../../utils/formatError';
import { formatWithSpaces } from '../../../utils/formatNumber';
import ProcessingStep from '../steps/ProcessingStep';

// Seconds the SDK waits for the withdrawal to settle before returning. The SDK
// bounds the wait, so the await resolves with the outcome (a settled payment or
// not) and the spinner can't hang.
export const LNURL_WITHDRAW_COMPLETION_TIMEOUT_SECS = 60;

interface LnurlWithdrawWorkflowProps {
  parsed: LnurlWithdrawRequestDetails;
  onBack: () => void;
  /** Runs the withdrawal for `amountSats`. The SDK creates the invoice and posts
   *  it to the LNURL callback; the funds arrive as an ordinary Lightning receive. */
  onWithdraw: (amountSats: number) => Promise<LnurlWithdrawResponse>;
  /** Close the flow once the incoming payment is confirmed. The app-wide
   *  "Payment Received" celebration is driven by the SDK event, not here. */
  onDone: () => void;
}

const LnurlWithdrawWorkflow: React.FC<LnurlWithdrawWorkflowProps> = ({ parsed, onBack, onWithdraw, onDone }) => {
  // LNURL bounds are in msat; this wallet receives whole sats. Round the floor up
  // and the ceiling down so any chosen amount stays inside the server's msat
  // window, and require at least 1 sat. If no whole sat fits that window (a
  // sub-1-sat ceiling, or a range narrower than a sat that straddles a boundary),
  // maxSats < minSats and the link is unserviceable.
  const maxSats = useMemo(() => Math.floor(parsed.maxWithdrawable / 1000), [parsed]);
  const minSats = useMemo(() => Math.max(1, Math.ceil(parsed.minWithdrawable / 1000)), [parsed]);
  const unserviceable = maxSats < minSats;
  const isFixed = !unserviceable && minSats === maxSats;

  // Editable amounts default to the max (withdraw everything available).
  const [amount, setAmount] = useState<string>(String(maxSats));
  const [error, setError] = useState<string | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);

  const description = parsed.defaultDescription?.trim();
  const sourceHost = useMemo(() => {
    try {
      return new URL(parsed.callback).host;
    } catch {
      return null;
    }
  }, [parsed]);

  const amountNum = parseInt(amount, 10) || 0;
  const outOfRange = amountNum > 0 && (amountNum < minSats || amountNum > maxSats);
  const validAmount = !unserviceable && (isFixed || (amountNum > 0 && !outOfRange));
  const inlineError = !isFixed && !unserviceable && outOfRange
    ? amountNum < minSats
      ? `Amount must be at least ₿${formatWithSpaces(minSats)}`
      : `Amount must be at most ₿${formatWithSpaces(maxSats)}`
    : null;

  // Reached only with a valid, in-range amount: the Receive button is disabled
  // otherwise. The SDK waits up to completionTimeoutSecs for settlement, so the
  // await resolves with the outcome and the spinner can't hang.
  const onReceive = async () => {
    const sats = isFixed ? maxSats : amountNum;
    setError(null);
    setIsWaiting(true);
    try {
      const resp = await onWithdraw(sats);
      if (resp.payment) {
        onDone();
        return;
      }
      // Completion window elapsed without settlement.
      setError('The payment did not arrive in time. Please try again.');
      setIsWaiting(false);
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'LNURL withdraw failed', { error: formatError(err) });
      setError(`Withdraw failed: ${formatError(err)}`);
      setIsWaiting(false);
    }
  };

  if (isWaiting) {
    return <ProcessingStep operationType="withdraw" />;
  }

  return (
    <div className="space-y-5">
      {(description || sourceHost) && (
        <div className="text-center">
          {description && <p className="text-spark-text-primary font-medium">{description}</p>}
          {sourceHost && <p className="text-spark-text-secondary text-sm mt-1">from {sourceHost}</p>}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-spark-text-primary">
            Amount to receive
          </label>
          {!isFixed && !unserviceable && (
            <span className="text-xs text-spark-text-secondary">
              {formatWithSpaces(minSats)} – {formatWithSpaces(maxSats)} sats
            </span>
          )}
        </div>

        {unserviceable ? (
          <div className="w-full p-4 bg-spark-dark border border-spark-border rounded-xl text-spark-text-secondary text-sm text-center">
            This withdraw link has no valid amount this wallet can receive.
          </div>
        ) : isFixed ? (
          <div className="w-full p-4 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary flex items-center justify-center text-2xl font-semibold">
            <span className="inline-flex items-center">
              <span className="text-[0.8em] opacity-70 mr-px">₿</span>
              {formatWithSpaces(maxSats)}
            </span>
          </div>
        ) : (
          <input
            type="number"
            inputMode="numeric"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(null); }}
            placeholder={`Between ${formatWithSpaces(minSats)} and ${formatWithSpaces(maxSats)} sats`}
            className="w-full p-4 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary placeholder-spark-text-muted focus:border-spark-electric focus:ring-2 focus:ring-spark-electric/20 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            min={minSats}
            max={maxSats}
          />
        )}
      </div>

      <FormError error={inlineError || error} />

      <div className="flex gap-3">
        <SecondaryButton onClick={onBack} className="flex-1">
          Back
        </SecondaryButton>
        <PrimaryButton onClick={onReceive} disabled={!validAmount} className="flex-1">
          Receive
        </PrimaryButton>
      </div>
    </div>
  );
};

export default LnurlWithdrawWorkflow;
