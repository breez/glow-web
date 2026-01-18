import React from 'react';
import LoadingSpinner from '../../components/LoadingSpinner';
import { FormError, PrimaryButton } from '../../components/ui';

interface AmountPanelProps {
  isOpen: boolean;
  amount: string;
  setAmount: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  limits: { min: number; max: number };
  isLoading: boolean;
  error: string | null;
  onCreateInvoice: () => void;
  onClose: () => void;
}

const formatWithSpaces = (num: number): string => {
  return num.toLocaleString('en-US').replace(/,/g, '\u2009');
};

const QUICK_AMOUNTS = [100, 1000, 10000, 100000];

const AmountPanel: React.FC<AmountPanelProps> = ({
  isOpen,
  amount,
  setAmount,
  description,
  setDescription,
  limits,
  isLoading,
  error,
  onCreateInvoice,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 z-40 transition-opacity"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className="fixed inset-x-0 bottom-0 z-50 animate-slide-up">
        <div className="bg-spark-surface border-t border-spark-border rounded-t-3xl shadow-glass-lg">
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-10 h-1 rounded-full bg-spark-border-light" />
          </div>
          
          <div className="px-6 pb-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-spark-primary/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-spark-primary" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-display font-semibold text-spark-text-primary">Create Invoice</h3>
                  <p className="text-spark-text-muted text-xs">Request a specific amount</p>
                </div>
              </div>
              <button 
                onClick={onClose} 
                className="p-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Amount Input */}
            <div className="space-y-4">
              <div>
                <label className="block text-spark-text-secondary text-sm font-medium mb-2">Amount</label>
                <div className="flex items-center bg-spark-dark border border-spark-border rounded-xl overflow-hidden focus-within:border-spark-primary focus-within:ring-2 focus-within:ring-spark-primary/20 transition-all">
                  <input
                    type="number"
                    min={limits.min}
                    max={limits.max}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    disabled={isLoading}
                    className="flex-1 bg-transparent px-4 py-3 text-spark-text-primary text-lg font-mono placeholder-spark-text-muted focus:outline-none"
                  />
                  <span className="px-4 py-3 text-spark-text-muted font-medium text-sm">sats</span>
                </div>
              </div>

              {/* Quick amount buttons */}
              <div className="flex gap-2">
                {QUICK_AMOUNTS.map((quickAmount) => (
                  <button
                    key={quickAmount}
                    onClick={() => setAmount(quickAmount.toString())}
                    disabled={isLoading}
                    className={`
                      flex-1 py-2.5 rounded-xl text-sm font-mono font-medium transition-all
                      ${amount === quickAmount.toString()
                        ? 'bg-spark-primary text-white'
                        : 'text-spark-text-secondary hover:text-spark-text-primary'
                      }
                    `}
                  >
                    {formatWithSpaces(quickAmount)}
                  </button>
                ))}
              </div>

              {/* Description */}
              <div>
                <label className="block text-spark-text-secondary text-sm font-medium mb-2">Description (optional)</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What's this for?"
                  disabled={isLoading}
                  className="w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 text-spark-text-primary placeholder-spark-text-muted focus:border-spark-primary focus:ring-2 focus:ring-spark-primary/20 focus:outline-none transition-all"
                />
              </div>

              <FormError error={error} />
            </div>

            {/* Generate Button */}
            <div className="mt-6">
              <PrimaryButton 
                onClick={onCreateInvoice} 
                disabled={isLoading || !amount} 
                className="w-full"
              >
                {isLoading ? <LoadingSpinner size="small" /> : 'Generate Invoice'}
              </PrimaryButton>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default AmountPanel;
