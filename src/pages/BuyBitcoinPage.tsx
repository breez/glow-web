import React, { useState, useCallback } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { LoadingSpinner, ErrorMessageBox, PrimaryButton } from '@/components/ui';
import SlideInPage from '@/components/layout/SlideInPage';

interface BuyBitcoinPageProps {
  onBack: () => void;
}

const BuyBitcoinPage: React.FC<BuyBitcoinPageProps> = ({ onBack }) => {
  const wallet = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBuyBitcoin = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await wallet.buyBitcoin({});

      // Open the provider URL in a new tab
      window.open(response.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      console.error('Failed to initiate buy bitcoin:', e);
      const raw = e instanceof Error ? e.message : String(e);
      // Detect network-level failures and provide a friendly message
      if (/Failed to fetch|NetworkError|network/i.test(raw)) {
        setError('Please check your internet connection and try again.');
      } else {
        setError(raw);
      }
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  return (
    <SlideInPage title="Buy Bitcoin" onClose={onBack} slideFrom="left">
      <div className="p-4">
        <div className="max-w-xl mx-auto w-full space-y-6">
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

          {/* Buy Button */}
          <PrimaryButton
            onClick={handleBuyBitcoin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <LoadingSpinner />
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                <span>Buy Bitcoin with MoonPay</span>
              </>
            )}
          </PrimaryButton>

          {/* Disclaimer */}
          <p className="text-spark-text-muted text-xs text-center">
            You will be redirected to MoonPay, a third-party service.
            By proceeding, you agree to their terms of service.
          </p>

          {/* Error display - below disclaimer */}
          {error && (
            <ErrorMessageBox
              title="Could not open MoonPay"
              error={error}
            />
          )}
        </div>
      </div>
    </SlideInPage>
  );
};

export default BuyBitcoinPage;
