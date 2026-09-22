import React from 'react';
import type { CrossChainRoutePair } from '@breeztech/breez-sdk-spark';
import CryptoIcon from '../CryptoIcon';
import { ChevronDownIcon } from '../Icons';
import { formatChainName } from '../../utils/crossChainFormat';

interface CrossChainRouteChipProps {
  /** A route on the chosen network, for its chain icon and name. */
  route: CrossChainRoutePair | null;
  /** Display asset name, e.g. "USDC". */
  asset: string | null;
  onClick: () => void;
  disabled?: boolean;
  'data-testid'?: string;
}

/** The network a cross-chain payment will use, and the way into changing it.
 *  A chip rather than a step of its own: it is the same one nearly every time,
 *  and it has to be on screen before the amount, which it governs. */
export const CrossChainRouteChip: React.FC<CrossChainRouteChipProps> = ({
  route,
  asset,
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
      {route && asset ? (
      <span className="flex items-center gap-2.5">
        <CryptoIcon chain={route.chain} size={32} />
        <span className="font-display font-medium text-spark-text-primary">
          {asset} on {formatChainName(route.chain)}
        </span>
      </span>
      ) : (
      <span className="font-display font-medium text-spark-text-secondary">Select network</span>
      )}
      <ChevronDownIcon size="sm" className="text-spark-primary" />
    </button>
  </div>
);

export default CrossChainRouteChip;
