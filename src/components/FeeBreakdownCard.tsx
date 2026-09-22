import React, { type ReactNode } from 'react';
import { SatAmount } from './SatAmount';

/**
 * Reusable component for displaying payment fee breakdowns.
 * Used in send confirmation, deposit claims, and other payment flows.
 */

export interface FeeBreakdownItem {
  label: string;
  value?: number | bigint | string;
  /** Rendered in place of `value`, for a row that carries its own controls.
   *  Inherits the value column's mono styling. */
  node?: ReactNode;
  /** Full-width panel under this row, for what a control in it opens. */
  expansion?: ReactNode;
  /** No figure yet: the row keeps its place with a dash, so a card doesn't
   *  grow a row under the reader once the number lands. */
  pending?: boolean;
  unit?: string;
  highlight?: boolean;
  /**
   * Lifts a row without giving it the accent: for the figure a control on the
   * screen changes, where `highlight` is reserved for the one the user is
   * actually here for. Ignored on a `highlight` row.
   */
  emphasis?: boolean;
  /** Marks a sat figure that is an estimate. */
  approximate?: boolean;
  /** Marks a figure taken off the one above it, with a minus sign. */
  subtract?: boolean;
}

export interface FeeBreakdownCardProps {
  items: FeeBreakdownItem[];
  /** When true, values are pre-formatted strings — skip numeric formatting and unit suffix */
  useRawStrings?: boolean;
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
  useRawStrings = false,
  className = '',
}) => {
  return (
    <div className={`bg-spark-dark/50 border border-spark-border rounded-2xl p-4 space-y-3 ${className}`}>
      {items.map((item, index) => (
        <React.Fragment key={item.label}>
          {index > 0 && <div className="border-t border-spark-border/50" />}
          <div>
          <div className="flex justify-between items-center">
            <span className={`text-sm ${item.highlight ? 'text-spark-text-primary font-semibold' : item.emphasis ? 'text-spark-text-primary' : 'text-spark-text-secondary'}`}>
              {item.label}
            </span>
            <span className={`font-mono text-sm ${item.highlight ? 'font-bold text-spark-primary' : item.emphasis ? 'font-semibold text-spark-text-primary' : 'text-spark-text-primary'}`}>
              {item.node
                ? item.node
                : item.pending
                ? <span className="text-spark-text-muted">&mdash;</span>
                : useRawStrings || typeof item.value === 'string'
                ? String(item.value)
                : item.value === undefined || Number(item.value) === 0 ? '0' : (
                  <>
                    {item.subtract && '−'}
                    <SatAmount sats={item.value} approximate={item.approximate} />
                  </>
                )
              }
            </span>
          </div>
          {item.expansion}
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
  amount: number | bigint | string;
  fee: number | bigint | string;
  /** When true, values are pre-formatted strings — skip numeric formatting and unit suffix */
  useRawStrings?: boolean;
  /** Optional custom label for the amount row */
  amountLabel?: string;
  /** Optional custom label for the fee row */
  feeLabel?: string;
  className?: string;
}

export const SimpleFeeBreakdown: React.FC<SimpleFeeBreakdownProps> = ({
  amount,
  fee,
  useRawStrings = false,
  amountLabel = 'Amount',
  feeLabel = 'Network fee',
  className = '',
}) => {
  if (useRawStrings) {
    return (
      <FeeBreakdownCard
        className={className}
        useRawStrings
        items={[
          { label: amountLabel, value: String(amount) },
          { label: feeLabel, value: String(fee) },
        ]}
      />
    );
  }

  const total = Number(amount) + Number(fee);
  return (
    <FeeBreakdownCard
      className={className}
      useRawStrings={useRawStrings}
      items={[
        { label: amountLabel, value: amount },
        { label: feeLabel, value: fee },
        { label: 'Total', value: total, highlight: true },
      ]}
    />
  );
};

export default FeeBreakdownCard;
