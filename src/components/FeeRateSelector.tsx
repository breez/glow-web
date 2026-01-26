import React from 'react';
import { formatWithSpaces } from '../utils/formatNumber';
import { CheckIcon } from './Icons';

/**
 * Fee rate option for the FeeRateSelector component.
 */
export interface FeeRateOption {
  id: string;
  label: string;
  sats: number;
}

/**
 * Default fee rate options (slow, medium, fast).
 */
export const DEFAULT_FEE_RATES: FeeRateOption[] = [
  { id: 'slow', label: 'Slow', sats: 500 },
  { id: 'medium', label: 'Medium', sats: 1000 },
  { id: 'fast', label: 'Fast', sats: 2000 },
];

export interface FeeRateSelectorProps {
  /** Array of fee rate options to display */
  options?: FeeRateOption[];
  /** Currently selected fee rate ID */
  selectedId: string | null;
  /** Callback when a fee rate is selected */
  onSelect: (id: string) => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * FeeRateSelector - Grid of fee rate buttons for selecting network fees.
 *
 * @example
 * const [feeRate, setFeeRate] = useState<string | null>(null);
 *
 * <FeeRateSelector
 *   selectedId={feeRate}
 *   onSelect={setFeeRate}
 * />
 *
 * // Or with custom options:
 * <FeeRateSelector
 *   options={[
 *     { id: 'economy', label: 'Economy', sats: 250 },
 *     { id: 'standard', label: 'Standard', sats: 500 },
 *     { id: 'priority', label: 'Priority', sats: 1500 },
 *   ]}
 *   selectedId={feeRate}
 *   onSelect={setFeeRate}
 * />
 */
export const FeeRateSelector: React.FC<FeeRateSelectorProps> = ({
  options = DEFAULT_FEE_RATES,
  selectedId,
  onSelect,
  className = '',
}) => {
  return (
    <div className={`grid grid-cols-3 gap-2 ${className}`}>
      {options.map((option) => {
        const isSelected = selectedId === option.id;
        return (
          <button
            key={option.id}
            onClick={() => onSelect(option.id)}
            className={`
              relative p-3 rounded-lg border text-sm font-medium transition-colors
              ${isSelected
                ? 'bg-[rgb(var(--primary-blue))] text-white border-[rgb(var(--primary-blue))] ring-2 ring-[rgb(var(--primary-blue))]'
                : 'bg-[rgb(var(--card-bg))] text-[rgb(var(--text-white))] border-[rgb(var(--card-border))] hover:border-[rgb(var(--primary-blue))]'
              }
            `}
          >
            {isSelected && (
              <CheckIcon size="sm" className="absolute top-2 right-2" />
            )}
            <div>{option.label}</div>
            <div className="text-xs opacity-70">
              {formatWithSpaces(option.sats)} sats
            </div>
          </button>
        );
      })}
    </div>
  );
};

/**
 * Hook for managing fee rate selection state.
 */
export function useFeeRateSelection(options: FeeRateOption[] = DEFAULT_FEE_RATES) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const selectedOption = React.useMemo(
    () => options.find((o) => o.id === selectedId) ?? null,
    [options, selectedId]
  );

  const selectedSats = selectedOption?.sats ?? 0;

  return {
    selectedId,
    setSelectedId,
    selectedOption,
    selectedSats,
    options,
  };
}

export default FeeRateSelector;
