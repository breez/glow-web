import React, { useCallback, useState } from 'react';
import type {
  CrossChainReceiveInfo,
  CrossChainRoutePair,
  ReceivePaymentResponse,
} from '@breeztech/breez-sdk-spark';
import {
  PrimaryButton,
  SecondaryButton,
  QRCodeContainer,
  CopyableText,
  FormError,
} from '../../../components/ui';
import { SpinnerIcon, CopyFilledIcon, CheckIcon } from '../../../components/Icons';
import { CrossChainAssetStep } from '../../../components/crossChain/CrossChainAssetStep';
import { CrossChainChainStep } from '../../../components/crossChain/CrossChainChainStep';
import { useWallet } from '../../../contexts/WalletContext';
import { useStableBalance } from '../../../contexts/StableBalanceContext';
import { useToast } from '../../../contexts/ToastContext';
import { useCrossChainRouteGroups } from '../../../hooks/useCrossChainRouteGroups';
import {
  assetDisplayName,
  assetMatchesGroup,
  buildGroupLookup,
  chainGroupKey as chainGroupKeyWith,
  crossChainCardClass,
  crossChainFriendlyError,
} from '../../../utils/crossChainRoutes';
import { formatChainName, formatReceiveAmount, formatCrossChainAmount, parseCrossChainAmount } from '../../../utils/crossChainFormat';
import { copyToClipboard } from '../../../utils/clipboard';
import { formatTokenAmount } from '../../../utils/tokenFormatting';
import { formatWithSpaces } from '../../../utils/formatNumber';
import { getProviderDisplayName } from '../../../utils/paymentDescription';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';

type WorkflowStep = 'amount' | 'loading' | 'asset' | 'chain' | 'provider' | 'generating' | 'result';

const QUICK_USD_AMOUNTS = [1, 5, 10];

