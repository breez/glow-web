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
  /** States the route on a screen that cannot change it: no label above, no
   *  chevron, not a control. */
  readOnly?: boolean;
  /** Who carries the transfer, named beside the route once it is settled.
   *  Absent while the route is still being chosen: no provider is picked yet. */
  provider?: string | null;
  onClick?: () => void;
  disabled?: boolean;
  'data-testid'?: string;
}

// Its own padding rather than the picker card's: this is a control that sits in
// a column of fields, so it answers to the amount input's height rather than to
// the list rows it opens. The height is held because only the named state
// carries a 32px icon, and the field below would shift when the routes land.
//
// Padding is asymmetric so the two rows line up: `pl-4` puts the leading item on
// the amount field's text, and `pr-5` carries the trailing glyph in by the
// currency pill's own padding, which is what the eye reads it against.
const CHIP_CLASS =
  'w-full py-3 pl-4 pr-5 min-h-[58px] rounded-2xl border bg-spark-dark border-spark-border flex items-center justify-between';

/** The network a cross-chain payment will use, and the way into changing it.
 *  A chip rather than a step of its own: it is the same one nearly every time,
 *  and it has to be on screen before the amount, which it governs. */
export const CrossChainRouteChip: React.FC<CrossChainRouteChipProps> = ({
  chain,
  asset,
  loading = false,
  failed = false,
  readOnly = false,
  provider = null,
  onClick,
  disabled = false,
  'data-testid': testId,
}) => {
  const body = failed ? (
    <span className="font-display font-medium text-spark-text-secondary">Networks unavailable</span>
  ) : chain && asset ? (
    <span className="flex items-center gap-2.5">
      <CryptoIcon chain={chain} size={32} />
      <span className="font-display font-medium text-spark-text-primary">
        {asset} on {formatChainName(chain)}
        {/* Wraps as a unit, so a long chain name breaks before it rather than
            leaving "via" at the end of the line. */}
        {provider && <span className="text-spark-text-secondary whitespace-nowrap"> · via {provider}</span>}
      </span>
    </span>
  ) : loading ? (
    // Only where nothing is remembered: a known network draws at once and the
    // fetch merely confirms it.
    <span className="flex items-center gap-2.5 text-spark-text-secondary">
      <SpinnerIcon size="sm" className="animate-spin" />
      <span className="font-display font-medium">Loading networks</span>
    </span>
  ) : (
    <span className="font-display font-medium text-spark-text-secondary">Select network</span>
  );

  // Stated, not chosen: it sits as a card's top row, so it drops the border
  // and background that would otherwise say "tappable" inside one.
  if (readOnly) {
    return <div data-testid={testId}>{body}</div>;
  }

  return (
    <div>
      <label className="block text-sm font-medium text-spark-text-primary mb-2">Network</label>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`${CHIP_CLASS} hover:border-spark-border-light transition-all disabled:opacity-60`}
        data-testid={testId}
      >
        {body}
        {failed
          ? <RefreshIcon size="sm" className="text-spark-primary" />
          : <ChevronDownIcon size="sm" className="text-spark-primary" />}
      </button>
    </div>
  );
};

export default CrossChainRouteChip;
