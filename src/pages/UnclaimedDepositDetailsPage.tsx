import React, { useState, useEffect } from 'react';
import { useWallet } from '../contexts/WalletContext';
import type { DepositInfo, Fee } from '@breeztech/breez-sdk-spark';
import { BottomSheetContainer, BottomSheetCard, DialogHeader, PrimaryButton, SecondaryButton, PaymentInfoCard, CollapsibleCodeField } from '../components/ui';
import { rejectDeposit, removeRejectedDeposit } from '../services/depositState';

// Format number with space as thousand separator
const formatWithSpaces = (num: number): string => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};

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
      console.error('Failed to claim transfer:', e);
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
        <BottomSheetCard className="bottom-sheet-card">
          <div></div>
        </BottomSheetCard>
      </BottomSheetContainer>
    );
  }

  const depositAmount = deposit.amountSats;
  const receiveAmount = requiredFeeSats !== null ? depositAmount - requiredFeeSats : depositAmount;

  return (
    <BottomSheetContainer isOpen={deposit != null} onClose={handleClose}>
      <BottomSheetCard className="bottom-sheet-card">
        <DialogHeader title="BTC Transfer" onClose={handleClose} />
        <div className="space-y-4 overflow-y-auto">
          {/* Transaction ID */}
          <PaymentInfoCard>
            <CollapsibleCodeField
              label="Transaction ID"
              value={deposit.txid}
              isVisible={isTxIdVisible}
              onToggle={() => setIsTxIdVisible(!isTxIdVisible)}
            />
          </PaymentInfoCard>

          {/* Show fee breakdown only when we have a required fee from claim error */}
          {!claimError && requiredFeeSats !== null && (
            <>
              <div className="bg-spark-dark/50 border border-spark-border rounded-2xl px-4 py-3">
                <div className="flex justify-between items-center py-2">
                  <span className="text-spark-text-secondary text-sm">Amount</span>
                  <span className="font-mono text-sm text-spark-text-primary">
                    {formatWithSpaces(depositAmount)} sats
                  </span>
                </div>

                <div className="border-t border-spark-border/50" />

                <div className="flex justify-between items-center py-2">
                  <span className="text-spark-text-secondary text-sm">Network fee</span>
                  <span className="font-mono text-sm text-spark-text-primary">
                    {formatWithSpaces(requiredFeeSats)} sats
                  </span>
                </div>

                <div className="border-t border-spark-border/50" />

                <div className="flex justify-between items-center py-2">
                  <span className="text-spark-text-primary font-semibold">You receive</span>
                  <span className="font-mono font-bold text-spark-primary">
                    {formatWithSpaces(receiveAmount)} sats
                  </span>
                </div>
              </div>

              <p className="text-spark-text-muted text-sm text-center">
                Approve to claim this transfer, or reject to process a refund.
              </p>
            </>
          )}

          {/* Pending automatic claim - no action needed */}
          {!claimError && requiredFeeSats === null && (
            <>
              <div className="bg-spark-dark/50 border border-spark-border rounded-2xl px-4 py-3">
                <div className="flex justify-between items-center py-2">
                  <span className="text-spark-text-secondary text-sm">Amount</span>
                  <span className="font-mono text-lg font-bold text-spark-primary">
                    {formatWithSpaces(depositAmount)} sats
                  </span>
                </div>
              </div>

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
                  <svg className="w-5 h-5 text-spark-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
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
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
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
