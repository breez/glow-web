import React, { useCallback, useEffect, useState } from 'react';
import { useWallet } from '../contexts/WalletContext';
import type { DepositInfo, Fee, SdkEvent } from '@breeztech/breez-sdk-spark';
import { LoadingSpinner, PrimaryButton, BottomSheetContainer, BottomSheetCard, DialogHeader, CollapsibleCodeField, CopyableRow, PaymentInfoCard } from '../components/ui';
import { AlertCard, SimpleAlert } from '../components/AlertCard';
import { FeeBreakdownCard } from '../components/FeeBreakdownCard';
import { CheckIcon } from '../components/Icons';
import { FeeRateSelector, type FeeSpeed } from '../components/FeeRateSelector';
import { isDepositRejected, removeRejectedDeposit } from '../services/depositState';
import { SatAmount } from '../components/SatAmount';
import { DestinationField } from '../components/DestinationField';
import QrScannerDialog from '../components/QrScannerDialog';
import ProcessingStep from '../features/send/steps/ProcessingStep';
import ResultStep from '../features/send/steps/ResultStep';
import { destinationAddressOf } from '../utils/destinationAddress';
import { truncateAddress } from '../utils/crossChainFormat';
import { explorerTxUrl } from '../utils/explorer';
import SlideInPage from '@/components/layout/SlideInPage';
import { logger, LogCategory } from '@/services/logger';

interface GetRefundPageProps {
  onBack: () => void;
  animationDirection?: 'left' | 'up';
}

type RefundStep = 'address' | 'fee' | 'confirm' | 'processing' | 'result';

// A refund spends the deposit's one taproot input to one output: 111 vB when
// that output is taproot or P2WSH, less for other address types. Pricing at
// the largest size never pays below the rate picked.
const REFUND_VSIZE = 111;

