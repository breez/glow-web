import type { CrossChainRoutePair } from '@breeztech/breez-sdk-spark';

// Group asset variants under a canonical display name (e.g. USDT0 → USDT).
export const ASSET_DISPLAY_GROUP: Record<string, string> = { USDT0: 'USDT' };

export const assetDisplayName = (asset: string): string => ASSET_DISPLAY_GROUP[asset] ?? asset;

export const assetMatchesGroup = (routeAsset: string, group: string): boolean =>
  assetDisplayName(routeAsset) === group;

// Suffixes stripped when grouping chains so e.g. "Arbitrum" and "Arbitrum one",
// or "Polygon" and "Polygon POS", collapse into one network.
const CHAIN_SUFFIXES = [' one', ' pos', ' mainnet', ' network'];

export function normalizeChainName(chain: string): string {
  let name = chain.toLowerCase();
  for (const suffix of CHAIN_SUFFIXES) {
    if (name.endsWith(suffix)) {
      name = name.slice(0, -suffix.length);
      break;
    }
  }
  return name;
}

/** Maps each raw (lowercased) chain name to its normalized group key. */
export interface ChainGroupLookup {
  byChain: Map<string, string>;
}

export function buildGroupLookup(routes: CrossChainRoutePair[]): ChainGroupLookup {
  const byChain = new Map<string, string>();
  for (const r of routes) {
    const chainLower = r.chain.toLowerCase();
    if (!byChain.has(chainLower)) {
      byChain.set(chainLower, normalizeChainName(r.chain));
    }
  }
  return { byChain };
}

/** Group key for a route. Pass a lookup built from the full route set; falls
 *  back to normalizing the route's own chain name when no lookup is given (e.g.
 *  before route state has settled on mount). */
export function chainGroupKey(route: CrossChainRoutePair, lookup?: ChainGroupLookup): string {
  return lookup?.byChain.get(route.chain.toLowerCase()) ?? normalizeChainName(route.chain);
}

/** Shared card style for asset/chain/provider selection cards. */
export function crossChainCardClass(active = false): string {
  return `w-full p-4 rounded-2xl border text-left transition-all ${
    active
      ? 'bg-spark-primary/10 border-spark-primary'
      : 'bg-spark-dark border-spark-border hover:border-spark-border-light'
  }`;
}

/** Map a route quote/order error to a short user-facing message; `fallback` is
 *  used when the error isn't a recognized amount-bounds rejection. */
export function crossChainFriendlyError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : 'Unknown error';
  if (raw.includes('Amount too small')) return 'Amount too small for this route.';
  if (raw.includes('Amount too large')) return 'Amount too large for this route.';
  return fallback;
}