const CrossChainReceiveWorkflow: React.FC = () => {
  const wallet = useWallet();
  const stableBalance = useStableBalance();
  const { showToast } = useToast();

  const [step, setStep] = useState<WorkflowStep>('amount');
  const [usdInput, setUsdInput] = useState('');
  const [routes, setRoutes] = useState<CrossChainRoutePair[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<CrossChainRoutePair | null>(null);
  const [receiveResult, setReceiveResult] = useState<ReceivePaymentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pending selections (user highlights, then clicks Continue)
  const [pendingAsset, setPendingAsset] = useState<string | null>(null);
  const [pendingChain, setPendingChain] = useState<string | null>(null);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [amountCopied, setAmountCopied] = useState(false);

  const { uniqueAssets, chainGroupKey, getChainsForAsset } = useCrossChainRouteGroups(routes);
  const chainsForAsset = selectedAsset ? getChainsForAsset(selectedAsset) : [];
  const routesForSelection = selectedAsset && selectedChain
    ? routes.filter(r => assetMatchesGroup(r.asset, selectedAsset) && chainGroupKey(r) === selectedChain)
    : [];

  // The sender deposits in the source asset's base units. Source assets here
  // are USD stablecoins, so the typed dollar value maps directly.
  const usdValue = parseFloat(usdInput);
  const canContinue = Number.isFinite(usdValue) && usdValue > 0;

  const handleAmountChange = (value: string) => {
    if (value === '' || /^\d*\.?\d{0,2}$/.test(value)) setUsdInput(value);
  };

  // Single-step receive: create the order and surface the deposit address.
  // `usdInput` is the deposit the sender sends (exact-in), not the amount the
  // merchant receives. The SDK's crossChain receive has no exact-out / fees-
  // included mode yet (route.exactOutEligible is a flag with no parameter to
  // drive it), so the received amount comes back lower. Flip to merchant-enters-
  // received-amount once the SDK supports it.
  const generateOrder = useCallback(async (route: CrossChainRoutePair) => {
    setSelectedRoute(route);
    setStep('generating');
    setError(null);
    // `amount` is denominated in the route's source asset (`route.decimals`),
    // matching prepare_payment_link. Source assets are USD stablecoins, so the
    // typed dollar value carries over at parity across differing precisions.
    const amount = parseCrossChainAmount(usdInput, route.decimals).toString();
    try {
      const res = await wallet.receivePayment({
        paymentMethod: { type: 'crossChain', route, amount },
      });
      setReceiveResult(res);
      setStep('result');
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Failed to create cross-chain receive order', { error: formatError(err) });
      setError(crossChainFriendlyError(err, 'Failed to create request.'));
      setStep('amount');
    }
  }, [wallet, usdInput]);

  // Advance from chain selection. Only >1 provider opens a provider step;
  // otherwise create the order directly (today routes are Orchestra-only).
  const selectChain = useCallback((asset: string, chainKey: string, allRoutes: CrossChainRoutePair[]) => {
    setSelectedChain(chainKey);
    const lookup = buildGroupLookup(allRoutes);
    const matching = allRoutes.filter(r => assetMatchesGroup(r.asset, asset) && chainGroupKeyWith(r, lookup) === chainKey);
    if (matching.length === 1) {
      generateOrder(matching[0]);
    } else {
      setStep('provider');
    }
  }, [generateOrder]);

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
  }, [selectChain]);

  const fetchRoutes = useCallback(async () => {
    setStep('loading');
    setError(null);
    try {
      const fetched = await wallet.getCrossChainRoutes({ type: 'receive' });
      if (!fetched || fetched.length === 0) {
        setError('No cross-chain routes available right now');
        setStep('amount');
        return;
      }
      setRoutes(fetched);
      const assets = [...new Set(fetched.map(r => assetDisplayName(r.asset)))].sort();
      if (assets.length === 1) {
        selectAsset(assets[0], fetched);
      } else {
        setStep('asset');
      }
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Failed to fetch cross-chain receive routes', { error: formatError(err) });
      setError(`Failed to fetch routes: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setStep('amount');
    }
  }, [wallet, selectAsset]);

  // Back navigation — respect skipped steps
  const goBackToAmount = () => {
    setSelectedAsset(null);
    setSelectedChain(null);
    setSelectedRoute(null);
    setPendingAsset(null);
    setPendingChain(null);
    setPendingProvider(null);
    setError(null);
    setStep('amount');
  };

  const goBackFromChain = () => {
    setSelectedChain(null);
    setPendingChain(null);
    setError(null);
    if (uniqueAssets.length > 1) {
      setSelectedAsset(null);
      setPendingAsset(null);
      setStep('asset');
    } else {
      goBackToAmount();
    }
  };

  const goBackFromProvider = () => {
    setPendingProvider(null);
    setError(null);
    if (chainsForAsset.length > 1) {
      setSelectedChain(null);
      setPendingChain(null);
      setStep('chain');
    } else {
      goBackFromChain();
    }
  };

  // Received amount lands as a stable token (USDB) or as BTC sats, depending on
  // the SDK's auto-pick. `route.decimals` is the *source* asset, so it can't be
  // reused here — branch on `tokenIdentifier` and format the destination asset.
  const formatReceived = (info: CrossChainReceiveInfo): string => {
    const amount = BigInt(info.expectedReceivedAmount);
    if (info.tokenIdentifier) {
      if (stableBalance.tokenIdentifier === info.tokenIdentifier && stableBalance.displayConfig) {
        return formatTokenAmount(amount, stableBalance.displayConfig);
      }
      return `$${formatReceiveAmount(amount, 6)}`;
    }
    return `₿${formatWithSpaces(Number(amount))}`;
  };

  const resultInfo = receiveResult?.crossChainInfo;
  const resultAssetName = selectedRoute ? assetDisplayName(selectedRoute.asset) : '';
  const resultChainName = selectedRoute ? formatChainName(selectedRoute.chain) : '';
  // The amount the sender transfers. `resultDepositUsd` is the rounded $X.XX
  // display; `resultDepositAmount` (bare, full precision) is what the copy button
  // and the QR/EIP-681 carry for the sender to pay — e.g. shows "$1.06" but the
  // real deposit (and copy) is "1.0558" when the SDK doesn't floor to the cent.
  const resultDepositAmount = selectedRoute && resultInfo
    ? formatCrossChainAmount(BigInt(resultInfo.depositAmount), selectedRoute.decimals)
    : usdInput;
  const resultDepositUsd = selectedRoute && resultInfo
    ? `$${formatReceiveAmount(BigInt(resultInfo.depositAmount), selectedRoute.decimals)}`
    : `$${usdInput}`;
  // Plain deposit address for copy/paste (MetaMask etc.). The QR keeps the
  // EIP-681 URI so scanners auto-fill the amount; falls back to the URI if the
  // SDK omitted the structured info.
  const resultDepositAddress = resultInfo?.depositAddress ?? receiveResult?.paymentRequest ?? '';
  const resultShareMessage = `Send ${resultDepositAmount} ${resultAssetName} on ${resultChainName} to ${resultDepositAddress}`;
  const copyDepositAmount = () => {
    void copyToClipboard(resultDepositAmount);
    setAmountCopied(true);
    setTimeout(() => setAmountCopied(false), 2000);
    showToast('success', 'Amount copied');
  };

  // Fixed height sized to the result step so the bottom sheet opens at that
  // height and stays constant across steps. A definite height (not min-h) is
  // required so the asset/chain/provider lists scroll internally and keep their
  // Back/Continue row pinned instead of growing the sheet past its visible area.
  return (
    <div className="h-[500px] flex flex-col">
      {/* Step 1: Amount */}
      {step === 'amount' && (
        <div className="pt-6 flex flex-col flex-1">
          <div>
            <label className="block text-sm font-medium text-spark-text-primary mb-2">Amount</label>
            <input
              type="text"
              inputMode="decimal"
              enterKeyHint="done"
              value={usdInput}
              onChange={(e) => handleAmountChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (canContinue) fetchRoutes();
                }
              }}
              placeholder="Enter amount in USD"
              className="w-full p-4 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary placeholder-spark-text-muted focus:border-spark-primary focus:ring-2 focus:ring-spark-primary/20 transition-all"
              data-testid="cross-chain-receive-amount-input"
              autoFocus
            />

            {/* Quick amount buttons */}
            <div className="flex gap-2 mt-3">
              {QUICK_USD_AMOUNTS.map((quickAmount) => {
                const isSelected = parseFloat(usdInput) === quickAmount;
                return (
                  <button
                    key={quickAmount}
                    onClick={() => setUsdInput(String(quickAmount))}
                    className={`flex-1 py-2 rounded-lg text-sm font-mono font-medium transition-all ${
                      isSelected
                        ? 'bg-spark-primary text-white'
                        : 'bg-transparent border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
                    }`}
                  >
                    ${quickAmount}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-auto space-y-4 pt-6">
            <FormError error={error} />
            <PrimaryButton onClick={() => fetchRoutes()} className="w-full" disabled={!canContinue} data-testid="cross-chain-receive-continue">
              Continue
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Loading routes / creating order */}
      {(step === 'loading' || step === 'generating') && (
        <div className="flex-1 flex flex-col items-center justify-center space-y-3">
          <SpinnerIcon size="lg" className="text-spark-primary animate-spin" />
          <p className="text-sm text-spark-text-secondary">
            {step === 'loading' ? 'Fetching routes...' : 'Creating request...'}
          </p>
        </div>
      )}

      {/* Step 2: Asset selection */}
      {step === 'asset' && (
        <CrossChainAssetStep
          fill
          assets={uniqueAssets}
          pending={pendingAsset}
          onPendingChange={setPendingAsset}
          onBack={goBackToAmount}
          onContinue={() => { if (pendingAsset) selectAsset(pendingAsset, routes); }}
          error={error}
        />
      )}

      {/* Step 3: Chain selection */}
      {step === 'chain' && (
        <CrossChainChainStep
          fill
          chains={chainsForAsset}
          chainGroupKey={chainGroupKey}
          selectedAsset={selectedAsset}
          pending={pendingChain}
          onPendingChange={setPendingChain}
          onBack={goBackFromChain}
          onContinue={() => { if (pendingChain && selectedAsset) selectChain(selectedAsset, pendingChain, routes); }}
          error={error}
        />
      )}

      {/* Step 4: Provider selection (only when >1 provider) */}
      {step === 'provider' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="mb-4 min-h-0 flex flex-col">
            <label className="block text-sm font-medium text-spark-text-primary mb-2 shrink-0">
              Select Provider for {selectedAsset} ({formatChainName(routesForSelection[0]?.chain ?? '')})
            </label>
            <div className="space-y-2 overflow-y-auto min-h-0 pr-1">
              {routesForSelection.map(r => (
                <button
                  key={r.provider}
                  onClick={() => setPendingProvider(r.provider)}
                  className={crossChainCardClass(pendingProvider === r.provider)}
                >
                  <span className="font-display font-medium text-spark-text-primary">
                    {getProviderDisplayName(r.provider)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 shrink-0 pt-2">
            <SecondaryButton onClick={goBackFromProvider} className="flex-1">
              Back
            </SecondaryButton>
            <PrimaryButton
              onClick={() => {
                const r = routesForSelection.find(x => x.provider === pendingProvider);
                if (r) generateOrder(r);
              }}
              className="flex-1"
              disabled={!pendingProvider}
            >
              Continue
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Step 5: Result */}
      {step === 'result' && receiveResult && selectedRoute && (
        <div className="pt-4 pb-2 flex flex-col items-center gap-4">
          {/* Amount the sender transfers — the copyable hero (copies the bare
              number). The $ already signals dollars; the coin sits in the subtitle. */}
          <div className="text-center">
            <button
              onClick={copyDepositAmount}
              className="inline-flex items-center gap-2 group"
              title="Copy amount"
              data-testid="cross-chain-deposit-amount"
            >
              <span className="text-3xl font-mono font-bold text-spark-text-primary">
                {resultDepositUsd}
              </span>
              {amountCopied
                ? <CheckIcon size="sm" className="text-spark-success" />
                : <CopyFilledIcon size="sm" className="text-spark-text-muted group-hover:text-spark-text-secondary transition-colors" />}
            </button>
            <p className="text-sm text-spark-text-secondary mt-1">
              {resultAssetName} on {resultChainName} · via {getProviderDisplayName(selectedRoute.provider)}
            </p>
          </div>

          <QRCodeContainer value={receiveResult.paymentRequest} />

          <CopyableText
            text={resultDepositAddress}
            textToShare={resultShareMessage}
            truncate
            showShare
            label="Deposit Address"
            shareLabel="Deposit"
            onCopied={() => showToast('success', 'Address copied')}
            onShareError={() => showToast('error', 'Failed to share')}
            data-testid="cross-chain-deposit-address"
          />

          {/* What lands in the wallet */}
          {resultInfo && (
            <p className="text-sm text-spark-text-muted">
              You'll receive{' '}
              <span className="text-spark-text-primary font-mono font-medium">~{formatReceived(resultInfo)}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default CrossChainReceiveWorkflow;
