import React, { useCallback, useEffect, useState } from 'react';
import { useWallet } from '../contexts/WalletContext';
import type { DepositInfo, Fee, SdkEvent } from '@breeztech/breez-sdk-spark';
import { LoadingSpinner, PrimaryButton, SecondaryButton, FormInput, BottomSheetContainer, BottomSheetCard, DialogHeader, CollapsibleCodeField, PaymentInfoCard } from '../components/ui';
import { SimpleAlert } from '../components/AlertCard';
import { Transition } from '@headlessui/react';
import { FeeBreakdownCard } from '../components/FeeBreakdownCard';
import { CloseIcon, CheckIcon, WarningIcon } from '../components/Icons';
import { isDepositRejected, removeRejectedDeposit } from '../services/depositState';
import { formatWithSpaces } from '../utils/formatNumber';

interface GetRefundPageProps {
  onBack: () => void;
  animationDirection?: 'horizontal' | 'vertical';
}

type RefundStep = 'address' | 'fee' | 'confirm' | 'processing' | 'result';

const GetRefundPage: React.FC<GetRefundPageProps> = ({ onBack, animationDirection = 'horizontal' }) => {
  const wallet = useWallet();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [deposits, setDeposits] = useState<DepositInfo[]>([]);
  const [isOpen, setIsOpen] = useState<boolean>(true);

  // Refund flow state
  const [selectedDeposit, setSelectedDeposit] = useState<DepositInfo | null>(null);
  const [isRefundFlowOpen, setIsRefundFlowOpen] = useState<boolean>(false);
  const [refundStep, setRefundStep] = useState<RefundStep>('address');
  const [destination, setDestination] = useState<string>('');
  const [selectedFeeRate, setSelectedFeeRate] = useState<'fast' | 'medium' | 'slow' | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundSuccess, setRefundSuccess] = useState<boolean>(false);
  const [refundTxId, setRefundTxId] = useState<string | null>(null);
  const [isTxIdVisible, setIsTxIdVisible] = useState<boolean>(false);

  // Fee estimates (simplified - in real implementation, get from SDK)
  const feeEstimates = {
    slow: 500,
    medium: 1000,
    fast: 2000
  };

  // State for expandable transaction ID fields in examples
  const [expandedTxIds, setExpandedTxIds] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await wallet.unclaimedDeposits();
      // Only show deposits that have been rejected
      const rejectedDeposits = list.filter(d => isDepositRejected(d.txid, d.vout));

      // Sort: non-broadcasted (no refundTxId) first, then broadcasted
      const sortedDeposits = rejectedDeposits.sort((a, b) => {
        const aHasRefund = hasRefundTx(a);
        const bHasRefund = hasRefundTx(b);

        // Non-broadcasted (false) should come before broadcasted (true)
        if (aHasRefund === bHasRefund) return 0;
        return aHasRefund ? 1 : -1;
      });

      setDeposits(sortedDeposits);
    } catch (e) {
      console.error('Failed to load rejected deposits:', e);
      setError('Failed to load rejected deposits');
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let listenerId: string | null = null;
    (async () => {
      try {
        listenerId = await wallet.addEventListener((event: SdkEvent) => {
          if (event.type === 'synced' || event.type === 'claimedDeposits' || event.type === 'unclaimedDeposits') {
            void load();
          }
        });
      } catch (e) {
        console.warn('Failed to attach refund page event listener:', e);
      }
    })();

    return () => {
      if (listenerId) {
        wallet.removeEventListener(listenerId).catch(() => { });
      }
    };
  }, [wallet, load]);

  const handleClose = () => {
    setIsOpen(false);
    setTimeout(() => onBack(), 220);
  };


  const openRefundFlow = (deposit: DepositInfo) => {
    setSelectedDeposit(deposit);
    setDestination('');
    setSelectedFeeRate(null);
    setRefundError(null);
    setRefundSuccess(false);
    setRefundTxId(null);
    setRefundStep('address');
    setIsRefundFlowOpen(true);
  };

  const closeRefundFlow = () => {
    setIsRefundFlowOpen(false);
    setSelectedDeposit(null);
  };

  const handleContinueToFeeSelection = () => {
    if (!selectedDeposit || !destination.trim()) return;
    setRefundStep('fee');
  };

  const handleRefund = async () => {
    if (!selectedDeposit || !selectedFeeRate || !destination.trim()) return;

    setIsProcessing(true);
    setRefundError(null);
    setRefundStep('processing');

    try {
      const fee: Fee = { type: 'fixed', amount: feeEstimates[selectedFeeRate] };
      const result = await wallet.refundDeposit(selectedDeposit.txid, selectedDeposit.vout, destination.trim(), fee);

      // Remove from rejected list after successful refund
      removeRejectedDeposit(selectedDeposit.txid, selectedDeposit.vout);

      setRefundSuccess(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK result type doesn't expose txId fields
      setRefundTxId((result as any)?.txId || (result as any)?.txid || null);
      setRefundStep('result');

      await load();
    } catch (e) {
      console.error('Failed to refund deposit:', e);
      setRefundError(e instanceof Error ? e.message : 'Failed to refund deposit');
      setRefundStep('confirm');
    } finally {
      setIsProcessing(false);
    }
  };

  const getSelectedFee = () => {
    if (!selectedFeeRate) return 0;
    return feeEstimates[selectedFeeRate];
  };

  const getRefundAmount = () => {
    if (!selectedDeposit) return 0;
    return selectedDeposit.amountSats - getSelectedFee();
  };

  // Check if deposit has been refunded
  const hasRefundTx = (deposit: DepositInfo) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK DepositInfo doesn't expose refund fields
    const d = deposit as any;
    return Boolean(d.refund_tx_id || d.refundTxId || d.refund_txid || d.refundTxid);
  };

  const getRefundTxId = (deposit: DepositInfo) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK DepositInfo doesn't expose refund fields
    const d = deposit as any;
    return d.refund_tx_id || d.refundTxId || d.refund_txid || d.refundTxid || null;
  };

  // Get mempool.space URL for a transaction
  const getMempoolUrl = (txid: string) => {
    // Check URL params for network
    const urlParams = new URLSearchParams(window.location.search);
    const network = urlParams.get('network') ?? 'mainnet';

    if (network === 'testnet') {
      return `https://mempool.space/testnet/tx/${txid}`;
    }
    return `https://mempool.space/tx/${txid}`;
  };

  return (
    <div className="absolute inset-0 z-50 overflow-hidden">
      <Transition
        show={isOpen}
        appear
        as="div"
        className="absolute inset-0"
      >
        <Transition.Child
          as="div"
          enter="transform transition ease-out duration-300"
          enterFrom={animationDirection === 'vertical' ? 'translate-y-full' : 'translate-x-[-100%]'}
          enterTo={animationDirection === 'vertical' ? 'translate-y-0' : 'translate-x-0'}
          leave="transform transition ease-in duration-200"
          leaveFrom={animationDirection === 'vertical' ? 'translate-y-0' : 'translate-x-0'}
          leaveTo={animationDirection === 'vertical' ? 'translate-y-full' : 'translate-x-[-100%]'}
          className="absolute inset-0 flex flex-col bg-spark-surface will-change-transform"
        >
          {/* Header */}
          <div className="relative px-4 py-4 border-b border-spark-border">
            <h1 className="text-center font-display text-lg font-semibold text-spark-text-primary">Get Refund</h1>
            <button
              onClick={handleClose}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
              aria-label="Close"
            >
              <CloseIcon size="md" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="w-full px-6 py-4 space-y-4">
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
                    const borderClass = isRefunded ? 'border-spark-success/30' : 'border-spark-border';

                    return (
                      <div
                        key={idx}
                        className={`bg-spark-dark/50 border ${borderClass} rounded-2xl p-5 space-y-4`}
                      >
                        {/* Amount */}
                        <div className="flex items-center justify-between py-2">
                          <span className="text-spark-text-secondary text-sm">Amount</span>
                          <span className="font-mono text-sm font-medium text-spark-text-primary">
                            {formatWithSpaces(amount)} sats
                          </span>
                        </div>

                        {/* Transaction IDs */}
                        <div className="space-y-2">
                          <CollapsibleCodeField
                            label="Transaction ID"
                            value={dep.txid}
                            isVisible={expandedTxIds[txKey] || false}
                            onToggle={() => setExpandedTxIds(prev => ({ ...prev, [txKey]: !prev[txKey] }))}
                            href={getMempoolUrl(dep.txid)}
                          />

                          {isRefunded && refundedTxId && (
                            <CollapsibleCodeField
                              label="Refund Transaction ID"
                              value={refundedTxId}
                              isVisible={expandedTxIds[refundKey] || false}
                              onToggle={() => setExpandedTxIds(prev => ({ ...prev, [refundKey]: !prev[refundKey] }))}
                              href={getMempoolUrl(refundedTxId)}
                            />
                          )}
                        </div>

                        {/* Continue button - disabled if refund is being processed */}
                        <div>
                          {isRefunded ? (
                            <button disabled className="w-full px-4 py-3 bg-spark-electric/15 text-spark-electric rounded-xl font-medium cursor-not-allowed">
                              <span className="animate-pulse-slow">BROADCASTING</span>
                            </button>
                          ) : (
                            <PrimaryButton
                              onClick={() => openRefundFlow(dep)}
                              className="w-full"
                            >
                              CONTINUE
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
        </Transition.Child>
      </Transition>

      {/* Refund Flow Bottom Sheet */}
      <BottomSheetContainer isOpen={isRefundFlowOpen} onClose={closeRefundFlow}>
        <BottomSheetCard>
          <DialogHeader
            title={refundStep === 'result' ? (refundSuccess ? 'Refund Sent' : 'Refund Failed') : 'Refund to Bitcoin'}
            onClose={closeRefundFlow}
          />

          <div className="space-y-6">
            {/* Step 1: Address Input */}
            {refundStep === 'address' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-spark-text-secondary mb-2">
                    Destination
                  </label>
                  <FormInput
                    id="refund-destination"
                    type="text"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder="bc1q..."
                  />
                  <p className="text-spark-text-muted text-xs mt-2">
                    Enter the Bitcoin address where you want to receive the refund.
                  </p>
                </div>

                <div className="flex gap-3">
                  <SecondaryButton onClick={closeRefundFlow} className="flex-1">
                    Cancel
                  </SecondaryButton>
                  <PrimaryButton
                    onClick={handleContinueToFeeSelection}
                    disabled={!destination.trim()}
                    className="flex-1"
                  >
                    Continue
                  </PrimaryButton>
                </div>
              </>
            )}

            {/* Step 2: Fee Selection */}
            {refundStep === 'fee' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-[rgb(var(--text-white))] mb-2">
                    Select Fee Rate
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setSelectedFeeRate('slow')}
                      className={`relative p-3 rounded-lg border text-sm font-medium transition-colors ${selectedFeeRate === 'slow'
                        ? 'bg-[rgb(var(--primary-blue))] text-white border-[rgb(var(--primary-blue))] ring-2 ring-[rgb(var(--primary-blue))]'
                        : 'bg-[rgb(var(--card-bg))] text-[rgb(var(--text-white))] border-[rgb(var(--card-border))] hover:border-[rgb(var(--primary-blue))]'
                        }`}
                    >
                      {selectedFeeRate === 'slow' && (
                        <svg className="absolute top-2 right-2 w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414l2.293 2.293 6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                      <div>Slow</div>
                      <div className="text-xs opacity-70">{formatWithSpaces(feeEstimates.slow)} sats</div>
                    </button>
                    <button
                      onClick={() => setSelectedFeeRate('medium')}
                      className={`relative p-3 rounded-lg border text-sm font-medium transition-colors ${selectedFeeRate === 'medium'
                        ? 'bg-[rgb(var(--primary-blue))] text-white border-[rgb(var(--primary-blue))] ring-2 ring-[rgb(var(--primary-blue))]'
                        : 'bg-[rgb(var(--card-bg))] text-[rgb(var(--text-white))] border-[rgb(var(--card-border))] hover:border-[rgb(var(--primary-blue))]'
                        }`}
                    >
                      {selectedFeeRate === 'medium' && (
                        <svg className="absolute top-2 right-2 w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414l2.293 2.293 6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                      <div>Medium</div>
                      <div className="text-xs opacity-70">{formatWithSpaces(feeEstimates.medium)} sats</div>
                    </button>
                    <button
                      onClick={() => setSelectedFeeRate('fast')}
                      className={`relative p-3 rounded-lg border text-sm font-medium transition-colors ${selectedFeeRate === 'fast'
                        ? 'bg-[rgb(var(--primary-blue))] text-white border-[rgb(var(--primary-blue))] ring-2 ring-[rgb(var(--primary-blue))]'
                        : 'bg-[rgb(var(--card-bg))] text-[rgb(var(--text-white))] border-[rgb(var(--card-border))] hover:border-[rgb(var(--primary-blue))]'
                        }`}
                    >
                      {selectedFeeRate === 'fast' && (
                        <svg className="absolute top-2 right-2 w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414l2.293 2.293 6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                      <div>Fast</div>
                      <div className="text-xs opacity-70">{formatWithSpaces(feeEstimates.fast)} sats</div>
                    </button>
                  </div>
                </div>

                <div className="flex gap-3">
                  <PrimaryButton onClick={() => setRefundStep('address')} className="flex-1 bg-gray-600 hover:bg-gray-700 text-white" disabled={false}>
                    Back
                  </PrimaryButton>
                  <PrimaryButton
                    onClick={() => setRefundStep('confirm')}
                    disabled={!selectedFeeRate}
                    className="flex-1"
                  >
                    Continue
                  </PrimaryButton>
                </div>
              </>
            )}

            {/* Step 3: Confirm */}
            {refundStep === 'confirm' && selectedDeposit && (
              <>
                {/* Breakdown */}
                <FeeBreakdownCard
                  items={[
                    { label: 'Amount', value: selectedDeposit.amountSats },
                    { label: 'Network fee', value: getSelectedFee() },
                    { label: 'You receive', value: getRefundAmount(), highlight: true },
                  ]}
                />

                {refundError && (
                  <div className="bg-spark-warning/10 border border-spark-warning/30 rounded-2xl p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-xl bg-spark-warning/20 flex items-center justify-center flex-shrink-0">
                        <WarningIcon size="md" className="text-spark-warning" />
                      </div>
                      <h3 className="font-display font-bold text-spark-warning">Refund Failed</h3>
                    </div>
                    <div className="pl-[52px]">
                      <p className="text-spark-error text-sm">{refundError}</p>
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <SecondaryButton onClick={() => setRefundStep('fee')} className="flex-1">
                    Back
                  </SecondaryButton>
                  <PrimaryButton
                    onClick={handleRefund}
                    disabled={isProcessing}
                    className="flex-1"
                  >
                    Confirm & Refund
                  </PrimaryButton>
                </div>
              </>
            )}

            {/* Step 4: Processing */}
            {refundStep === 'processing' && (
              <div className="py-8 flex flex-col items-center justify-center">
                <LoadingSpinner text="Processing refund..." />
              </div>
            )}

            {/* Step 5: Result */}
            {refundStep === 'result' && (
              <>
                <div className="text-center py-4">
                  {refundSuccess ? (
                    <>
                      <div className="w-16 h-16 rounded-full bg-spark-success/20 flex items-center justify-center mx-auto mb-4">
                        <CheckIcon size="xl" className="text-spark-success" />
                      </div>
                      <h3 className="font-display font-semibold text-spark-text-primary text-lg mb-2">
                        Refund Broadcast
                      </h3>
                      <p className="text-spark-text-muted text-sm">
                        Your refund has been sent to the Bitcoin network.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="w-16 h-16 rounded-full bg-spark-error/20 flex items-center justify-center mx-auto mb-4">
                        <CloseIcon size="xl" className="text-spark-error" />
                      </div>
                      <h3 className="font-display font-semibold text-spark-text-primary text-lg mb-2">
                        Refund Failed
                      </h3>
                      <p className="text-spark-error text-sm">
                        {refundError || 'An error occurred while processing your refund.'}
                      </p>
                    </>
                  )}
                </div>

                {refundSuccess && refundTxId && (
                  <PaymentInfoCard>
                    <CollapsibleCodeField
                      label="Transaction ID"
                      value={refundTxId}
                      isVisible={isTxIdVisible}
                      onToggle={() => setIsTxIdVisible(prev => !prev)}
                    />
                  </PaymentInfoCard>
                )}

                <PrimaryButton onClick={closeRefundFlow} className="w-full">
                  Done
                </PrimaryButton>
              </>
            )}
          </div>
        </BottomSheetCard>
      </BottomSheetContainer>
    </div >
  );
};

export default GetRefundPage;
