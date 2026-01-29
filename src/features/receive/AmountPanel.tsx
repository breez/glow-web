import React from 'react';
import LoadingSpinner from '../../components/LoadingSpinner';
import {
  FormError,
  PrimaryButton,
  BottomSheetContainer,
  BottomSheetCard,
  DialogHeader,
} from '../../components/ui';

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
  limits: _limits,
  isLoading,
  error,
  onCreateInvoice,
  onClose,
}) => {
  return (
    <BottomSheetContainer isOpen={isOpen} onClose={onClose} showBackdrop>
      <BottomSheetCard>
        <DialogHeader
          title="Create Invoice"
          onClose={onClose}
          icon={
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
            </svg>
          }
        />

        {/* Amount Input */}
        <div className="space-y-4">
          <div>
            <label className="block text-spark-text-secondary text-sm font-medium mb-2">Amount</label>
            <div className="flex items-center bg-spark-dark border border-spark-border rounded-xl overflow-hidden focus-within:border-spark-primary transition-all">
              <textarea
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                placeholder="0"
                disabled={isLoading}
                rows={1}
                className="flex-1 bg-transparent px-4 py-3 text-spark-text-primary text-lg font-mono placeholder-spark-text-muted focus:outline-none resize-none"
                data-testid="invoice-amount-input"
              />
              <span className="px-4 py-3 text-spark-text-muted font-medium text-sm">sats</span>
            </div>
          </div>

          {/* Quick amount buttons */}
          <div className="flex gap-2">
            {QUICK_AMOUNTS.map((quickAmount) => (
              <button
                key={quickAmount}
                type="button"
                onClick={() => setAmount(quickAmount.toString())}
                disabled={isLoading}
                className={`
                  flex-1 py-2 rounded-lg text-sm font-mono font-medium transition-all
                  ${amount === quickAmount.toString()
                    ? 'bg-spark-primary text-black'
                    : 'bg-spark-elevated border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
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
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.replace(/\n/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              placeholder="What's this for?"
              disabled={isLoading}
              rows={1}
              className="w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 text-spark-text-primary placeholder-spark-text-muted focus:border-spark-primary focus:outline-none transition-all resize-none"
            />
          </div>

          <FormError error={error} data-testid="invoice-error-message" />

          {/* Generate Button */}
          <PrimaryButton
            onClick={onCreateInvoice}
            type="submit"
            disabled={isLoading || !amount}
            className="w-full"
            data-testid="generate-invoice-button"
          >
            {isLoading ? <LoadingSpinner size="small" /> : 'Generate Invoice'}
          </PrimaryButton>
        </div>
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default AmountPanel;
