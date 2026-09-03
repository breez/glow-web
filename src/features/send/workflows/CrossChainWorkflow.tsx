import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  ConversionOptions,
  CrossChainAddressDetails,
  CrossChainRoutePair,
  PrepareSendPaymentResponse,
} from '@breeztech/breez-sdk-spark';
import { PrimaryButton, SecondaryButton } from '../../../components/ui';
import { SpinnerIcon } from '../../../components/Icons';
import { FeeBreakdownCard } from '../../../components/FeeBreakdownCard';
import { CrossChainAssetStep } from '../../../components/crossChain/CrossChainAssetStep';
import { CrossChainChainStep } from '../../../components/crossChain/CrossChainChainStep';
import { useWallet } from '../../../contexts/WalletContext';
import { useStableBalance } from '../../../contexts/StableBalanceContext';
import { SatAmount } from '../../../components/SatAmount';
import { useCrossChainRouteGroups } from '../../../hooks/useCrossChainRouteGroups';
import { formatTokenAmount } from '../../../utils/tokenFormatting';
import { logger, LogCategory } from '@/services/logger';
import { getProviderDisplayName } from '../../../utils/paymentDescription';
import { truncateAddress, formatChainName, formatCrossChainAmount, formatReceiveAmount } from '../../../utils/crossChainFormat';
import {
  assetDisplayName,
  assetMatchesGroup,
  buildGroupLookup,
  chainGroupKey as chainGroupKeyWith,
  crossChainCardClass,
  crossChainFriendlyError,
} from '../../../utils/crossChainRoutes';
import { formatError } from '@/utils/formatError';

type WorkflowStep = 'loading' | 'asset' | 'chain' | 'provider' | 'confirm';

interface CrossChainWorkflowProps {
  addressDetails: CrossChainAddressDetails;
  amountSats: number;
  feesIncluded: boolean;
  tokenIdentifier?: string | null;
  conversionOptions?: ConversionOptions | null;
  onBack: () => void;
  onRun: (runner: () => Promise<void>) => Promise<void>;
}

interface ProviderQuote {
  route: CrossChainRoutePair;
  response: PrepareSendPaymentResponse | null;
  error: string | null;
  loading: boolean;
}

