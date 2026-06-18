import React from 'react';
import { PrimaryButton, SecondaryButton, FormError } from '../../../components/ui';
import { FeeBreakdownCard, SimpleFeeBreakdown } from '../../../components/FeeBreakdownCard';
import { SpinnerIcon } from '../../../components/Icons';
import { formatWithThinSpaces } from '../../../utils/formatNumber';
import { formatTokenAmount } from '../../../utils/tokenFormatting';
import { useStableBalance } from '../../../contexts/StableBalanceContext';
import { useBalanceValidation } from '../hooks/useBalanceValidation';
import { toSats } from '../../../types/sats';
import type { ConversionEstimate } from '@breeztech/breez-sdk-spark';

export interface ConfirmStepProps {
  amountSats: bigint | null;
  feesSat: number | null;
  feesIncluded?: boolean;
  conversionEstimate?: ConversionEstimate | null;
  balanceSats?: number;
  tokenBalance?: bigint;
  error: string | null;
  isLoading: boolean;
  /** Force the send action disabled regardless of the balance check, e.g. when
   *  prepare failed and there is no response to send. */
  disableConfirm?: boolean;
  onBack?: () => void;
  onConfirm: () => void;
}

const ConfirmStep: React.FC<ConfirmStepProps> = ({ amountSats, feesSat, feesIncluded, conversionEstimate, balanceSats, tokenBalance, error, isLoading, disableConfirm, onBack, onConfirm }) => {
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
  const insufficientBalance = totalSats === null
    ? true
    : balance.checkInsufficientFunds({ totalSats, conversionEstimate });
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
            <span className="inline-flex items-center"><span className="text-[0.8em] opacity-70 mr-px">₿</span>{formatWithThinSpaces(total)}</span>
          </span>
        </div>
      </div>

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
