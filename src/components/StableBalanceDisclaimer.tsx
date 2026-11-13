import React from 'react';
import { DialogContainer, DialogCard } from './ui';
import { useTranslation } from 'react-i18next';

interface StableBalanceDisclaimerProps {
  isOpen: boolean;
  onAccept: () => void;
  onCancel: () => void;
  title?: string;
  description?: string;
}

const StableBalanceDisclaimer: React.FC<StableBalanceDisclaimerProps> = ({
  isOpen,
  onAccept,
  onCancel,
  title,
  description,
}) => {
  const { t } = useTranslation(['critical', 'common']);
  const resolvedTitle = title ?? t('common:stableBalance.disclaimerTitle');
  const resolvedDescription = description ?? t('stableBalance.disclaimerBody');
  if (!isOpen) return null;

  return (
    <DialogContainer>
      <DialogCard maxWidth="sm">
        <div className="text-center">
          <h3 className="font-display text-lg font-bold text-spark-text-primary mb-3">
            {resolvedTitle}
          </h3>
          <div className="text-sm text-spark-text-secondary mb-6 space-y-3">
            {resolvedDescription.split('\n\n').map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-xl font-display font-semibold text-sm border border-spark-border text-spark-text-secondary hover:bg-white/5 transition-colors"
            >
              {t('common:actions.cancel')}
            </button>
            <button
              onClick={onAccept}
              className="button flex-1 py-2.5"
            >
              {t('common:actions.enable')}
            </button>
          </div>
        </div>
      </DialogCard>
    </DialogContainer>
  );
};

export default StableBalanceDisclaimer;
