import React, { useEffect, useState, useCallback } from 'react';
import { Transition } from '@headlessui/react';
import { useWallet } from '@/contexts/WalletContext';
import { LoadingSpinner } from '@/components/ui';

interface BuyBitcoinPageProps {
  onBack: () => void;
}

const BuyBitcoinPage: React.FC<BuyBitcoinPageProps> = ({ onBack }) => {
  const wallet = useWallet();
  const [isOpen, setIsOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depositAddress, setDepositAddress] = useState<string | null>(null);

  // Fetch a deposit address when component mounts
  useEffect(() => {
    const fetchDepositAddress = async () => {
      try {
        const response = await wallet.receivePayment({
          paymentMethod: { type: 'bitcoinAddress' },
        });
        setDepositAddress(response.paymentRequest);
      } catch (e) {
        console.error('Failed to get deposit address:', e);
        setError('Failed to get deposit address');
      }
    };
    fetchDepositAddress();
  }, [wallet]);

  const handleClose = () => {
    setIsOpen(false);
    setTimeout(onBack, 220);
  };

  const handleBuyBitcoin = useCallback(async () => {
    if (!depositAddress) {
      setError('No deposit address available');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await wallet.buyBitcoin({
        address: depositAddress,
      });

      // Open the provider URL in a new tab
      window.open(response.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      console.error('Failed to initiate buy bitcoin:', e);
      setError(e instanceof Error ? e.message : 'Failed to initiate buy bitcoin');
    } finally {
      setIsLoading(false);
    }
  }, [wallet, depositAddress]);

  return (
    <div className="absolute inset-0 z-50 overflow-hidden">
      <Transition show={isOpen} appear as="div" className="absolute inset-0">
        <Transition.Child
          as="div"
          enter="transform transition ease-out duration-300"
          enterFrom="translate-x-[-100%]"
          enterTo="translate-x-0"
          leave="transform transition ease-in duration-200"
          leaveFrom="translate-x-0"
          leaveTo="translate-x-[-100%]"
          className="absolute inset-0 flex flex-col bg-spark-surface will-change-transform"
        >
          {/* Header */}
          <div className="border-b border-spark-border safe-area-top">
            <div className="relative px-4 py-4 flex items-center justify-center">
              <h1 className="text-center font-display text-lg font-semibold text-spark-text-primary">Buy Bitcoin</h1>
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
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-xl mx-auto w-full p-4 space-y-6">
              {/* Info Card */}
              <div className="bg-spark-dark border border-spark-border rounded-2xl p-6 space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-spark-primary/20 flex items-center justify-center flex-shrink-0">
                    <svg className="w-7 h-7 text-spark-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="font-display font-semibold text-spark-text-primary text-lg">Purchase Bitcoin</h2>
                    <p className="text-spark-text-muted text-sm">Buy Bitcoin with your card via MoonPay</p>
                  </div>
                </div>

                <div className="border-t border-spark-border pt-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-spark-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-spark-primary text-xs font-bold">1</span>
                    </div>
                    <p className="text-spark-text-secondary text-sm">
                      Click the button below to open MoonPay in a new tab
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-spark-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-spark-primary text-xs font-bold">2</span>
                    </div>
                    <p className="text-spark-text-secondary text-sm">
                      Complete your purchase on MoonPay
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-spark-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-spark-primary text-xs font-bold">3</span>
                    </div>
                    <p className="text-spark-text-secondary text-sm">
                      Bitcoin will be deposited to your wallet automatically
                    </p>
                  </div>
                </div>
              </div>

              {/* Error display */}
              {error && (
                <div className="bg-spark-error/10 border border-spark-error/30 rounded-xl p-4 flex items-start gap-3">
                  <svg className="w-5 h-5 text-spark-error flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-spark-error text-sm">{error}</p>
                </div>
              )}

              {/* Buy Button */}
              <button
                onClick={handleBuyBitcoin}
                disabled={isLoading || !depositAddress}
                className="w-full bg-spark-primary hover:bg-spark-primary-light disabled:bg-spark-primary/50 disabled:cursor-not-allowed text-white font-display font-semibold py-4 px-6 rounded-2xl transition-colors flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <LoadingSpinner />
                ) : !depositAddress ? (
                  <>
                    <LoadingSpinner />
                    <span>Preparing...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    <span>Buy Bitcoin with MoonPay</span>
                  </>
                )}
              </button>

              {/* Disclaimer */}
              <p className="text-spark-text-muted text-xs text-center">
                You will be redirected to MoonPay, a third-party service.
                By proceeding, you agree to their terms of service.
              </p>
            </div>
          </div>
        </Transition.Child>
      </Transition>
    </div>
  );
};

export default BuyBitcoinPage;
