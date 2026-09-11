import React from 'react';
import { CopyableRow, PrimaryButton, FormError } from '../../../components/ui';
import { useSheetBack } from '../../../components/ui/sheets/BottomSheetCardContext';
import { FeeBreakdownCard, SimpleFeeBreakdown } from '../../../components/FeeBreakdownCard';
import { SpinnerIcon } from '../../../components/Icons';
import { SatAmount } from '../../../components/SatAmount';
import { formatTokenAmount } from '../../../utils/tokenFormatting';
import { truncateAddress } from '../../../utils/crossChainFormat';
import { useStableBalance } from '../../../contexts/StableBalanceContext';
import { useBalanceValidation } from '../hooks/useBalanceValidation';
import { toSats } from '../../../types/sats';
import type { ConversionEstimate } from '@breeztech/breez-sdk-spark';

export interface SendDestination {
  label: string;
  value: string;
}

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
  useSheetBack(isLoading ? undefined : onBack);

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

      {destination && (
        <CopyableRow
          label={destination.label}
          value={destination.value}
          display={truncateAddress(destination.value, 32)}
          data-testid="send-destination"
        />
      )}

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

      <PrimaryButton
        onClick={onConfirm}
        disabled={isLoading || insufficientBalance || disableConfirm}
        className="w-full"
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
  );
};

export default ConfirmStep;
