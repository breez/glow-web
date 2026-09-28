import React, { type ReactNode } from 'react';
import { RadioCheckIcon } from './Icons';
import { useTranslation } from 'react-i18next';

export type FeeSpeed = 'slow' | 'medium' | 'fast';

const SPEEDS: FeeSpeed[] = ['slow', 'medium', 'fast'];

/**
 * Slow, Medium and Fast as three cards, `detail` giving each one's second line.
 * The selected ring is inset: an outer one is clipped by any scrolling ancestor.
 */
export const FeeRateSelector: React.FC<{
  selected: FeeSpeed | null;
  onSelect: (speed: FeeSpeed) => void;
  detail: (speed: FeeSpeed) => ReactNode;
}> = ({ selected, onSelect, detail }) => {
  const { t } = useTranslation('common');
  return (
  <div>
    <span className="block text-sm font-medium text-spark-text-primary mb-2">{t('send.feeRate.title')}</span>
    <div className="flex gap-2">
      {SPEEDS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelect(key)}
          aria-pressed={selected === key}
          className={`relative flex-1 p-3 rounded-lg border text-sm font-medium transition-colors ${
            selected === key
              ? 'bg-spark-primary/15 text-spark-text-primary border-spark-primary inset-ring-2 inset-ring-spark-primary'
              : 'bg-spark-dark text-spark-text-secondary border-spark-border-light hover:border-spark-primary'
          }`}
        >
          {selected === key && <RadioCheckIcon className="absolute top-2 right-2" />}
          <div>{t(`send.feeRate.${key}`)}</div>
          <div className="text-xs opacity-70">{detail(key)}</div>
        </button>
      ))}
    </div>
  </div>
  );
};
