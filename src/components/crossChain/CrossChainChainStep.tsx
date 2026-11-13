import React from 'react';
import type { CrossChainRoutePair } from '@breeztech/breez-sdk-spark';
import { PrimaryButton } from '../ui';
import CryptoIcon from '../CryptoIcon';
import { crossChainCardClass } from '../../utils/crossChainRoutes';
import { formatChainName } from '../../utils/crossChainFormat';
import { useSheetBack, useSheetFullSnap, useSheetOwnsScroll } from '../ui/sheets/BottomSheetCardContext';
import { useTranslation } from 'react-i18next';

interface CrossChainChainStepProps {
  /** One representative route per chain group, in display order. */
  chains: CrossChainRoutePair[];
  /** Resolves a route to its chain group key (the value used for `pending`). */
  chainGroupKey: (route: CrossChainRoutePair) => string;
  /** Selected display asset, shown in the step label. */
  selectedAsset: string | null;
  /** Currently highlighted chain group key, or null. */
  pending: string | null;
  onPendingChange: (key: string) => void;
  onBack: () => void;
  onContinue: () => void;
  error?: string | null;
}

/** Network-selection step shared by the cross-chain send and receive workflows. */
export const CrossChainChainStep: React.FC<CrossChainChainStepProps> = ({
  chains,
  chainGroupKey,
  selectedAsset,
  pending,
  onPendingChange,
  onBack,
  onContinue,
  error,
}) => {
  const { t } = useTranslation('common');
  const isSheetFull = useSheetFullSnap();
  useSheetBack(onBack);
  useSheetOwnsScroll();

  return (
    <div
      className="flex flex-col"
      style={{ maxHeight: isSheetFull ? '85dvh' : '60dvh' }}
    >
      {error && (
        <div className="mb-4 p-3 bg-spark-warn-surface border border-spark-warn-border rounded-xl text-sm text-spark-warn-text shrink-0">
          {error}
        </div>
      )}
      <label className="block text-sm font-medium text-spark-text-primary mb-2 shrink-0">
        {t('send.crossChain.selectNetwork', { asset: selectedAsset })}
      </label>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-none touch-pan-y space-y-2 pe-1">
        {chains.map(r => {
          const key = chainGroupKey(r);
          return (
            <button
              key={key}
              onClick={() => onPendingChange(key)}
              className={crossChainCardClass(pending === key)}
            >
              <div className="flex items-center gap-3">
                <CryptoIcon chain={r.chain} size={32} />
                <span className="font-display font-medium text-spark-text-primary">
                  {formatChainName(r.chain)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="shrink-0 pt-2">
        <PrimaryButton onClick={onContinue} className="w-full" disabled={!pending}>
          Continue
        </PrimaryButton>
      </div>
    </div>
  );
};

export default CrossChainChainStep;
