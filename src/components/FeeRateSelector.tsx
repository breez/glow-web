import React, { type ReactNode } from 'react';
import { RadioCheckIcon } from './Icons';

export type FeeSpeed = 'slow' | 'medium' | 'fast';

const SPEEDS: { key: FeeSpeed; label: string }[] = [
  { key: 'slow', label: 'Slow' },
  { key: 'medium', label: 'Medium' },
  { key: 'fast', label: 'Fast' },
];

/**
 * Slow, Medium and Fast as three cards, `detail` giving each one's second line.
 * The selected ring is inset: an outer one is clipped by any scrolling ancestor.
 */
export const FeeRateSelector: React.FC<{
  selected: FeeSpeed | null;
  onSelect: (speed: FeeSpeed) => void;
  detail: (speed: FeeSpeed) => ReactNode;
}> = ({ selected, onSelect, detail }) => (
  <div>
    <span className="block text-sm font-medium text-spark-text-primary mb-2">Select Fee Rate</span>
    <div className="flex gap-2">
      {SPEEDS.map(({ key, label }) => (
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
          <div>{label}</div>
          <div className="text-xs opacity-70">{detail(key)}</div>
        </button>
      ))}
    </div>
  </div>
);
