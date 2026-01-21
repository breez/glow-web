import React, { useState, useEffect } from 'react';
import { useWallet } from '../contexts/WalletContext';
import type { DepositInfo, Fee } from '@breeztech/breez-sdk-spark';
import { BottomSheetContainer, BottomSheetCard, DialogHeader, PrimaryButton, SecondaryButton, PaymentInfoCard, CollapsibleCodeField } from '../components/ui';
import { rejectDeposit, removeRejectedDeposit } from '../services/depositState';
import { getSettings } from '../services/settings';

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
  const [estimatedFeeSats, setEstimatedFeeSats] = useState<number>(0);
  const [isTxIdVisible, setIsTxIdVisible] = useState<boolean>(false);

  // Calculate estimated fee based on deposit claim error or user settings
  useEffect(() => {
    if (!deposit) return;

    // Check if deposit has a claim error
    const depositAny = deposit as any;
    const claimErrorData = depositAny.claimError;

    if (claimErrorData) {
      if (claimErrorData.type === 'maxDepositClaimFeeExceeded') {
        // Use the proposed fee from the SDK
        const proposedFee = claimErrorData.requiredFeeSats || 0;
        setEstimatedFeeSats(proposedFee);
        setClaimError(null); // Clear claim error since this is actionable
      } else {
        // Unactionable error - set claim error message
        const errorMsg = claimErrorData.message || claimErrorData.error || 'Cannot claim this transfer';
        setClaimError(errorMsg);
      }
    } else {
      // No claim error - fallback to estimation based on user settings
      setClaimError(null);
      const settings = getSettings();
      const maxFee = settings.depositMaxFee;

      // Estimate transaction size (typical P2WPKH input + output)
      // Average transaction is ~140 vbytes for simple deposit claim
      const estimatedTxSize = 140;

      let feeEstimate = 0;
      if (maxFee.type === 'rate') {
        // Calculate based on sat/vbyte rate
        feeEstimate = (maxFee as any).satPerVbyte * estimatedTxSize;
      } else if (maxFee.type === 'fixed') {
        // Use fixed amount
        feeEstimate = (maxFee as any).amount || 0;
      } else if (maxFee.type === 'networkRecommended') {
        // Use network recommended + leeway
        const leeway = (maxFee as any).leewaySatPerVbyte || 1;
        // Assume base rate of 5 sat/vbyte for network recommended
        feeEstimate = (5 + leeway) * estimatedTxSize;
      }

      setEstimatedFeeSats(Math.ceil(feeEstimate));
    }
  }, [deposit]);


  const handleClaim = async () => {
    setClaimError(null);
    setIsProcessing(true);
    try {
      // Check if we have a proposed fee from claim error
      const depositAny = deposit as any;
      const claimErrorData = depositAny.claimError;

      let fee: Fee;
      if (claimErrorData && claimErrorData.type === 'maxDepositClaimFeeExceeded') {
        // Use the required fee from the SDK error
        const requiredFeeSats = claimErrorData.requiredFeeSats || estimatedFeeSats;
        fee = { type: 'fixed', amount: requiredFeeSats };
      } else {
        // Use the estimated fee (from user settings)
        fee = { type: 'fixed', amount: estimatedFeeSats };
      }

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
  const receiveAmount = depositAmount - estimatedFeeSats;

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

          {/* Fee Approval UI - only show if deposit is claimable */}
          {!claimError && (
            <>
              {/* Breakdown */}
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
                    {formatWithSpaces(estimatedFeeSats)} sats
                  </span>
                </div>

                <div className="border-t border-spark-border/50" />

                <div className="flex justify-between items-center py-2">
                  <span className="text-spark-text-primary font-semibold">Total</span>
                  <span className="font-mono font-bold text-spark-primary">
                    {formatWithSpaces(receiveAmount)} sats
                  </span>
                </div>

                <p className="text-spark-text-muted text-xs pt-1">
                  Expect fee variation based on network usage.
                </p>
              </div>

              <p className="text-spark-text-muted text-sm text-center">
                Approve to claim this transfer, or reject to process a refund.
              </p>
            </>
          )}

          {/* Message for unclaimable transfers */}
          {claimError && (
            <div className="bg-spark-warning/10 border border-spark-warning/30 rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-spark-warning/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-spark-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 className="font-display font-bold text-spark-warning">Cannot Claim Transfer</h3>
              </div>
              <div className="pl-[52px]">
                <p className="text-spark-error text-sm">{claimError}</p>
                <p className="text-spark-primary text-sm mt-2">You can reject to process a refund instead.</p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            {claimError ? (
              <SecondaryButton onClick={handleReject} disabled={isProcessing} className="flex-1">
                Reject
              </SecondaryButton>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default UnclaimedDepositDetailsPage;
