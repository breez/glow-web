import React, { useEffect, useState, type ReactNode } from 'react';
import { PrimaryButton } from '../../../components/ui';
import { CloseIcon } from '../../../components/Icons';
import GlowLogo from '../../../components/GlowLogo';
import { hapticLight } from '@/utils/haptics';
import { useTranslation } from 'react-i18next';

export interface ResultStepProps {
  result: 'success' | 'failure';
  error: string | null;
  onClose: () => void;
  /** Operation type to customize messaging (default: 'payment') */
  operationType?: 'payment' | 'auth' | 'refund';
  /** Replaces the operation's default success line. */
  description?: string;
  /** Shown on success between the description and Done, e.g. a transaction ID. */
  children?: ReactNode;
}

const ResultStep: React.FC<ResultStepProps> = ({ result, error, onClose, operationType = 'payment', description, children }) => {
  const { t } = useTranslation(['critical', 'common']);
  const isSuccess = result === 'success';
  const [starsAnimating, setStarsAnimating] = useState(false);

  useEffect(() => {
    if (isSuccess) {
      void hapticLight();
      const timer = setTimeout(() => setStarsAnimating(true), 300);
      return () => clearTimeout(timer);
    }
  }, [isSuccess]);

  const getTitle = () => {
    if (operationType === 'auth') {
      return t('send.authenticated');
    }
    if (operationType === 'refund') {
      return isSuccess ? t('send.result.refundSent') : t('send.result.refundFailed');
    }
    return isSuccess ? t('send.sent') : t('send.failed');
  };

  const getSuccessDescription = () => {
    if (description) return description;
    if (operationType === 'refund') {
      return t('send.result.refundSuccessBody');
    }
    return t('send.result.sentBody');
  };

  const getDefaultErrorMessage = () => {
    if (operationType === 'refund') {
      return t('send.result.refundFailBody');
    }
    return t('send.result.failBody');
  };

  if (!isSuccess) {
    // Payment failure: circular error icon with glow
    return (
      <div className="flex flex-col items-center justify-center py-4" data-testid="payment-failure">
        <div className="relative mb-6">
          {/* Error glow */}
          <div className="absolute inset-0 w-20 h-20 rounded-full blur-xl bg-spark-primary/30" />

          {/* Error icon */}
          <div className="relative w-20 h-20 rounded-full flex items-center justify-center bg-spark-primary/20 border-2 border-spark-primary">
            <CloseIcon className="w-10 h-10 text-spark-primary" />
          </div>
        </div>

        <h3 className="font-display text-2xl font-bold mb-2 text-spark-primary">
          {getTitle()}
        </h3>

        <p className="text-spark-text-secondary text-center max-w-xs mb-8">
          {error || getDefaultErrorMessage()}
        </p>

        <PrimaryButton onClick={onClose} className="min-w-[200px]">
          {t('common:actions.close')}
        </PrimaryButton>
      </div>
    );
  }

  // Success: show icon, title, description, and done button
  return (
    <div className="flex flex-col items-center justify-center py-4" data-testid={isSuccess ? 'payment-success' : 'payment-failure'}>
      {/* Result icon */}
      <div className="relative mb-6">
        {/* Glow effect */}
        <div className="absolute -inset-3 rounded-full blur-xl" style={{ background: 'rgba(212,165,116,0.20)' }} />

        {/* Logo */}
        <div className="relative w-20 h-20 flex items-center justify-center">
          <GlowLogo
            sizePx={64}
            starsAnimating={starsAnimating}
            imgClassName="drop-shadow-[0_0_20px_rgba(212,165,116,0.5)]"
          />
        </div>
      </div>

      {/* Title */}
      <h3 className="font-display text-2xl font-bold mb-2 text-spark-primary">
        {getTitle()}
      </h3>

      {/* Description */}
      <p className="text-spark-text-secondary text-center max-w-xs mb-8">
        {getSuccessDescription()}
      </p>

      {children && <div className="w-full mb-8">{children}</div>}

      {/* Action button */}
      <PrimaryButton onClick={onClose} className="min-w-[200px]">
        {t('common:actions.done')}
      </PrimaryButton>
    </div>
  );
};

export default ResultStep;
