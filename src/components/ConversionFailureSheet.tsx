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

// The sheet renders its content only while open, so this clock restarts on
// every open and then ticks while the sheet stays up.
const NextAttemptRow: React.FC<{ retryAt: number }> = ({ retryAt }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  return <PaymentInfoRow label="Next Attempt" value={formatRetryIn(retryAt, now)} />;
};

const ConversionFailureSheet: React.FC<ConversionFailureSheetProps> = ({ isOpen, onClose, failure, amount }) => (
  <BottomSheetContainer isOpen={isOpen} onClose={onClose}>
    <BottomSheetCard>
      <DialogHeader title="Balance to Convert" onClose={onClose} />
      <div className="space-y-4">
        <PaymentInfoCard>
          <PaymentInfoRow label="Amount" value={amount} />
          {failure.retryAt !== undefined && <NextAttemptRow retryAt={failure.retryAt} />}
        </PaymentInfoCard>
        <SimpleAlert variant="warning" hideIcon>
          This amount hasn't converted to {failure.kind === 'deactivation' ? 'BTC' : 'USD'} yet. Glow will retry automatically.
        </SimpleAlert>
      </div>
    </BottomSheetCard>
  </BottomSheetContainer>
);

export default ConversionFailureSheet;
