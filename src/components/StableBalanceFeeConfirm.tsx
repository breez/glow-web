import React from 'react';
import { DialogContainer, DialogCard } from './ui';
import { SpinnerIcon } from './Icons';
import { formatTokenAmount, type TokenDisplayConfig } from '../utils/tokenFormatting';
import type { ConversionEstimate } from '@breeztech/breez-sdk-spark';
import { useTranslation } from 'react-i18next';

interface StableBalanceFeeConfirmProps {
  isOpen: boolean;
  direction: 'toToken' | 'toBitcoin';
  conversionEstimate: ConversionEstimate | null;
  displayConfig: TokenDisplayConfig | null;
  isEstimating: boolean;
  isExecuting: boolean;
  error: string | null;
  info: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const StableBalanceFeeConfirm: React.FC<StableBalanceFeeConfirmProps> = ({
  isOpen,
  direction,
  conversionEstimate,
  displayConfig,
  isEstimating,
  isExecuting,
  error,
  info,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation(['critical', 'common']);
  if (!isOpen) return null;

  const title = direction === 'toToken' ? t('stableBalance.convertToUsd') : t('stableBalance.convertToBtc');
  const description = direction === 'toToken'
    ? t('stableBalance.toUsd')
    : t('stableBalance.toBtc');

  const feeText = conversionEstimate && displayConfig
    ? formatTokenAmount(conversionEstimate.fee, displayConfig, { fullPrecision: true })
    : null;

  return (
    <DialogContainer>
      <DialogCard maxWidth="sm">
        <div className="text-center">
          <h3 className="font-display text-lg font-bold text-spark-text-primary mb-2">
            {title}
          </h3>
          <p className="text-sm text-spark-text-secondary mb-4">
            {description}
          </p>

          {isEstimating && (
            <div className="flex items-center justify-center py-6">
              <SpinnerIcon size="lg" />
            </div>
          )}

          {!isEstimating && feeText && (
            <p className="text-sm text-spark-text-secondary mb-4">
              {t('stableBalance.conversionFee')} <span className="font-mono text-spark-text-primary">{feeText}</span>
            </p>
          )}

          {!isEstimating && !feeText && !error && info && (
            <p className="text-sm text-spark-text-muted mb-4">
              {info}
            </p>
          )}

          {!isEstimating && !feeText && !error && !info && (
            <p className="text-sm text-spark-text-muted mb-4">
              {t('stableBalance.feeUnavailable')}
            </p>
          )}

          {error && (
            <p className="text-sm text-spark-primary mb-4">{error}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              disabled={isExecuting}
              className="flex-1 py-2.5 rounded-xl font-display font-semibold text-sm border border-spark-border text-spark-text-secondary hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              {t('common:actions.cancel')}
            </button>
            <button
              onClick={onConfirm}
              disabled={isEstimating || isExecuting || !!error}
              className="button flex-1 py-2.5 disabled:opacity-50"
            >
              {isExecuting ? (
                <span className="flex items-center justify-center gap-2">
                  <SpinnerIcon size="md" />
                </span>
              ) : (
                t('common:actions.confirm')
              )}
            </button>
          </div>
        </div>
      </DialogCard>
    </DialogContainer>
  );
};

export default StableBalanceFeeConfirm;