const GetRefundPage: React.FC<GetRefundPageProps> = ({ onBack, animationDirection = 'left' }) => {
  const wallet = useWallet();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [deposits, setDeposits] = useState<DepositInfo[]>([]);

  // Refund flow state
  const [selectedDeposit, setSelectedDeposit] = useState<DepositInfo | null>(null);
  const [isRefundFlowOpen, setIsRefundFlowOpen] = useState<boolean>(false);
  const [refundStep, setRefundStep] = useState<RefundStep>('address');
  const [destination, setDestination] = useState<string>('');
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [selectedFeeRate, setSelectedFeeRate] = useState<FeeSpeed | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundTxId, setRefundTxId] = useState<string | null>(null);
  const [isTxIdVisible, setIsTxIdVisible] = useState<boolean>(false);

  const [feeRates, setFeeRates] = useState<Record<FeeSpeed, number> | null>(null);
  const [feeRatesError, setFeeRatesError] = useState<string | null>(null);

  // State for expandable transaction ID fields in examples
  const [expandedTxIds, setExpandedTxIds] = useState<Record<string, boolean>>({});

  // Check if deposit has been refunded
  const hasRefundTx = (deposit: DepositInfo) => Boolean(deposit.refundTxId);

  const getRefundTxId = (deposit: DepositInfo) => deposit.refundTxId ?? null;

  // Pure fetch: returns the sorted list, leaves setState to callers so
  // the mount effect can commit post-await.
  const fetchRejectedDeposits = useCallback(async (): Promise<DepositInfo[]> => {
    const list = (await wallet.listUnclaimedDeposits({})).deposits;
    // Only show deposits that have been rejected
    const rejectedDeposits = list.filter(d => isDepositRejected(d.txid, d.vout));

    // Sort: non-broadcasted (no refundTxId) first, then broadcasted
    return rejectedDeposits.sort((a, b) => {
      const aHasRefund = hasRefundTx(a);
      const bHasRefund = hasRefundTx(b);

      // Non-broadcasted (false) should come before broadcasted (true)
      if (aHasRefund === bHasRefund) return 0;
      return aHasRefund ? 1 : -1;
    });
  }, [wallet]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const sortedDeposits = await fetchRejectedDeposits();
      setDeposits(sortedDeposits);
    } catch (e) {
      logger.error(LogCategory.PAYMENT, 'Failed to load rejected deposits', {
        error: e instanceof Error ? e.message : String(e),
      });
      setError('Failed to load rejected deposits');
    } finally {
      setIsLoading(false);
    }
  }, [fetchRejectedDeposits]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const sortedDeposits = await fetchRejectedDeposits();
        if (cancelled) return;
        setDeposits(sortedDeposits);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        logger.error(LogCategory.PAYMENT, 'Failed to load rejected deposits', {
          error: e instanceof Error ? e.message : String(e),
        });
        setError('Failed to load rejected deposits');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchRejectedDeposits]);

  useEffect(() => {
    let listenerId: string | null = null;
    (async () => {
      try {
        listenerId = await wallet.addEventListener({ onEvent: (event: SdkEvent) => {
          if (event.type === 'synced' || event.type === 'claimedDeposits' || event.type === 'unclaimedDeposits') {
            void load();
          }
        } });
      } catch (e) {
        logger.warn(LogCategory.SDK, 'Failed to attach refund page event listener', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();

    return () => {
      if (listenerId) {
        wallet.removeEventListener(listenerId).catch(() => { });
      }
    };
  }, [wallet, load]);


  const openRefundFlow = (deposit: DepositInfo) => {
    setSelectedDeposit(deposit);
    setDestination('');
    setDestinationError(null);
    setSelectedFeeRate(null);
    setRefundError(null);
    setRefundTxId(null);
    setRefundStep('address');
    setIsRefundFlowOpen(true);
  };

  const closeRefundFlow = () => {
    setIsRefundFlowOpen(false);
    setSelectedDeposit(null);
  };

  // The exit flow's parse: a scanned receive QR is a BIP21 URI.
  const handleContinueToFeeSelection = async () => {
    const trimmed = destination.trim();
    if (!selectedDeposit || !trimmed) return;
    const address = destinationAddressOf(await wallet.parse(trimmed).catch(() => null));
    if (!address) {
      setDestinationError('That is not an on-chain Bitcoin address');
      return;
    }
    setDestination(address);
    setDestinationError(null);
    setRefundStep('fee');
    void loadFeeRates();
  };

  // Current rates on every visit from the address step, as the exit flow reads them.
  const loadFeeRates = async () => {
    setFeeRates(null);
    setFeeRatesError(null);
    try {
      const fees = await wallet.recommendedFees();
      setFeeRates({
        slow: Math.max(1, fees.hourFee),
        medium: Math.max(1, fees.halfHourFee),
        fast: Math.max(1, fees.fastestFee),
      });
    } catch (e) {
      logger.error(LogCategory.PAYMENT, 'Failed to read fee rates for a refund', {
        error: e instanceof Error ? e.message : String(e),
      });
      setFeeRatesError("Couldn't read the current fee rates. Go back and try again.");
    }
  };

  // Paid as a fixed amount, so confirm shows the exact fee and what arrives.
  const feeFor = (speed: FeeSpeed) => (feeRates ? Math.ceil(feeRates[speed] * REFUND_VSIZE) : 0);

  const handleRefund = async () => {
    if (!selectedDeposit || !selectedFeeRate || !destination.trim()) return;

    setIsProcessing(true);
    setRefundError(null);
    setRefundStep('processing');

    try {
      const fee: Fee = { type: 'fixed', amount: feeFor(selectedFeeRate) };
      const result = await wallet.refundDeposit({ txid: selectedDeposit.txid, vout: selectedDeposit.vout, destinationAddress: destination.trim(), fee });

      // Remove from rejected list after successful refund
      removeRejectedDeposit(selectedDeposit.txid, selectedDeposit.vout);

      setRefundTxId(result.txId || null);
      setRefundStep('result');

      await load();
    } catch (e) {
      logger.error(LogCategory.PAYMENT, 'Failed to refund deposit', {
        error: e instanceof Error ? e.message : String(e),
      });
      setRefundError(e instanceof Error ? e.message : 'Failed to refund deposit');
      setRefundStep('confirm');
    } finally {
      setIsProcessing(false);
    }
  };

  const getSelectedFee = () => (selectedFeeRate ? feeFor(selectedFeeRate) : 0);

  const getRefundAmount = () => {
    if (!selectedDeposit) return 0;
    return selectedDeposit.amountSats - getSelectedFee();
  };

  return (
    <SlideInPage title="Get Refund" onClose={onBack} slideFrom={animationDirection}>
      <div className="p-4">
        <div className="max-w-xl mx-auto w-full space-y-6">
          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {isLoading && (
              <div className="py-16 flex justify-center">
                <LoadingSpinner text="Loading rejected deposits..." />
              </div>
            )}

            {error && (
              <SimpleAlert variant="error">{error}</SimpleAlert>
            )}

            {!isLoading && deposits.length === 0 && (
              <div className="py-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-spark-success/20 flex items-center justify-center mx-auto mb-4">
                  <CheckIcon size="xl" className="text-spark-success" />
                </div>
                <h3 className="font-display font-semibold text-spark-text-primary mb-2">All Clear!</h3>
                <p className="text-spark-text-muted text-sm">No rejected deposits pending refund.</p>
              </div>
            )}

            {!isLoading && deposits.length > 0 && (
              <div className="space-y-4">
                {deposits.map((dep, idx) => {
                  const amount = dep.amountSats;
                  const isRefunded = hasRefundTx(dep);
                  const refundedTxId = getRefundTxId(dep);
                  const txKey = `deposit-tx-${idx}`;
                  const refundKey = `deposit-refund-${idx}`;
                  // Marks which deposit the open sheet is refunding: the
                  // sheet covers only part of the list behind it.
                  const isSelected = isRefundFlowOpen
                    && selectedDeposit?.txid === dep.txid
                    && selectedDeposit?.vout === dep.vout;
                  const borderClass = isSelected
                    ? 'border-spark-primary'
                    : isRefunded ? 'border-spark-success/30' : 'border-spark-border';

                  return (
                    <div
                      key={idx}
                      className={`bg-spark-dark/50 border ${borderClass} rounded-2xl p-5 space-y-4`}
                    >
                      {/* Amount */}
                      <div className="flex items-center justify-between py-2">
                        <span className="text-spark-text-secondary text-sm">Amount</span>
                        <span className="font-mono text-sm font-medium text-spark-text-primary">
                          <SatAmount sats={amount} />
                        </span>
                      </div>

                      {/* Transaction IDs */}
                      <div className="space-y-2">
                        <CollapsibleCodeField
                          label="Transaction ID"
                          value={dep.txid}
                          isVisible={expandedTxIds[txKey] || false}
                          onToggle={() => setExpandedTxIds(prev => ({ ...prev, [txKey]: !prev[txKey] }))}
                          href={explorerTxUrl(dep.txid)}
                        />

                        {isRefunded && refundedTxId && (
                          <CollapsibleCodeField
                            label="Refund Transaction ID"
                            value={refundedTxId}
                            isVisible={expandedTxIds[refundKey] || false}
                            onToggle={() => setExpandedTxIds(prev => ({ ...prev, [refundKey]: !prev[refundKey] }))}
                            href={explorerTxUrl(refundedTxId)}
                          />
                        )}
                      </div>

                      {/* Continue button - disabled if refund is being processed */}
                      <div>
                        {isRefunded ? (
                          <button disabled className="w-full px-4 py-3 bg-spark-electric/15 text-spark-electric rounded-xl font-medium cursor-not-allowed">
                            <span className="animate-pulse-slow">Broadcasting</span>
                          </button>
                        ) : (
                          <PrimaryButton
                            onClick={() => openRefundFlow(dep)}
                            className="w-full"
                          >
                            Continue
                          </PrimaryButton>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Refund Flow Bottom Sheet */}
      {/* Above SlideInPage's z-60 wrapper: the sheet portals to #root as
          its sibling, so at the default z-50 it opens behind the page. */}
      <BottomSheetContainer isOpen={isRefundFlowOpen} onClose={closeRefundFlow} zIndex={70} showBackdrop>
        <BottomSheetCard>
          <DialogHeader
            title="Refund to Bitcoin"
            onClose={closeRefundFlow}
            onBack={
              refundStep === 'fee' ? () => setRefundStep('address')
                : refundStep === 'confirm' ? () => setRefundStep('fee')
                  : undefined
            }
          />

          <div className="space-y-6">
            {/* Step 1: Address Input */}
            {refundStep === 'address' && (
              <>
                <DestinationField
                  destination={destination}
                  onChange={setDestination}
                  error={destinationError}
                  onSubmit={() => void handleContinueToFeeSelection()}
                  onScanQr={() => setIsScanning(true)}
                />

                <PrimaryButton
                  onClick={() => void handleContinueToFeeSelection()}
                  disabled={!selectedDeposit || !destination.trim()}
                  className="w-full"
                >
                  Continue
                </PrimaryButton>
              </>
            )}

            {/* Step 2: Fee Selection */}
            {refundStep === 'fee' && (
              <>
                {feeRatesError ? (
                  <SimpleAlert variant="error">{feeRatesError}</SimpleAlert>
                ) : feeRates ? (
                  <FeeRateSelector
                    selected={selectedFeeRate}
                    onSelect={setSelectedFeeRate}
                    detail={speed => <SatAmount sats={feeFor(speed)} />}
                  />
                ) : (
                  <div className="py-8 flex justify-center">
                    <LoadingSpinner text="Reading current fee rates..." />
                  </div>
                )}

                <PrimaryButton
                  onClick={() => setRefundStep('confirm')}
                  disabled={!selectedFeeRate || !feeRates}
                  className="w-full"
                >
                  Continue
                </PrimaryButton>
              </>
            )}

            {/* Step 3: Confirm */}
            {refundStep === 'confirm' && selectedDeposit && (
              <>
                <CopyableRow label="To address" value={destination} display={truncateAddress(destination, 32)} />

                <FeeBreakdownCard
                  items={[
                    { label: 'Amount', value: selectedDeposit.amountSats },
                    { label: 'Network fee', value: getSelectedFee() },
                    { label: 'You receive', value: getRefundAmount(), highlight: true },
                  ]}
                />

                {refundError && (
                  <AlertCard variant="warning" title="Refund Failed">
                    <p className="text-sm">{refundError}</p>
                  </AlertCard>
                )}

                <PrimaryButton
                  onClick={handleRefund}
                  disabled={isProcessing}
                  className="w-full"
                >
                  Refund
                </PrimaryButton>
              </>
            )}

            {/* Step 4: Processing */}
            {refundStep === 'processing' && <ProcessingStep />}

            {/* Step 5: Result */}
            {refundStep === 'result' && (
              <ResultStep result="success" error={null} onClose={closeRefundFlow} operationType="refund">
                {refundTxId && (
                  <PaymentInfoCard>
                    <CollapsibleCodeField
                      label="Transaction ID"
                      value={refundTxId}
                      isVisible={isTxIdVisible}
                      onToggle={() => setIsTxIdVisible(prev => !prev)}
                      href={explorerTxUrl(refundTxId)}
                    />
                  </PaymentInfoCard>
                )}
              </ResultStep>
            )}
          </div>
        </BottomSheetCard>
      </BottomSheetContainer>

      {/* Over the refund sheet, which is itself over the page. */}
      <QrScannerDialog
        isOpen={isScanning}
        zIndex={80}
        onClose={() => setIsScanning(false)}
        onScan={scanned => {
          setDestination(scanned.trim());
          setIsScanning(false);
        }}
      />
    </SlideInPage>
  );
};

export default GetRefundPage;
