import React from 'react';
import { CopyableRow, PrimaryButton, FormError } from '../../../components/ui';
import { useSheetBack } from '../../../components/ui/sheets/BottomSheetCardContext';
import { FeeBreakdownCard, SimpleFeeBreakdown } from '../../../components/FeeBreakdownCard';
import { SpinnerIcon } from '../../../components/Icons';
import { SatAmount } from '../../../components/SatAmount';
import { formatTokenAmount, formatTokenAmountMinimum, tokenAmountDisplaysAsZero } from '../../../utils/tokenFormatting';
import { groupUsd } from '../../../utils/formatNumber';
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

  // The pool takes its cut from the input side, so `amountIn` is the whole
  // figure the token balance loses and the fee is already inside it. Stating
  // the two as a sum would count the fee twice.
  const tokenAmount = isTokenMode && balance.config
    ? groupUsd(formatTokenAmount(BigInt(conversionEstimate!.amountIn), balance.config))
    : null;
  const tokenFee = isTokenMode && balance.config
    ? tokenAmountDisplaysAsZero(BigInt(conversionEstimate!.fee), balance.config)
      ? formatTokenAmountMinimum(balance.config)
      : groupUsd(formatTokenAmount(BigInt(conversionEstimate!.fee), balance.config))
    : null;

  return (
    <div className="space-y-6">
      {/* What the sender holds in stable balance is dollars, so the figure
          that has to agree with the request leads. Sats stay below: they are
          what the invoice settles on, exactly. */}
      <div className="text-center py-4">
        <p className="text-spark-text-muted text-sm mb-2">You're sending</p>
        <div className="text-4xl font-mono font-bold text-spark-text-primary" data-testid="send-total">
          {tokenAmount ? `~${tokenAmount}` : <SatAmount sats={total} />}
        </div>
        {tokenAmount && (
          <p className="mt-2 font-mono text-sm text-spark-text-secondary" data-testid="send-total-sats">
            <SatAmount sats={total} />
          </p>
        )}
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

      {isTokenMode && tokenFee && (
        <FeeBreakdownCard useRawStrings items={[{ label: 'Conversion fee', value: tokenFee }]} />
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
