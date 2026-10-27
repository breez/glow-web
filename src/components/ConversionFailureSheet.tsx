import React, { ReactNode, useEffect, useState } from 'react';
import { BottomSheetContainer, BottomSheetCard, DialogHeader, PaymentInfoCard, PaymentInfoRow } from './ui';
import { SimpleAlert } from './AlertCard';
import type { VisibleConversionFailure } from '../contexts/StableBalanceContext';
import { formatRetryIn } from '../utils/stableBalanceFailure';

interface ConversionFailureSheetProps {
  isOpen: boolean;
  onClose: () => void;
  failure: VisibleConversionFailure;
  amount: ReactNode;
}

const ConversionFailureSheet: React.FC<ConversionFailureSheetProps> = ({ isOpen, onClose, failure, amount }) => {
  // Ticks so "Next Attempt" counts down while the sheet stays open.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [isOpen]);

  return (
    <BottomSheetContainer isOpen={isOpen} onClose={onClose}>
      <BottomSheetCard>
        <DialogHeader title="Balance to Convert" onClose={onClose} />
        <div className="space-y-4">
          <PaymentInfoCard>
            <PaymentInfoRow label="Amount" value={amount} />
            {failure.retryAt !== undefined && (
              <PaymentInfoRow label="Next Attempt" value={formatRetryIn(failure.retryAt, now)} />
            )}
          </PaymentInfoCard>
          <SimpleAlert variant="warning" hideIcon>
            This amount hasn't converted to {failure.kind === 'deactivation' ? 'BTC' : 'USD'} yet. Glow will retry automatically.
          </SimpleAlert>
        </div>
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default ConversionFailureSheet;
