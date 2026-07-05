import React, { useMemo, useState } from 'react';
import type { LnurlWithdrawRequestDetails, LnurlWithdrawResponse } from '@breeztech/breez-sdk-spark';
import { FormError, PrimaryButton, SecondaryButton } from '../../../components/ui';
import { logger, LogCategory } from '../../../services/logger';
import { formatError } from '../../../utils/formatError';
import { formatWithSpaces } from '../../../utils/formatNumber';
import { useInvoicePaid } from '../../../hooks/useInvoicePaid';
import ProcessingStep from '../steps/ProcessingStep';

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
  // LNURL bounds are in msat; withdraw amounts are whole sats. Floor the ceiling
  // and round the floor up so any chosen amount stays inside the server's msat
  // window. A sub-1-sat ceiling (maxWithdrawable < 1000 msat) can't be serviced
  // by a sat-denominated wallet, so surface that rather than rounding up to 1 and
  // sending an over-max request the callback would reject. `minSats` clamps to
  // `maxSats` so a sub-sat-wide range collapses to a single fixed amount.
  const maxSats = useMemo(() => Math.floor(parsed.maxWithdrawable / 1000), [parsed]);
  const unserviceable = maxSats < 1;
  const minSats = useMemo(
    () => Math.min(Math.ceil(parsed.minWithdrawable / 1000), Math.max(maxSats, 1)),
    [parsed, maxSats],
  );
  const isFixed = !unserviceable && minSats === maxSats;

  // Editable amounts default to the max (withdraw everything available).
  const [amount, setAmount] = useState<string>(String(maxSats));
  const [error, setError] = useState<string | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const [invoice, setInvoice] = useState<string | null>(null);

  // Backstop for when lnurlWithdraw resolves before settlement: close once the
  // created invoice is paid. Inert until `invoice` is set.
  useInvoicePaid(invoice, onDone);

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

  const onReceive = async () => {
    if (unserviceable) return;
    const sats = isFixed ? maxSats : amountNum;
    if (sats < minSats || sats > maxSats) {
      setError(`Amount must be between ₿${formatWithSpaces(minSats)} and ₿${formatWithSpaces(maxSats)}`);
      return;
    }

    setError(null);
    setIsWaiting(true);
    try {
      const resp = await onWithdraw(sats);
      // Settled during the call: done. Otherwise keep waiting for the
      // invoice-paid event on the invoice the SDK just posted.
      if (resp.payment) {
        onDone();
        return;
      }
      setInvoice(resp.paymentRequest);
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
            This withdraw link is below the ₿1 minimum this wallet can receive.
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
