import React from 'react';
import { formatWithSpaces } from '../utils/formatNumber';

/**
 * Reusable component for displaying payment fee breakdowns.
 * Used in send confirmation, deposit claims, and other payment flows.
 */

export interface FeeBreakdownItem {
  label: string;
  value: number | bigint;
  unit?: string;
  highlight?: boolean;
}

export interface FeeBreakdownCardProps {
  items: FeeBreakdownItem[];
  /** Optional className for additional styling */
  className?: string;
}

/**
 * Displays a breakdown of fees/amounts with consistent styling.
 *
 * @example
 * <FeeBreakdownCard
 *   items={[
 *     { label: 'Amount', value: 10000 },
 *     { label: 'Network fee', value: 150 },
 *     { label: 'Total', value: 10150, highlight: true },
 *   ]}
 * />
 */
export const FeeBreakdownCard: React.FC<FeeBreakdownCardProps> = ({
  items,
  className = '',
}) => {
  return (
    <div className={`bg-spark-dark/50 border border-spark-border rounded-2xl p-4 space-y-3 ${className}`}>
      {items.map((item, index) => (
        <React.Fragment key={item.label}>
          {index > 0 && <div className="border-t border-spark-border/50" />}
          <div className="flex justify-between items-center">
            <span className={`text-sm ${item.highlight ? 'text-spark-text-primary font-semibold' : 'text-spark-text-secondary'}`}>
              {item.label}
            </span>
            <span className={`font-mono text-sm ${item.highlight ? 'font-bold text-spark-primary' : 'text-spark-text-primary'}`}>
              {formatWithSpaces(item.value)} {item.unit ?? 'sats'}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
};

/**
 * Simplified version for the common amount + fee + total pattern.
 */
export interface SimpleFeeBreakdownProps {
  amount: number | bigint;
  fee: number | bigint;
  /** Optional custom label for the amount row */
  amountLabel?: string;
  /** Optional custom label for the fee row */
  feeLabel?: string;
  className?: string;
}

export const SimpleFeeBreakdown: React.FC<SimpleFeeBreakdownProps> = ({
  amount,
  fee,
  amountLabel = 'Amount',
  feeLabel = 'Network fee',
  className = '',
}) => {
  const total = Number(amount) + Number(fee);

  return (
    <FeeBreakdownCard
      className={className}
      items={[
        { label: amountLabel, value: amount },
        { label: feeLabel, value: fee },
        { label: 'Total', value: total, highlight: true },
      ]}
    />
  );
};

export default FeeBreakdownCard;
