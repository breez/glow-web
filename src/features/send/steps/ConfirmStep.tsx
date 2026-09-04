import React from 'react';
import { PrimaryButton, SecondaryButton, FormError } from '../../../components/ui';
import { FeeBreakdownCard, SimpleFeeBreakdown } from '../../../components/FeeBreakdownCard';
import { SpinnerIcon, CopyFilledIcon, CheckIcon } from '../../../components/Icons';
import { SatAmount } from '../../../components/SatAmount';
import { formatTokenAmount } from '../../../utils/tokenFormatting';
import { truncateAddress } from '../../../utils/crossChainFormat';
import { copyToClipboard } from '../../../utils/clipboard';
import { logger, LogCategory } from '../../../services/logger';
import { useStableBalance } from '../../../contexts/StableBalanceContext';
import { useBalanceValidation } from '../hooks/useBalanceValidation';
import { toSats } from '../../../types/sats';
import type { ConversionEstimate } from '@breeztech/breez-sdk-spark';

export interface SendDestination {
  label: string;
  value: string;
}

/** Middle-truncated so both ends stay checkable against the source, and the
 *  copy button hands back the untruncated value. */
const DestinationRow: React.FC<SendDestination> = ({ label, value }) => {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = () => {
    copyToClipboard(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(err => {
        logger.error(LogCategory.UI, 'Failed to copy destination to clipboard', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  };

  return (
    <div className="flex items-center gap-2 p-3 bg-spark-dark border border-spark-border rounded-xl">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-spark-text-muted mb-0.5">{label}</p>
        <p className="text-sm font-mono text-spark-text-secondary truncate" title={value} data-testid="send-destination">
          {truncateAddress(value, 32)}
        </p>
      </div>
      <button
        onClick={handleCopy}
        className="shrink-0 p-1.5 rounded-md hover:bg-white/5 transition-colors"
        aria-label={`Copy ${label}`}
      >
        {copied
          ? <CheckIcon size="sm" className="text-spark-success" />
          : <CopyFilledIcon size="sm" className="text-spark-text-secondary" />}
      </button>
    </div>
  );
};

export interface ConfirmStepProps {
  amountSats: bigint | null;
  feesSat: number | null;
  feesIncluded?: boolean;
  conversionEstimate?: ConversionEstimate | null;
  balanceSats?: number;
  tokenBalance?: bigint;
  /** Who the payment pays. Absent only when there is no prepared payment method
   *  to read it from, i.e. the prepare-failed render. */
  destination?: SendDestination;
  error: string | null;
  isLoading: boolean;
  /** Force the send action disabled regardless of the balance check, e.g. when
   *  prepare failed and there is no response to send. */
  disableConfirm?: boolean;
  onBack?: () => void;
  onConfirm: () => void;
}

const ConfirmStep: React.FC<ConfirmStepProps> = ({ amountSats, feesSat, feesIncluded, conversionEstimate, balanceSats, tokenBalance, destination, error, isLoading, disableConfirm, onBack, onConfirm }) => {
  const stableBalance = useStableBalance();
  const isTokenMode = stableBalance.isActive && !!stableBalance.displayConfig && !!conversionEstimate;
  const balance = useBalanceValidation(isTokenMode, undefined, balanceSats, tokenBalance);

  const amount = Number(amountSats || 0n);
  const fee = Number(feesSat || 0);
  const total = feesIncluded ? amount : amount + fee;

  // Convert the total to a validated Sats for the balance check. `total` is
  // sourced from a prepare response so in practice this never exceeds the
  // cap; if it somehow did, treat as insufficient funds.
  const totalSats = toSats(total);
  // The prepare-failed render has no fee and no conversion estimate to check
  // against, so the check reduces to "amount > sat balance" and reports
  // insufficient funds for a wallet holding its balance in a token. Skip it:
  // the prepare error is the one worth showing, and send is disabled anyway.
  const insufficientBalance = !disableConfirm && (totalSats === null
    ? true
    : balance.checkInsufficientFunds({ totalSats, conversionEstimate }));
  const balanceError = insufficientBalance ? 'Insufficient funds' : null;

  // Token-formatted values from conversion estimate
  const tokenAmount = isTokenMode && balance.config
    ? formatTokenAmount(BigInt(conversionEstimate!.amountIn), balance.config)
    : null;
  const tokenFee = isTokenMode && balance.config
    ? formatTokenAmount(BigInt(conversionEstimate!.fee), balance.config, { fullPrecision: true })
    : null;

  return (
    <div className="space-y-6">
      {/* Total amount display — always show sats */}
      <div className="text-center py-4">
        <p className="text-spark-text-muted text-sm mb-2">You're sending</p>
        <div className="flex items-baseline justify-center gap-2">
          <span className="text-4xl font-mono font-bold text-spark-text-primary">
            <SatAmount sats={total} />
          </span>
        </div>
      </div>

      {destination && <DestinationRow {...destination} />}

      {/* Sats breakdown */}
      <SimpleFeeBreakdown amount={feesIncluded ? amount - fee : amount} fee={fee} amountLabel={feesIncluded ? 'Recipient gets' : 'Amount'} />

      {/* Token conversion details */}
      {isTokenMode && tokenAmount && tokenFee && (
        <FeeBreakdownCard
          useRawStrings
          items={[
            { label: 'Conversion amount', value: tokenAmount },
            { label: 'Conversion fee', value: tokenFee },
          ]}
        />
      )}

      <FormError error={balanceError || error} />

      {/* Action buttons */}
      <div className="flex gap-3">
        {onBack && (
          <SecondaryButton onClick={onBack} disabled={isLoading} className="flex-1">
            Back
          </SecondaryButton>
        )}
        <PrimaryButton
          onClick={onConfirm}
          disabled={isLoading || insufficientBalance || disableConfirm}
          className={onBack ? 'flex-1' : 'w-full'}
          data-testid="send-confirm-button"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <SpinnerIcon size="md" />
              Processing...
            </span>
          ) : (
            'Send'
          )}
        </PrimaryButton>
      </div>
    </div>
  );
};

export default ConfirmStep;
