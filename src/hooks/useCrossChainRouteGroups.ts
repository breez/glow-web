import { useCallback, useMemo } from 'react';
import type { CrossChainRoutePair } from '@breeztech/breez-sdk-spark';
import {
  assetDisplayName,
  assetMatchesGroup,
  buildGroupLookup,
  chainGroupKey as chainGroupKeyOf,
  type ChainGroupLookup,
} from '../utils/crossChainRoutes';

export interface CrossChainRouteGroups {
  /** Unique display asset names (e.g. "USDC", "USDT"), sorted. */
  uniqueAssets: string[];
  /** Group key for a route, resolved against the full route set. */
  chainGroupKey: (route: CrossChainRoutePair) => string;
  /** One representative route per chain group for a display asset, sorted by
   *  chain name (keeps the shortest raw chain name as the display label). */
  getChainsForAsset: (asset: string) => CrossChainRoutePair[];
}

/** Derives the asset/chain groupings used by both cross-chain workflows from a
 *  route set. Pure grouping logic lives in `utils/crossChainRoutes`; this hook
 *  just memoizes it against `routes`. */
export function useCrossChainRouteGroups(routes: CrossChainRoutePair[]): CrossChainRouteGroups {
  const groupLookup = useMemo<ChainGroupLookup>(() => buildGroupLookup(routes), [routes]);

  const chainGroupKey = useCallback(
    (route: CrossChainRoutePair) => chainGroupKeyOf(route, groupLookup),
    [groupLookup],
  );

  const uniqueAssets = useMemo(
    () => [...new Set(routes.map(r => assetDisplayName(r.asset)))].sort(),
    [routes],
  );

  const getChainsForAsset = useCallback(
    (asset: string) => {
      const matching = routes.filter(r => assetMatchesGroup(r.asset, asset));
      const groups = new Map<string, CrossChainRoutePair>();
      for (const r of matching) {
        const key = chainGroupKey(r);
        const existing = groups.get(key);
        if (!existing || r.chain.length < existing.chain.length) {
          groups.set(key, r);
        }
      }
      return [...groups.values()].sort((a, b) => a.chain.localeCompare(b.chain));
    },
    [routes, chainGroupKey],
  );

  return { uniqueAssets, chainGroupKey, getChainsForAsset };
}