const CrossChainWorkflow: React.FC<CrossChainWorkflowProps> = ({
  addressDetails,
  amountSats,
  feesIncluded,
  tokenIdentifier,
  conversionOptions,
  onBack,
  onRun,
}) => {
  const wallet = useWallet();
  const stableBalance = useStableBalance();
  const [step, setStep] = useState<WorkflowStep>('loading');
  const [routes, setRoutes] = useState<CrossChainRoutePair[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [prepareResponse, setPrepareResponse] = useState<PrepareSendPaymentResponse | null>(null);
  const [providerQuotes, setProviderQuotes] = useState<Map<string, ProviderQuote>>(new Map());
  const [error, setError] = useState<string | null>(null);
  // Pending selections (user highlights, then clicks Continue)
  const [pendingAsset, setPendingAsset] = useState<string | null>(null);
  const [pendingChain, setPendingChain] = useState<string | null>(null);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);

  // Stable balance detection
  const useUsdb = stableBalance.isActive && !!stableBalance.tokenIdentifier && stableBalance.btcFiatRate > 0 && !!stableBalance.displayConfig;
  const effectiveAmount = tokenIdentifier
    ? BigInt(amountSats)
    : useUsdb
      ? BigInt(Math.round(amountSats * stableBalance.btcFiatRate * (10 ** stableBalance.displayConfig!.decimals) / 100_000_000))
      : BigInt(amountSats);
  const effectiveTokenId = tokenIdentifier ?? (useUsdb ? stableBalance.tokenIdentifier! : undefined);

  // Derived asset/chain groupings (shared with the receive workflow)
  const { uniqueAssets, chainGroupKey, getChainsForAsset } = useCrossChainRouteGroups(routes);
  const chainsForAsset = useMemo(
    () => (selectedAsset ? getChainsForAsset(selectedAsset) : []),
    [selectedAsset, getChainsForAsset],
  );

  const routesForSelection = useMemo(
    () => {
      if (!selectedAsset || !selectedChain) return [];
      return routes.filter(r => assetMatchesGroup(r.asset, selectedAsset) && chainGroupKey(r) === selectedChain);
    },
    [routes, selectedAsset, selectedChain, chainGroupKey]
  );

  // Prepare a single route
  const prepareRoute = useCallback(async (route: CrossChainRoutePair): Promise<PrepareSendPaymentResponse> => {
    return wallet.prepareSendPayment({
      paymentRequest: { type: 'crossChain', address: addressDetails.address, route },
      amount: effectiveAmount,
      feePolicy: feesIncluded ? 'feesIncluded' : undefined,
      tokenIdentifier: effectiveTokenId,
      conversionOptions: conversionOptions ?? undefined,
    });
  }, [wallet, addressDetails.address, effectiveAmount, effectiveTokenId, feesIncluded, conversionOptions]);

  // Prepare all providers in parallel for provider step
  const prepareAllProviders = useCallback((providerRoutes: CrossChainRoutePair[]) => {
    const initial = new Map<string, ProviderQuote>();
    providerRoutes.forEach(r => {
      initial.set(r.provider, { route: r, response: null, error: null, loading: true });
    });
    setProviderQuotes(new Map(initial));

    providerRoutes.forEach(async (r) => {
      try {
        const response = await prepareRoute(r);
        setProviderQuotes(prev => {
          const next = new Map(prev);
          next.set(r.provider, { route: r, response, error: null, loading: false });
          return next;
        });
      } catch (err) {
        logger.error(LogCategory.PAYMENT, 'Failed to prepare cross-chain payment', { error: formatError(err), provider: r.provider });
        setProviderQuotes(prev => {
          const next = new Map(prev);
          next.set(r.provider, { route: r, response: null, error: crossChainFriendlyError(err, 'Failed to get quote.'), loading: false });
          return next;
        });
      }
    });
  }, [prepareRoute]);

  // Advance from asset selection (asset is the display group name, e.g. "USDT" not "USDT0")
  const selectAsset = useCallback((asset: string, allRoutes: CrossChainRoutePair[]) => {
    setSelectedAsset(asset);
    const lookup = buildGroupLookup(allRoutes);
    const matching = allRoutes.filter(r => assetMatchesGroup(r.asset, asset));
    const chainKeys = [...new Set(matching.map(r => chainGroupKeyWith(r, lookup)))];
    if (chainKeys.length === 1) {
      selectChain(asset, chainKeys[0], allRoutes);
    } else {
      setStep('chain');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Advance from chain selection (chainKey is contract address or chain name, lowercased)
  const selectChain = useCallback((asset: string, chainKey: string, allRoutes: CrossChainRoutePair[]) => {
    setSelectedChain(chainKey);
    const lookup = buildGroupLookup(allRoutes);
    const matching = allRoutes.filter(r => assetMatchesGroup(r.asset, asset) && chainGroupKeyWith(r, lookup) === chainKey);
    if (matching.length === 1) {
      // Single provider — show loading, prepare, and go to confirm
      setStep('loading');
      setError(null);
      prepareRoute(matching[0])
        .then(response => {
          setPrepareResponse(response);
          setStep('confirm');
        })
        .catch(err => {
          logger.error(LogCategory.PAYMENT, 'Failed to prepare cross-chain payment', { error: formatError(err) });
          setError(crossChainFriendlyError(err, 'Failed to get quote.'));
          // Show provider step so user can see the error and go back
          const quotes = new Map<string, ProviderQuote>();
          quotes.set(matching[0].provider, { route: matching[0], response: null, error: crossChainFriendlyError(err, 'Failed to get quote.'), loading: false });
          setProviderQuotes(quotes);
          setStep('provider');
        });
    } else {
      prepareAllProviders(matching);
      setStep('provider');
    }
  }, [prepareRoute, prepareAllProviders]);

  // Fetch routes on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fetched: CrossChainRoutePair[] = await wallet.getCrossChainRoutes({
          type: 'send',
          addressDetails,
        });
        if (cancelled) return;

        if (!fetched || fetched.length === 0) {
          setError('No cross-chain routes available for this address');
          setStep('asset');
          return;
        }

        setRoutes(fetched);

        // Enter wizard — auto-skip steps with single option
        const assets = [...new Set(fetched
          .map(r => assetDisplayName(r.asset))
        )].sort();
        if (assets.length === 0) {
          setError('No supported stablecoin routes available for this address');
          setStep('asset');
        } else if (assets.length === 1) {
          selectAsset(assets[0], fetched);
        } else {
          setStep('asset');
        }
      } catch (err) {
        if (cancelled) return;
        logger.error(LogCategory.PAYMENT, 'Failed to fetch cross-chain routes', { error: formatError(err) });
        setError(`Failed to fetch routes: ${err instanceof Error ? err.message : 'Unknown error'}`);
        setStep('asset');
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Back navigation — respect skipped steps
  const goBackFromChain = () => {
    setSelectedAsset(null);
    setSelectedChain(null);
    setPendingChain(null);
    if (uniqueAssets.length > 1) {
      setStep('asset');
    } else {
      onBack();
    }
  };

  const goBackFromProvider = () => {
    setSelectedChain(null);
    setPrepareResponse(null);
    setProviderQuotes(new Map());
    setPendingProvider(null);
    setError(null);
    if (chainsForAsset.length > 1) {
      setStep('chain');
    } else {
      goBackFromChain();
    }
  };

  const goBackFromConfirm = () => {
    setPrepareResponse(null);
    setPendingProvider(null);
    setError(null);
    if (routesForSelection.length > 1) {
      prepareAllProviders(routesForSelection);
      setStep('provider');
    } else {
      goBackFromProvider();
    }
  };

  const handleSend = () => {
    if (!prepareResponse) return;
    const response = prepareResponse;
    onRun(async () => {
      await wallet.sendPayment({ prepareResponse: response });
    });
  };

  // Extract quote details from prepare response
  const method = prepareResponse?.paymentMethod;
  const quote = method?.type === 'crossChainAddress' ? method : null;
  const confirmedRoute = quote?.route ?? null;

  // Provider-step derived state. Failed providers are hidden from the list; if
  // *every* provider fails we surface a single reason + retry instead of a list
  // of dead cards.
  const providerList = [...providerQuotes.values()];
  const isProviderReady = (pq: ProviderQuote) =>
    !pq.loading && !!pq.response && pq.response.paymentMethod.type === 'crossChainAddress';
  const visibleProviders = providerList.filter(pq => pq.loading || isProviderReady(pq));
  const anyProviderLoading = providerList.some(pq => pq.loading);
  const allProvidersFailed =
    providerList.length > 0 && !anyProviderLoading && !providerList.some(isProviderReady);
  const providerFailureReason = (() => {
    const errs = providerList.map(pq => pq.error ?? '').filter(Boolean);
    if (errs.some(e => e.toLowerCase().includes('too small')))
      return 'This amount is too small for the available routes. Try sending a larger amount.';
    if (errs.some(e => e.toLowerCase().includes('too large')))
      return 'This amount is too large for the available routes. Try sending a smaller amount.';
    return 'Couldn’t get a quote from any provider right now. Try again, or go back and use a different amount.';
  })();

  return (
    <>
      {/* Loading */}
      {step === 'loading' && (
        <div className="flex flex-col items-center justify-center py-12 space-y-3">
          <SpinnerIcon size="lg" className="text-spark-primary animate-spin" />
          <p className="text-sm text-spark-text-secondary">Fetching routes...</p>
        </div>
      )}

      {/* Step 2: Asset selection */}
      {step === 'asset' && (
        <CrossChainAssetStep
          assets={uniqueAssets}
          pending={pendingAsset}
          onPendingChange={setPendingAsset}
          onBack={onBack}
          onContinue={() => { if (pendingAsset) selectAsset(pendingAsset, routes); }}
          error={error}
        />
      )}

      {/* Step 3: Chain selection */}
      {step === 'chain' && (
        <CrossChainChainStep
          chains={chainsForAsset}
          chainGroupKey={chainGroupKey}
          selectedAsset={selectedAsset}
          pending={pendingChain}
          onPendingChange={setPendingChain}
          onBack={goBackFromChain}
          onContinue={() => { if (pendingChain) selectChain(selectedAsset!, pendingChain, routes); }}
          error={error}
        />
      )}

      {/* Step 4: Provider selection */}
      {step === 'provider' && (
        <div className="flex flex-col" style={{ maxHeight: '60vh' }}>
          {allProvidersFailed ? (
            <div className="mb-4 p-4 bg-spark-warn-surface border border-spark-warn-border rounded-xl">
              <p className="text-sm font-medium text-spark-warn-title mb-1">Couldn’t get a quote</p>
              <p className="text-sm text-spark-warn-text">{providerFailureReason}</p>
            </div>
          ) : (
            <div className="mb-4 min-h-0 flex flex-col">
              <label className="block text-sm font-medium text-spark-text-primary mb-2 shrink-0">
                Select Provider for {selectedAsset} ({formatChainName(routesForSelection[0]?.chain ?? '')})
              </label>
              <div className="space-y-2 overflow-y-auto min-h-0 pr-1">
                {visibleProviders.map((pq) => {
                  const key = pq.route.provider;
                  const pMethod = pq.response?.paymentMethod;
                  const pQuote = pMethod?.type === 'crossChainAddress' ? pMethod : null;
                  const ready = isProviderReady(pq);
                  return (
                    <button
                      key={key}
                      disabled={!ready}
                      onClick={() => { if (ready) setPendingProvider(key); }}
                      className={`${crossChainCardClass(pendingProvider === key)} ${!ready ? 'opacity-70' : ''}`}
                    >
                      <span className="font-display font-medium text-spark-text-primary">
                        {getProviderDisplayName(pq.route.provider)}
                      </span>
                      {pq.loading && (
                        <div className="flex items-center gap-2 mt-2">
                          <SpinnerIcon size="xs" className="animate-spin text-spark-text-secondary" />
                          <span className="text-xs text-spark-text-secondary">Getting quote...</span>
                        </div>
                      )}
                      {ready && pQuote && (
                        <div className="mt-2 space-y-1.5">
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-spark-text-secondary">Receiving</span>
                            <span className="font-mono text-sm text-spark-text-primary">
                              ~{formatReceiveAmount(BigInt(pQuote.estimatedOut), pq.route.decimals)} {pq.route.asset}
                            </span>
                          </div>
                          <div className="border-t border-spark-border/50" />
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-spark-text-secondary">Fee</span>
                            <span className="font-mono text-sm text-spark-text-primary">
                              {formatCrossChainAmount(BigInt(pQuote.feeAmount), pq.route.decimals)} {pq.route.asset}
                            </span>
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex gap-3 shrink-0 pt-2">
            {allProvidersFailed ? (
              <>
                <SecondaryButton onClick={onBack} className="flex-1">
                  Change Amount
                </SecondaryButton>
                <PrimaryButton onClick={() => prepareAllProviders(routesForSelection)} className="flex-1">
                  Try Again
                </PrimaryButton>
              </>
            ) : (
              <>
                <SecondaryButton onClick={goBackFromProvider} className="flex-1">
                  Back
                </SecondaryButton>
                <PrimaryButton
                  onClick={() => {
                    const pq = pendingProvider ? providerQuotes.get(pendingProvider) : null;
                    if (pq?.response) {
                      setPrepareResponse(pq.response);
                      setStep('confirm');
                    }
                  }}
                  className="flex-1"
                  disabled={!pendingProvider}
                >
                  Continue
                </PrimaryButton>
              </>
            )}
          </div>
        </div>
      )}

      {/* Step 5: Confirm */}
      {step === 'confirm' && quote && confirmedRoute && (
        <>
          {/* Amount header */}
          <div className="text-center py-4">
            <p className="text-spark-text-muted text-sm mb-2">You're sending</p>
            <div className="flex items-baseline justify-center gap-2">
              <span className="text-4xl font-mono font-bold text-spark-text-primary">
                {effectiveTokenId && stableBalance.displayConfig ? (
                  <span className="inline-flex items-center">
                    <span className="text-[0.8em] opacity-70 mr-px">{stableBalance.displayConfig.symbol}</span>
                    {formatTokenAmount(BigInt(quote.amountIn), { ...stableBalance.displayConfig, symbol: '', symbolPosition: 'after' })}
                  </span>
                ) : (
                  <SatAmount sats={Number(quote.amountIn)} />
                )}
              </span>
            </div>
          </div>

          <FeeBreakdownCard
            useRawStrings
            items={[
              {
                label: 'Receiving',
                value: `~${formatReceiveAmount(BigInt(quote.estimatedOut), confirmedRoute.decimals)} ${confirmedRoute.asset}`,
              },
              {
                label: 'Chain',
                value: `${formatChainName(confirmedRoute.chain)}`,
              },
              {
                label: 'Provider',
                value: getProviderDisplayName(confirmedRoute.provider),
              },
              {
                label: 'Address',
                value: truncateAddress(quote.recipientAddress, 20),
              },
              {
                label: 'Fee',
                value: `${formatCrossChainAmount(BigInt(quote.feeAmount), confirmedRoute.decimals)} ${confirmedRoute.asset}`,
              },
            ]}
            className="mb-6"
          />

          {error && (
            <div className="mb-4 p-3 bg-spark-warn-surface border border-spark-warn-border rounded-xl text-sm text-spark-warn-text">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <SecondaryButton onClick={goBackFromConfirm} className="flex-1">
              Back
            </SecondaryButton>
            <PrimaryButton onClick={handleSend} className="flex-1" disabled={false}>
              Send
            </PrimaryButton>
          </div>
        </>
      )}

    </>
  );
};

export default CrossChainWorkflow;
