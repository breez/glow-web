import React, { useMemo, useState } from 'react';
import { useWallet } from '../contexts/WalletContext';
import type { DepositInfo, MaxFee } from '@breeztech/breez-sdk-spark';
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

// Derive the initial claim/fee state from the deposit's automatic-claim
// outcome. Pure function so it can be reused as the lazy useState init.
function deriveInitialClaimState(
  deposit: DepositInfo | null,
): { claimError: string | null; requiredFeeSats: number | null } {
  if (!deposit || !deposit.isMature) {
    return { claimError: null, requiredFeeSats: null };
  }
  const claimErrorData = deposit.claimError;
  if (!claimErrorData) {
    return { claimError: null, requiredFeeSats: null };
  }
  if (claimErrorData.type === 'maxDepositClaimFeeExceeded') {
    // Fee exceeded - show required fee for user approval
    return { claimError: null, requiredFeeSats: claimErrorData.requiredFeeSats || 0 };
  }
  if (claimErrorData.type === 'generic') {
    return { claimError: claimErrorData.message || 'Automatic claim failed', requiredFeeSats: null };
  }
  // missingUtxo or other error - can only reject
  return { claimError: 'Automatic claim failed', requiredFeeSats: null };
}

const UnclaimedDepositDetailsPage: React.FC<UnclaimedDepositDetailsPageProps> = ({
  deposit,
  onBack,
  onChanged,
}) => {
  const wallet = useWallet();

  // Parent keys this component on deposit identity, so the prop is
  // stable per mount. claimError stays in useState because handleClaim
  // can update it after a retry; requiredFeeSats is purely derived.
  const initialClaim = useMemo(() => deriveInitialClaimState(deposit), [deposit]);
  const requiredFeeSats = initialClaim.requiredFeeSats;
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [claimError, setClaimError] = useState<string | null>(() => initialClaim.claimError);
  const [isTxIdVisible, setIsTxIdVisible] = useState<boolean>(false);

  const isConfirming = deposit ? !deposit.isMature : false;


  const handleClaim = async () => {
    if (!deposit || requiredFeeSats === null) return;
    setClaimError(null);
    setIsProcessing(true);
    try {
      const maxFee: MaxFee = { type: 'fixed', amount: requiredFeeSats };
      await wallet.claimDeposit({ txid: deposit.txid, vout: deposit.vout, maxFee });
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

          {/* Confirming or pending automatic claim - no action needed */}
          {!claimError && requiredFeeSats === null && (
            <>
              <FeeBreakdownCard
                items={[
                  { label: 'Amount', value: depositAmount, highlight: true },
                ]}
              />

              <p className="text-spark-text-muted text-sm text-center">
                {isConfirming
                  ? 'Waiting for 3 confirmations.'
                  : 'This transfer will be claimed automatically.'}
              </p>
            </>
          )}

          {/* Error message for failed automatic claim (non-fee error) */}
          {claimError && (
            <div className="bg-spark-warning/10 border border-spark-warning/30 rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-spark-warning/20 flex items-center justify-center shrink-0">
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
