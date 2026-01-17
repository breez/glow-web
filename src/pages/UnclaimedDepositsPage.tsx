import React, { useCallback, useEffect, useState } from 'react';
import { useWallet } from '../contexts/WalletContext';
import type { DepositInfo, Fee, SdkEvent } from '@breeztech/breez-sdk-spark';
import { LoadingSpinner, PrimaryButton, Alert, FormGroup, FormInput, FormError } from '../components/ui';
import { Transition } from '@headlessui/react';

interface UnclaimedDepositsPageProps {
  onBack: () => void;
  onChanged?: () => void;
}

const UnclaimedDepositsPage: React.FC<UnclaimedDepositsPageProps> = ({ onBack, onChanged }) => {
  const wallet = useWallet();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [deposits, setDeposits] = useState<DepositInfo[]>([]);
  const [processingIndex, setProcessingIndex] = useState<number | null>(null);
  const [processingAction, setProcessingAction] = useState<'claim' | 'refund' | null>(null);
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [isFeePanelOpen, setIsFeePanelOpen] = useState<boolean>(false);
  const [feeType, setFeeType] = useState<'fixed' | 'relative'>('fixed');
  const [feeValue, setFeeValue] = useState<string>('1');
  const [selectedDeposit, setSelectedDeposit] = useState<DepositInfo | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [actionType, setActionType] = useState<'claim' | 'refund'>('claim');
  const [destination, setDestination] = useState<string>('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await wallet.unclaimedDeposits();
      setDeposits(list);
    } catch (e) {
      console.error('Failed to load unclaimed deposits:', e);
      setError('Failed to load unclaimed deposits');
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
        console.warn('Failed to attach deposits page event listener:', e);
      }
    })();

    return () => {
      if (listenerId) {
        wallet.removeEventListener(listenerId).catch(() => { });
      }
    };
  }, [wallet, load]);

  const handleClaim = async (txid: string, vout: number, maxFee: Fee) => {
    setError(null);
    try {
      await wallet.claimDeposit(txid, vout, maxFee);
      await load();
      onChanged?.();
    } catch (e) {
      console.error('Failed to claim deposit:', e);
      setError(e instanceof Error ? e.message : 'Failed to claim deposit');
    } finally {
      setProcessingIndex(null);
      setProcessingAction(null);
    }
  };

  const handleRefund = async (txid: string, vout: number, destinationAddress: string, fee: Fee) => {
    setError(null);
    try {
      await wallet.refundDeposit(txid, vout, destinationAddress, fee);
      await load();
      onChanged?.();
    } catch (e) {
      console.error('Failed to refund deposit:', e);
      setError(e instanceof Error ? e.message : 'Failed to refund deposit');
    } finally {
      setProcessingIndex(null);
      setProcessingAction(null);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setTimeout(() => onBack(), 220);
  };

  const truncateTxid = (txid: string) => {
    return `${txid.slice(0, 8)}...${txid.slice(-8)}`;
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
          enterFrom="translate-y-full"
          enterTo="translate-y-0"
          leave="transform transition ease-in duration-200"
          leaveFrom="translate-y-0"
          leaveTo="translate-y-full"
          className="absolute inset-0"
        >
          <div className="flex flex-col h-full bg-spark-surface">
            {/* Header */}
            <div className="relative px-4 py-4 border-b border-spark-border">
              <h1 className="text-center font-display text-lg font-semibold text-spark-text-primary">Unclaimed Deposits</h1>
              <button
                onClick={handleClose}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-xl mx-auto w-full p-4 space-y-4">
                {isLoading && (
                  <div className="py-16 flex justify-center">
                    <LoadingSpinner text="Loading deposits..." />
                  </div>
                )}

                {error && <Alert type="error">{error}</Alert>}

                {!isLoading && deposits.length === 0 && (
                  <div className="py-16 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-spark-success/20 flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-spark-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h3 className="font-display font-semibold text-spark-text-primary mb-2">All Clear!</h3>
                    <p className="text-spark-text-muted text-sm">No unclaimed deposits at this time.</p>
                  </div>
                )}

                {!isLoading && deposits.length > 0 && (
                  <div className="space-y-3">
                    {deposits.map((dep, idx) => {
                      const amount = dep.amountSats;
                      const id = dep.txid;
                      const hasRefundTx = Boolean((dep as any).refund_tx_id || (dep as any).refundTxId || (dep as any).refund_txid || (dep as any).refundTxid);
                      const isProcessing = processingIndex === idx;

                      return (
                        <div 
                          key={idx} 
                          className={`bg-spark-dark border border-spark-border rounded-2xl p-4 transition-all ${isProcessing ? 'opacity-70' : ''}`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-spark-text-muted text-xs">Tx:</span>
                                <span className="font-mono text-sm text-spark-text-secondary">{truncateTxid(id)}</span>
                              </div>
                              <div className="font-display font-bold text-spark-primary text-lg">
                                {typeof amount === 'number' ? `${amount.toLocaleString()} sats` : 'Unknown amount'}
                              </div>
                            </div>
                            {hasRefundTx && (
                              <span className="px-2 py-1 text-xs font-medium bg-spark-primary/20 text-spark-primary-light rounded-lg">
                                Refunded
                              </span>
                            )}
                          </div>

                          <div className="flex gap-2">
                            <button
                              onClick={() => { 
                                setSelectedDeposit(dep); 
                                setSelectedIndex(idx); 
                                setActionType('claim'); 
                                setIsFeePanelOpen(true); 
                                setFeeError(null); 
                                setFeeValue('1'); 
                                setFeeType('fixed'); 
                                setDestination(''); 
                              }}
                              disabled={isProcessing || hasRefundTx}
                              className={`
                                flex-1 py-2.5 px-4 rounded-xl font-display font-semibold text-sm transition-all
                                ${hasRefundTx 
                                  ? 'bg-spark-border text-spark-text-muted cursor-not-allowed'
                                  : 'bg-spark-success text-black hover:bg-spark-success/80'
                                }
                              `}
                            >
                              {isProcessing && processingAction === 'claim' ? (
                                <span className="flex items-center justify-center gap-2">
                                  <LoadingSpinner size="small" />
                                  Claiming...
                                </span>
                              ) : 'Claim'}
                            </button>
                            <button
                              onClick={() => { 
                                setSelectedDeposit(dep); 
                                setSelectedIndex(idx); 
                                setActionType('refund'); 
                                setIsFeePanelOpen(true); 
                                setFeeError(null); 
                                setFeeValue('1'); 
                                setFeeType('fixed'); 
                                setDestination(''); 
                              }}
                              disabled={isProcessing}
                              className="flex-1 py-2.5 px-4 rounded-xl font-display font-semibold text-sm border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light transition-all"
                            >
                              {isProcessing && processingAction === 'refund' ? (
                                <span className="flex items-center justify-center gap-2">
                                  <LoadingSpinner size="small" />
                                  Refunding...
                                </span>
                              ) : 'Refund'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </Transition.Child>
      </Transition>

      {/* Fee selection bottom sheet */}
      <Transition show={isFeePanelOpen} as="div" className="relative z-50">
        {/* Backdrop */}
        <Transition.Child
          as="div"
          enter="transition-opacity ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition-opacity ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm" 
            onClick={() => { setIsFeePanelOpen(false); setProcessingIndex(null); }} 
          />
        </Transition.Child>

        {/* Panel */}
        <Transition.Child
          as="div"
          enter="transform transition ease-out duration-300"
          enterFrom="translate-y-full"
          enterTo="translate-y-0"
          leave="transform transition ease-in duration-200"
          leaveFrom="translate-y-0"
          leaveTo="translate-y-full"
          className="fixed bottom-0 left-0 right-0"
        >
          <div className="bg-spark-surface border-t border-spark-border rounded-t-3xl shadow-glass-lg">
            {/* Handle */}
            <div className="bottom-sheet-handle" />

            <div className="p-6 pt-2 max-h-[70vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h4 className="font-display text-lg font-semibold text-spark-text-primary">
                  {actionType === 'refund' ? 'Refund Settings' : 'Claim Settings'}
                </h4>
                <button 
                  onClick={() => { setIsFeePanelOpen(false); setProcessingIndex(null); }} 
                  className="p-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <FormGroup className="space-y-4">
                {/* Fee type selector */}
                <div>
                  <label className="block text-sm font-medium text-spark-text-secondary mb-2">Fee Type</label>
                  <div className="flex gap-2">
                    <button
                      className={`flex-1 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
                        feeType === 'fixed' 
                          ? 'bg-spark-primary text-white' 
                          : 'bg-spark-dark border border-spark-border text-spark-text-secondary hover:text-spark-text-primary'
                      }`}
                      onClick={() => setFeeType('fixed')}
                      type="button"
                    >
                      Fixed (sats)
                    </button>
                    <button
                      className={`flex-1 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
                        feeType === 'relative' 
                          ? 'bg-spark-primary text-white' 
                          : 'bg-spark-dark border border-spark-border text-spark-text-secondary hover:text-spark-text-primary'
                      }`}
                      onClick={() => setFeeType('relative')}
                      type="button"
                    >
                      Relative (%)
                    </button>
                  </div>
                </div>

                {/* Fee value input */}
                <div>
                  <label className="block text-sm font-medium text-spark-text-secondary mb-2">
                    {feeType === 'fixed' ? 'Max Fee (sats)' : 'Max Fee (%)'}
                  </label>
                  <FormInput
                    id="fee-value"
                    type="number"
                    min={0}
                    value={feeValue}
                    onChange={(e) => setFeeValue(e.target.value)}
                    placeholder={feeType === 'fixed' ? 'e.g. 100' : 'e.g. 1'}
                  />
                </div>

                {/* Destination address input for refund */}
                {actionType === 'refund' && (
                  <div>
                    <label className="block text-sm font-medium text-spark-text-secondary mb-2">
                      Destination Address
                    </label>
                    <FormInput
                      id="refund-destination"
                      type="text"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      placeholder="bc1q..."
                    />
                  </div>
                )}

                <FormError error={feeError} />
              </FormGroup>

              <div className="mt-6 pt-4 border-t border-spark-border">
                <PrimaryButton
                  onClick={async () => {
                    if (!selectedDeposit) { setFeeError('No deposit selected'); return; }
                    const n = Number(feeValue);
                    if (Number.isNaN(n) || n < 0) {
                      setFeeError('Please enter a valid fee');
                      return;
                    }
                    if (actionType === 'refund' && (!destination || destination.trim().length === 0)) {
                      setFeeError('Destination address is required');
                      return;
                    }
                    setFeeError(null);
                    try {
                      const maxFee: Fee = feeType === 'fixed'
                        ? { type: 'fixed', amount: Math.floor(n) }
                        : ({ type: 'relative', percentage: n } as unknown as Fee);
                      const idx = selectedIndex ?? deposits.findIndex(d => d.txid === selectedDeposit.txid && d.vout === selectedDeposit.vout);
                      if (idx >= 0) setProcessingIndex(idx);
                      setProcessingAction(actionType);
                      if (actionType === 'claim') {
                        await handleClaim(selectedDeposit.txid, selectedDeposit.vout, maxFee);
                      } else {
                        await handleRefund(selectedDeposit.txid, selectedDeposit.vout, destination.trim(), maxFee);
                      }
                      setIsFeePanelOpen(false);
                    } catch (e) {
                      // handleClaim already sets errors
                    }
                  }}
                  className="w-full"
                >
                  {actionType === 'refund' ? 'Refund Now' : 'Claim Now'}
                </PrimaryButton>
              </div>
            </div>
          </div>
        </Transition.Child>
      </Transition>
    </div>
  );
};

export default UnclaimedDepositsPage;
