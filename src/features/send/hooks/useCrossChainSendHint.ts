import { useEffect, useState } from 'react';
import type { CrossChainAddressDetails } from '@breeztech/breez-sdk-spark';
import { useWallet } from '@/contexts/WalletContext';
import { useStableBalance } from '@/contexts/StableBalanceContext';
import { getLastSendRoute } from '@/services/settings';
import {
  assetDisplayName,
  assetMatchesGroup,
  buildGroupLookup,
  chainGroupKey,
  formatUsdLimits,
  sparkSideLimits,
} from '@/utils/crossChainRoutes';
import { formatChainName } from '@/utils/crossChainFormat';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';

/**
 * The route a repeat recipient will be paid on, and what it takes, for the
 * amount field to state both before a quote exists. Naming the network is
 * what makes the bounds mean anything, and this route is the one the flow
 * will use without asking again. Null for an address with no remembered
 * route: the network is still open, and the routes an address offers publish
 * different bounds, so the narrowest would refuse amounts another takes.
 */
export function useCrossChainSendHint(addressDetails: CrossChainAddressDetails | null): string | null {
  const wallet = useWallet();
  const stableBalance = useStableBalance();
  // Carries the address it was resolved for, so a stale range is ignored on
  // read rather than cleared by the effect as the address changes.
  const [resolved, setResolved] = useState<{ address: string; range: string | null } | null>(null);
  const stableTokenIdentifier = stableBalance.isActive ? stableBalance.tokenIdentifier : null;
  // Reference-stable: the parsed input is held in the send flow's state and
  // only replaced when the destination is parsed again.
  const address = addressDetails?.address ?? null;

  useEffect(() => {
    const remembered = address ? getLastSendRoute(address) : null;
    if (!address || !remembered || !addressDetails) return;
    let cancelled = false;
    wallet.getCrossChainRoutes({ type: 'send', addressDetails })
      .then(routes => {
        if (cancelled) return;
        const lookup = buildGroupLookup(routes);
        const match = routes.find(r =>
          assetMatchesGroup(r.asset, remembered.asset) && chainGroupKey(r, lookup) === remembered.chain);
        if (!match) {
          setResolved({ address, range: null });
          return;
        }
        const route = `${assetDisplayName(match.asset)} on ${formatChainName(match.chain)}`;
        const bounds = formatUsdLimits(sparkSideLimits(match, stableTokenIdentifier));
        setResolved({ address, range: bounds ? `${route} · ${bounds}` : route });
      })
      .catch(err => logger.warn(LogCategory.PAYMENT, 'Failed to read cross-chain send limits', { error: formatError(err) }));
    return () => { cancelled = true; };
  }, [wallet, address, addressDetails, stableTokenIdentifier]);

  return resolved && resolved.address === address ? resolved.range : null;
}
