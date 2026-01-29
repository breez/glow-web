import React, { useState, useEffect } from 'react';
import { useWallet } from '../contexts/WalletContext';
import type { DepositInfo, Fee } from '@breeztech/breez-sdk-spark';
import { BottomSheetContainer, BottomSheetCard, DialogHeader, PrimaryButton, SecondaryButton, PaymentInfoCard, CollapsibleCodeField } from '../components/ui';
import { FeeBreakdownCard } from '../components/FeeBreakdownCard';
import { SpinnerIcon, WarningIcon } from '../components/Icons';
import { rejectDeposit, removeRejectedDeposit } from '../services/depositState';
import { logger, LogCategory } from '@/services/logger';

interface UnclaimedDepositDetailsPageProps {
  deposit: DepositInfo | null;
  onBack: () => void;
  onChanged?: () => void;
}

const UnclaimedDepositDetailsPage: React.FC<UnclaimedDepositDetailsPageProps> = ({
  deposit,
  onBack,
  onChanged,
}) => {
  const wallet = useWallet();

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [requiredFeeSats, setRequiredFeeSats] = useState<number | null>(null);
  const [isTxIdVisible, setIsTxIdVisible] = useState<boolean>(false);

  // Check if deposit has a claim error from automatic claim attempt
  useEffect(() => {
    if (!deposit) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK deposit type doesn't expose claimError
    const depositAny = deposit as any;
    const claimErrorData = depositAny.claimError;

    if (claimErrorData) {
      if (claimErrorData.type === 'maxDepositClaimFeeExceeded') {
        // Fee exceeded - show required fee for user approval
        setRequiredFeeSats(claimErrorData.requiredFeeSats || 0);
        setClaimError(null);
      } else {
        // Other error - can only reject
        const errorMsg = claimErrorData.message || claimErrorData.error || 'Automatic claim failed';
        setClaimError(errorMsg);
        setRequiredFeeSats(null);
      }
    } else {
      setClaimError(null);
      setRequiredFeeSats(null);
    }
  }, [deposit]);


  const handleClaim = async () => {
    if (!deposit || requiredFeeSats === null) return;
    setClaimError(null);
    setIsProcessing(true);
    try {
      const fee: Fee = { type: 'fixed', amount: requiredFeeSats };
      await wallet.claimDeposit(deposit.txid, deposit.vout, fee);
      // Remove from rejected list if it was there
      removeRejectedDeposit(deposit.txid, deposit.vout);
      onChanged?.();
      handleClose();
    } catch (e) {
      logger.error(LogCategory.PAYMENT, 'Failed to claim transfer', {
        error: e instanceof Error ? e.message : String(e),
      });
      const errorMessage = e instanceof Error ? e.message : 'Failed to claim transfer';
      setClaimError(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = () => {
    if (!deposit) return;
    // Mark transfer as rejected
    rejectDeposit(deposit.txid, deposit.vout);
    onChanged?.();
    handleClose();
  };

  const handleClose = () => {
    onBack();
  };

  if (!deposit) {
    return (
      <BottomSheetContainer isOpen={false} onClose={handleClose}>
        <BottomSheetCard>
          <div></div>
        </BottomSheetCard>
      </BottomSheetContainer>
    );
  }

  const depositAmount = deposit.amountSats;
  const receiveAmount = requiredFeeSats !== null ? depositAmount - requiredFeeSats : depositAmount;

  return (
    <BottomSheetContainer isOpen={deposit != null} onClose={handleClose}>
      <BottomSheetCard>
        <DialogHeader title="BTC Transfer" onClose={handleClose} />
        <div className="space-y-4 overflow-y-auto">
          {/* Transaction ID */}
          <PaymentInfoCard>
            <CollapsibleCodeField
              label="Transaction ID"
              value={deposit.txid}
              isVisible={isTxIdVisible}
              onToggle={() => setIsTxIdVisible(prev => !prev)}
            />
          </PaymentInfoCard>

          {/* Show fee breakdown only when we have a required fee from claim error */}
          {!claimError && requiredFeeSats !== null && (
            <>
              <FeeBreakdownCard
                items={[
                  { label: 'Amount', value: depositAmount },
                  { label: 'Network fee', value: requiredFeeSats },
                  { label: 'You receive', value: receiveAmount, highlight: true },
                ]}
              />

              <p className="text-spark-text-muted text-sm text-center">
                Approve to claim this transfer, or reject to process a refund.
              </p>
            </>
          )}

          {/* Pending automatic claim - no action needed */}
          {!claimError && requiredFeeSats === null && (
            <>
              <FeeBreakdownCard
                items={[
                  { label: 'Amount', value: depositAmount, highlight: true },
                ]}
              />

              <p className="text-spark-text-muted text-sm text-center">
                This transfer will be claimed automatically.
              </p>
            </>
          )}

          {/* Error message for failed automatic claim (non-fee error) */}
          {claimError && (
            <div className="bg-spark-warning/10 border border-spark-warning/30 rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-spark-warning/20 flex items-center justify-center flex-shrink-0">
                  <WarningIcon size="md" className="text-spark-warning" />
                </div>
                <h3 className="font-display font-bold text-spark-warning">Claim Failed</h3>
              </div>
              <div className="pl-[52px]">
                <p className="text-spark-error text-sm">{claimError}</p>
                <p className="text-spark-primary text-sm mt-2">You can reject to process a refund instead.</p>
              </div>
            </div>
          )}

          {/* Action Buttons - Approve/Reject for fee exceeded, hide when claim error shown */}
          {requiredFeeSats !== null && !claimError && (
            <div className="flex gap-3">
              <SecondaryButton onClick={handleReject} disabled={isProcessing} className="flex-1">
                Reject
              </SecondaryButton>
              <PrimaryButton onClick={handleClaim} disabled={isProcessing} className="flex-1">
                {isProcessing ? (
                  <span className="flex items-center justify-center gap-2">
                    <SpinnerIcon size="md" />
                    Processing...
                  </span>
                ) : (
                  'Approve'
                )}
              </PrimaryButton>
            </div>
          )}

          {/* Only Reject button when claim error is shown */}
          {claimError && (
            <SecondaryButton onClick={handleReject} disabled={isProcessing} className="w-full">
              Reject
            </SecondaryButton>
          )}
        </div>
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default UnclaimedDepositDetailsPage;
