import React from 'react';
import CryptoIcon from '../CryptoIcon';
import { ChevronDownIcon, RefreshIcon, SpinnerIcon } from '../Icons';
import { formatChainName } from '../../utils/crossChainFormat';

interface CrossChainRouteChipProps {
  /** Raw chain name of the chosen network, e.g. "base". */
  chain: string | null;
  /** Display asset name, e.g. "USDC". */
  asset: string | null;
  /** Routes are still arriving and nothing is remembered to show meanwhile. */
  loading?: boolean;
  /** The route fetch gave up. Tapping retries instead of opening the picker,
   *  and a remembered name is not shown: nothing has confirmed it still runs. */
  failed?: boolean;
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
  failed = false,
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
      // rather than to the list rows it opens. The height is held because only
      // the named state carries a 32px icon, and the field below would shift
      // when the routes land.
      //
      // Padding is asymmetric so the two rows line up: `pl-4` puts the leading
      // item on the amount field's text, and `pr-5` carries the trailing glyph
      // in by the currency pill's own padding, which is what the eye reads it
      // against.
      className="w-full py-3 pl-4 pr-5 min-h-[58px] rounded-2xl border bg-spark-dark border-spark-border hover:border-spark-border-light transition-all flex items-center justify-between disabled:opacity-60"
      data-testid={testId}
  >
      {failed ? (
        <span className="font-display font-medium text-spark-text-secondary">Networks unavailable</span>
      ) : chain && asset ? (
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
      {failed
        ? <RefreshIcon size="sm" className="text-spark-primary" />
        : <ChevronDownIcon size="sm" className="text-spark-primary" />}
    </button>
  </div>
);

export default CrossChainRouteChip;
