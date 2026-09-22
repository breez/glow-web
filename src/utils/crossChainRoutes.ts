import type { CrossChainRouteLimits, CrossChainRoutePair } from '@breeztech/breez-sdk-spark';
import { formatUsdCents } from './crossChainFormat';

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
 *  used when the error isn't recognized. A rate drift is a quote the network's
 *  fees took too large a share of. */
export function crossChainFriendlyError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : 'Unknown error';
  if (raw.includes('Cross-chain route temporarily unavailable')) return 'This network is temporarily unavailable. Try again in a moment.';
  if (raw.includes('Cross-chain route not supported')) return "This network isn't available. Try another network.";
  if (raw.includes('Amount too small')) return 'Amount too small for this route.';
  if (raw.includes('Amount too large')) return 'Amount too large for this route.';
  if (raw.includes('rate drift')) return 'Amount too small for this network. Try a larger amount or another network.';
  return fallback;
}

/** Whether a receive on this route lands where this wallet can show and spend
 *  it: bitcoin, or the USD token while the USD balance is on. The SDK lists
 *  every route the provider serves, including ones that land only a token,
 *  which a receive here would fail on (breez/spark-sdk#1150). */
export function landsInThisWallet(route: CrossChainRoutePair, stableTokenIdentifier: string | null): boolean {
  return route.acceptedAssets.some(({ asset }) =>
    asset.type === 'bitcoin'
    || (asset.type === 'token' && asset.tokenIdentifier === stableTokenIdentifier));
}

/** Limits for the Spark-side asset this route would use: the destination on a
 *  receive, the source on a send. Mirrors the SDK's own preference, the active
 *  stable token when the route takes it and otherwise bitcoin, since the
 *  bounds are published per accepted asset and the two can differ. */
export function sparkSideLimits(
  route: CrossChainRoutePair,
  stableTokenIdentifier: string | null,
): CrossChainRouteLimits | null {
  const token = stableTokenIdentifier
    ? route.acceptedAssets.find(({ asset }) =>
        asset.type === 'token' && asset.tokenIdentifier === stableTokenIdentifier)
    : undefined;
  const landing = token ?? route.acceptedAssets.find(({ asset }) => asset.type === 'bitcoin');
  return landing?.limits ?? null;
}

/** The bounds as the amount field states them, or null when the provider
 *  publishes neither. Orchestra gives a bound in base units or in USD cents
 *  and not always both; the field asks for dollars, so it reads the cents.
 *  The en dash is the one place the house style allows one: it matches the
 *  limits row the LNURL amount field already shows. */
export function formatUsdLimits(limits: CrossChainRouteLimits | null): string | null {
  const min = limits?.minUsdCents;
  const max = limits?.maxUsdCents;
  if (min !== undefined && max !== undefined) return `${formatUsdCents(min)} – ${formatUsdCents(max)}`;
  if (min !== undefined) return `From ${formatUsdCents(min)}`;
  if (max !== undefined) return `Up to ${formatUsdCents(max)}`;
  return null;
}

/** The one route a destination names outright, or null when it names none or
 *  leaves a choice open. A cross-chain URI carries the chain id and the token
 *  contract, which between them settle both the network and the coin; a bare
 *  address carries neither, and only its family narrows anything. */
export function routeNamedByDestination(
  routes: CrossChainRoutePair[],
  details: { chainId?: number; contractAddress?: string },
  groupKey: (route: CrossChainRoutePair) => string,
): CrossChainRoutePair | null {
  const contract = details.contractAddress?.toLowerCase();
  const chainId = details.chainId === undefined ? undefined : String(details.chainId);
  if (!contract && !chainId) return null;
  const matching = routes.filter(r =>
    (!contract || r.contractAddress?.toLowerCase() === contract)
    && (!chainId || r.chainId === chainId));
  if (matching.length === 0) return null;
  // Several providers may serve the same pair; a choice is only open when the
  // coin or the network still differs between them.
  const groups = new Set(matching.map(r => `${assetDisplayName(r.asset)}|${groupKey(r)}`));
  return groups.size === 1 ? matching[0] : null;
}
