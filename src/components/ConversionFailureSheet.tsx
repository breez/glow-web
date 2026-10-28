import React, { ReactNode, useEffect, useState } from 'react';
import { BottomSheetContainer, BottomSheetCard, DialogHeader, PaymentInfoCard, PaymentInfoRow } from './ui';
import { SimpleAlert } from './AlertCard';
import type { VisibleConversionFailure } from '../contexts/StableBalanceContext';
import { formatRetryIn } from '../utils/stableBalanceFailure';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';

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

  return <PaymentInfoRow label={i18n.t('conversion.nextAttempt')} value={formatRetryIn(retryAt, now)} />;
};

const ConversionFailureSheet: React.FC<ConversionFailureSheetProps> = ({ isOpen, onClose, failure, amount }) => {
  const { t } = useTranslation('critical');
  return (
  <BottomSheetContainer isOpen={isOpen} onClose={onClose}>
    <BottomSheetCard>
      <DialogHeader title={t('conversion.balanceToConvert')} onClose={onClose} />
      <div className="space-y-4">
        <PaymentInfoCard>
          <PaymentInfoRow label={t('common:send.amount')} value={amount} />
          {failure.retryAt !== undefined && <NextAttemptRow retryAt={failure.retryAt} />}
        </PaymentInfoCard>
        <SimpleAlert variant="warning" hideIcon>
          {t('conversion.notConvertedYet', { currency: failure.kind === 'deactivation' ? 'BTC' : 'USD' })}
        </SimpleAlert>
      </div>
    </BottomSheetCard>
  </BottomSheetContainer>
  );
};

export default ConversionFailureSheet;
