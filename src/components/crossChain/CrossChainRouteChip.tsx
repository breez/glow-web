import React from 'react';
import CryptoIcon from '../CryptoIcon';
import { ChevronDownIcon, SpinnerIcon } from '../Icons';
import { formatChainName } from '../../utils/crossChainFormat';

interface CrossChainRouteChipProps {
  /** Raw chain name of the chosen network, e.g. "base". */
  chain: string | null;
  /** Display asset name, e.g. "USDC". */
  asset: string | null;
  /** Routes are still arriving and nothing is remembered to show meanwhile. */
  loading?: boolean;
  onClick: () => void;
  disabled?: boolean;
  'data-testid'?: string;
}

/** The network a cross-chain payment will use, and the way into changing it.
 *  A chip rather than a step of its own: it is the same one nearly every time,
 *  and it has to be on screen before the amount, which it governs. */
export const CrossChainRouteChip: React.FC<CrossChainRouteChipProps> = ({
  chain,
  asset,
  loading = false,
  onClick,
  disabled = false,
  'data-testid': testId,
}) => (
  <div>
    <label className="block text-sm font-medium text-spark-text-primary mb-2">Network</label>
    <button
      onClick={onClick}
      disabled={disabled}
      // Its own padding rather than the picker card's: this is a control that
      // sits in a column of fields, so it answers to the amount input's height
      // rather than to the list rows it opens.
      className="w-full p-3 rounded-2xl border bg-spark-dark border-spark-border hover:border-spark-border-light transition-all flex items-center justify-between disabled:opacity-60"
      data-testid={testId}
  >
      {chain && asset ? (
        <span className="flex items-center gap-2.5">
          <CryptoIcon chain={chain} size={32} />
          <span className="font-display font-medium text-spark-text-primary">
            {asset} on {formatChainName(chain)}
          </span>
        </span>
      ) : loading ? (
        // Only where nothing is remembered: a known network draws at once and
        // the fetch merely confirms it.
        <span className="flex items-center gap-2.5 text-spark-text-secondary">
          <SpinnerIcon size="sm" className="animate-spin" />
          <span className="font-display font-medium">Loading networks</span>
        </span>
      ) : (
        <span className="font-display font-medium text-spark-text-secondary">Select network</span>
      )}
      <ChevronDownIcon size="sm" className="text-spark-primary" />
    </button>
  </div>
);

export default CrossChainRouteChip;
