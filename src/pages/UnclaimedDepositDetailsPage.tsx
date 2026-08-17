import React, { useState } from 'react';
import { useWallet } from '../contexts/WalletContext';
import type { BreezSdk, DepositInfo, MaxFee } from '@breeztech/breez-sdk-spark';
import { BottomSheetContainer, BottomSheetCard, DialogHeader, PrimaryButton, SecondaryButton, PaymentInfoCard, CollapsibleCodeField } from '../components/ui';
import { FeeBreakdownCard } from '../components/FeeBreakdownCard';
import { SpinnerIcon } from '../components/Icons';
import { AlertCard } from '../components/AlertCard';
import { SatAmount } from '../components/SatAmount';
import { rejectDeposit, removeRejectedDeposit } from '../services/depositState';
import { explorerTxUrl } from '../utils/explorer';
import { logger, LogCategory } from '@/services/logger';

interface UnclaimedDepositDetailsPageProps {
  deposit: DepositInfo | null;
  onBack: () => void;
  onChanged?: () => void;
}

interface ClaimState {
  claimError: string | null;
  requiredFeeSats: number | null;
}

// Derive the claim/fee state from a deposit record's last claim outcome,
// whether that came from an automatic claim or from a manual retry.
function deriveClaimState(deposit: DepositInfo | null): ClaimState {
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

// claimDeposit stores the fresh claim error before it throws, so the deposit
// record already carries the fee the operator just quoted. Re-reading it is
// the only way back to that number: the thrown error crosses the WASM
// boundary as a plain string.
async function refetchClaimState(
  wallet: BreezSdk,
  deposit: DepositInfo,
): Promise<ClaimState | null> {
  try {
    const { deposits } = await wallet.listUnclaimedDeposits({});
    const fresh = deposits.find(d => d.txid === deposit.txid && d.vout === deposit.vout);
    return fresh ? deriveClaimState(fresh) : null;
  } catch {
    return null;
  }
}

const UnclaimedDepositDetailsPage: React.FC<UnclaimedDepositDetailsPageProps> = ({
  deposit,
  onBack,
  onChanged,
}) => {
  const wallet = useWallet();

  // Parent keys this component on deposit identity, so the prop is stable
  // per mount and never picks up a later claim outcome; handleClaim owns
  // the state from the first retry on.
  const [{ claimError, requiredFeeSats }, setClaim] = useState<ClaimState>(() => deriveClaimState(deposit));
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [feeRaised, setFeeRaised] = useState<boolean>(false);
  const [isTxIdVisible, setIsTxIdVisible] = useState<boolean>(false);

  const isConfirming = deposit ? !deposit.isMature : false;


  const handleClaim = async () => {
    if (!deposit || requiredFeeSats === null) return;
    setFeeRaised(false);
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
      // The operator re-quotes on every attempt, so the fee we just sent can
      // already be stale. Retrying at it fails the same way with the same
      // number, so adopt the quote behind the failure when there is one.
      const fresh = await refetchClaimState(wallet, deposit);
      if (fresh?.requiredFeeSats != null && fresh.requiredFeeSats !== requiredFeeSats) {
        setClaim(fresh);
        setFeeRaised(true);
      } else {
        const errorMessage = e instanceof Error ? e.message : 'Failed to claim transfer';
        setClaim({ claimError: errorMessage, requiredFeeSats: null });
      }
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
              href={explorerTxUrl(deposit.txid)}
            />
          </PaymentInfoCard>

          {/* Show fee breakdown only when we have a required fee from claim error */}
          {!claimError && requiredFeeSats !== null && (
            <>
              {feeRaised && (
                <AlertCard variant="warning" title="Network fee changed">
                  <p className="text-sm">
                    The fee rose to <SatAmount sats={requiredFeeSats} /> while you were confirming.
                    Approve to claim at the new fee.
                  </p>
                </AlertCard>
              )}

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
            <AlertCard variant="warning" title="Claim Failed">
              <p className="text-sm">{claimError}</p>
              <p className="text-spark-primary text-sm mt-2">You can reject to process a refund instead.</p>
            </AlertCard>
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
