import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CrossChainAddressDetails, CrossChainRoutePair } from '@breeztech/breez-sdk-spark';
import { useWallet } from '@/contexts/WalletContext';
import { useStableBalance } from '@/contexts/StableBalanceContext';
import { getLastSendRoute, setLastSendRoute } from '@/services/settings';
import { useCrossChainRouteGroups } from '@/hooks/useCrossChainRouteGroups';
import {
  assetDisplayName,
  assetMatchesGroup,
  buildGroupLookup,
  chainGroupKey as chainGroupKeyOf,
  formatUsdLimits,
  routeNamedByDestination,
  sparkSideLimits,
} from '@/utils/crossChainRoutes';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';

export interface CrossChainSendRoute {
  routes: CrossChainRoutePair[];
  /** Display asset name of the chosen route, e.g. "USDC". */
  asset: string | null;
  /** Chain group key of the chosen route. */
  chain: string | null;
  /** A route on the chosen network, for the chip and for its bounds. */
  chipRoute: CrossChainRoutePair | null;
  /** What that network takes, or null when it publishes no bounds. */
  limitRange: string | null;
  /** Records the choice. `CrossChainWorkflow` reads it back and skips straight
   *  to the quote, which is what keeps the picker off the path once it has
   *  been answered. */
  choose: (asset: string, chain: string) => void;
}

/**
 * The network a cross-chain send will use, chosen before the amount rather
 * than after it: the amount says nothing about which network to use, while the
 * network decides the bounds and most of the fee. Seeded from the route this
 * recipient was last paid on, since an address is nearly always paid the same
 * way twice.
 */
export function useCrossChainSendRoute(addressDetails: CrossChainAddressDetails | null): CrossChainSendRoute {
  const wallet = useWallet();
  const stableBalance = useStableBalance();
  const [routes, setRoutes] = useState<CrossChainRoutePair[]>([]);
  const [choice, setChoice] = useState<{ address: string; asset: string; chain: string } | null>(null);
  const stableTokenIdentifier = stableBalance.isActive ? stableBalance.tokenIdentifier : null;
  // Reference-stable: the parsed input is held in the send flow's state and
  // only replaced when the destination is parsed again.
  const address = addressDetails?.address ?? null;

  useEffect(() => {
    if (!address || !addressDetails) return;
    let cancelled = false;
    wallet.getCrossChainRoutes({ type: 'send', addressDetails })
      .then(fetched => {
        if (cancelled) return;
        setRoutes(fetched);
        const remembered = getLastSendRoute(address);
        if (remembered) {
          setChoice({ address, ...remembered });
          return;
        }
        // A destination that names its own network and token settles the
        // choice without asking. Recorded like any other, since the chip
        // shows it before the amount and it can still be changed there.
        const lookup = buildGroupLookup(fetched);
        const named = routeNamedByDestination(fetched, addressDetails, r => chainGroupKeyOf(r, lookup));
        if (named) {
          const choice = { asset: assetDisplayName(named.asset), chain: chainGroupKeyOf(named, lookup) };
          setLastSendRoute(address, choice);
          setChoice({ address, ...choice });
        }
      })
      .catch(err => logger.warn(LogCategory.PAYMENT, 'Failed to fetch cross-chain send routes', { error: formatError(err) }));
    return () => { cancelled = true; };
  }, [wallet, address, addressDetails]);

  const { chainGroupKey } = useCrossChainRouteGroups(routes);
  const forThisAddress = choice && choice.address === address ? choice : null;

  const chipRoute = useMemo(() => {
    if (!forThisAddress) return null;
    return routes.find(r =>
      assetMatchesGroup(r.asset, forThisAddress.asset) && chainGroupKey(r) === forThisAddress.chain) ?? null;
  }, [routes, forThisAddress, chainGroupKey]);

  const choose = useCallback((asset: string, chain: string) => {
    if (!address) return;
    setLastSendRoute(address, { asset, chain });
    setChoice({ address, asset, chain });
  }, [address]);

  return {
    routes,
    asset: chipRoute ? forThisAddress!.asset : null,
    chain: chipRoute ? forThisAddress!.chain : null,
    chipRoute,
    limitRange: chipRoute ? formatUsdLimits(sparkSideLimits(chipRoute, stableTokenIdentifier)) : null,
    choose,
  };
}
