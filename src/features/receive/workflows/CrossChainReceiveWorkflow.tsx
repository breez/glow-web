import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CrossChainReceiveInfo,
  CrossChainRoutePair,
  ReceivePaymentResponse,
} from '@breeztech/breez-sdk-spark';
import {
  AMOUNT_FIELD_CLASS,
  PrimaryButton,
  QRCodeContainer,
  FormError,
} from '../../../components/ui';
import { SpinnerIcon, CopyIcon, CheckIcon, QrCodeIcon } from '../../../components/Icons';
import { FeeBreakdownCard } from '../../../components/FeeBreakdownCard';
import CurrencySwitcher from '../../../components/ui/CurrencySwitcher';
import { CrossChainRouteChip } from '../../../components/crossChain/CrossChainRouteChip';
import { CrossChainAssetStep } from '../../../components/crossChain/CrossChainAssetStep';
import { CrossChainChainStep } from '../../../components/crossChain/CrossChainChainStep';
import { useWallet } from '../../../contexts/WalletContext';
import { useStableBalance } from '../../../contexts/StableBalanceContext';
import { useToast } from '../../../contexts/ToastContext';
import { useCrossChainRouteGroups } from '../../../hooks/useCrossChainRouteGroups';
import { useSheetBack, useSheetFullSnap, useSheetOwnsScroll } from '../../../components/ui/sheets/BottomSheetCardContext';
import {
  assetDisplayName,
  assetMatchesGroup,
  buildGroupLookup,
  chainGroupKey as chainGroupKeyWith,
  crossChainCardClass,
  crossChainFriendlyError,
  formatUsdLimits,
  landsInThisWallet,
  sparkSideLimits,
} from '../../../utils/crossChainRoutes';
import { formatChainName, formatReceiveAmount, formatCrossChainAmount, formatUsdCents, parseCrossChainAmount, truncateAddress } from '../../../utils/crossChainFormat';
import { copyToClipboard } from '../../../utils/clipboard';
import { normalizeDecimalInput } from '../../../utils/decimalInput';
import { formatTokenAmount } from '../../../utils/tokenFormatting';
import { formatWithSpaces } from '../../../utils/formatNumber';
import { getProviderDisplayName } from '../../../utils/paymentDescription';
import { getLastUsdReceiveRoute, setLastUsdReceiveRoute } from '@/services/settings';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';

type WorkflowStep = 'amount' | 'loading' | 'asset' | 'chain' | 'provider' | 'generating' | 'result';

const QUICK_USD_AMOUNTS = [10, 50, 200];

/** Decimals the fee is quoted in, which is not the route's. Orchestra prices
 *  a fee in an asset of its own choosing: USDC on Solana for most routes, USDC
 *  on Arc or USDT on Arbitrum for others, and the choice also moves with the
 *  destination. Every one observed across the route table uses 6, and the SDK
 *  passes only the ticker, so 6 is what this assumes (breez/spark-sdk#1160). */
const CROSS_CHAIN_FEE_DECIMALS = 6;

interface CrossChainReceiveWorkflowProps {
  /** Whether the USD tab is the one on screen. The workflow stays mounted
   *  either way, so a stray tap on BTC cannot throw away a quote, but it
   *  renders nothing and lends the sheet neither a back arrow nor its scroll
   *  while it is off screen. */
  active: boolean;
  /** Reports the resting state, the amount form, which is the only step this
   *  flow is safe to walk away from. Off it the dialog takes the tabs away. */
  onRestingChange?: (resting: boolean) => void;
}

const CrossChainReceiveWorkflow: React.FC<CrossChainReceiveWorkflowProps> = ({ active, onRestingChange }) => {
  const wallet = useWallet();
  const stableBalance = useStableBalance();
  const { showToast } = useToast();
  const isSheetFull = useSheetFullSnap();

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
  const [addressCopied, setAddressCopied] = useState(false);
  // Open by default: on EVM the code carries the amount and the pasted address
  // does not, so it is the only artifact holding the whole request. Still
  // collapsible, for a sender who only wants the address.
  const [showDepositQr, setShowDepositQr] = useState(true);
  // Where the picker hands back to. Reached from Continue it carries straight
  // on into the order, as it did when it was a step of the flow; reached from
  // the chip it is a detour, so it returns to the amount.
  const [pickerReturn, setPickerReturn] = useState<'order' | 'amount'>('order');

  // The provider and result steps cap and scroll themselves, same as the
  // asset / chain steps do from inside their own components.
  useSheetOwnsScroll(active && (step === 'provider' || step === 'result'));

  useEffect(() => { onRestingChange?.(step === 'amount'); }, [step, onRestingChange]);

  const { uniqueAssets, chainGroupKey, getChainsForAsset } = useCrossChainRouteGroups(routes);
  const chainsForAsset = selectedAsset ? getChainsForAsset(selectedAsset) : [];
  const routesForSelection = selectedAsset && selectedChain
    ? routes.filter(r => assetMatchesGroup(r.asset, selectedAsset) && chainGroupKey(r) === selectedChain)
    : [];
  const chipRoute = routesForSelection[0] ?? null;
  const stableTokenIdentifier = stableBalance.isActive ? stableBalance.tokenIdentifier : null;
  // What the provider will take on the chosen network. Shown beside the label
  // rather than in the placeholder so it survives the first keystroke.
  const chipLimits = chipRoute ? sparkSideLimits(chipRoute, stableTokenIdentifier) : null;
  const limitRange = formatUsdLimits(chipLimits);

  // The sender deposits in the source asset's base units. Source assets here
  // are USD stablecoins, so the typed dollar value maps directly.
  const usdValue = parseFloat(usdInput);
  const canContinue = Number.isFinite(usdValue) && usdValue > 0;

  // Comma-locale keypads offer only "," as the separator, so normalize before
  // the two-decimal guard or the key the keypad shows is the one we drop.
  const handleAmountChange = (value: string) => {
    const normalized = normalizeDecimalInput(value);
    if (/^\d*\.?\d{0,2}$/.test(normalized)) setUsdInput(normalized);
  };

  // Single-step receive: create the order and surface the deposit address.
  // `usdInput` is what the receiver ends up with, not what the sender sends:
  // the SDK defaults to FeesExcluded and inflates the deposit to absorb the
  // provider fee, so `crossChainInfo.depositAmount` comes back higher.
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
    setLastUsdReceiveRoute({ asset, chain: chainKey });
    if (pickerReturn === 'amount') {
      setStep('amount');
      return;
    }
    const lookup = buildGroupLookup(allRoutes);
    const matching = allRoutes.filter(r => assetMatchesGroup(r.asset, asset) && chainGroupKeyWith(r, lookup) === chainKey);
    if (matching.length === 1) {
      generateOrder(matching[0]);
    } else {
      setStep('provider');
    }
  }, [generateOrder, pickerReturn]);

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

  const loadRoutes = useCallback(async (): Promise<CrossChainRoutePair[]> => {
    const listed = await wallet.getCrossChainRoutes({ type: 'receive' });
    // In sats mode a route that only lands a token fails on every receive,
    // and its funds would be ones Glow can't show or spend anyway.
    return listed?.filter(route => landsInThisWallet(route, stableTokenIdentifier)) ?? [];
  }, [wallet, stableTokenIdentifier]);

  // The chip needs the routes before the amount is typed: it names the network
  // the request will use, and a remembered one only counts while the provider
  // still serves it. Held until the tab is opened, since the workflow is mounted
  // for the whole life of the sheet now. A failure here stays quiet, since
  // Continue re-fetches and is where the user finds out.
  const routesRequested = useRef(false);
  useEffect(() => {
    if (!active || routesRequested.current) return;
    routesRequested.current = true;
    let cancelled = false;
    loadRoutes()
      .then(fetched => {
        if (cancelled || fetched.length === 0) return;
        setRoutes(fetched);
        const remembered = getLastUsdReceiveRoute();
        if (!remembered) return;
        const lookup = buildGroupLookup(fetched);
        const still = fetched.some(r =>
          assetMatchesGroup(r.asset, remembered.asset) && chainGroupKeyWith(r, lookup) === remembered.chain);
        if (!still) return;
        setSelectedAsset(remembered.asset);
        setSelectedChain(remembered.chain);
      })
      .catch(err => logger.warn(LogCategory.PAYMENT, 'Failed to prefetch cross-chain receive routes', { error: formatError(err) }));
    return () => { cancelled = true; };
  }, [active, loadRoutes]);

  const fetchRoutes = useCallback(async () => {
    setStep('loading');
    setError(null);
    try {
      const fetched = await loadRoutes();
      if (fetched.length === 0) {
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
  }, [loadRoutes, selectAsset]);

  // Leaving the picker keeps whatever the chip already named: it is a detour
  // off the amount step now, not a step the flow passes through.
  const cancelPicker = () => {
    setPendingAsset(null);
    setPendingChain(null);
    setPendingProvider(null);
    setError(null);
    setStep('amount');
  };

  const goBackFromChain = () => {
    setPendingChain(null);
    setError(null);
    if (uniqueAssets.length > 1) {
      setPendingAsset(null);
      setStep('asset');
    } else {
      cancelPicker();
    }
  };

  const goBackFromProvider = () => {
    setPendingProvider(null);
    setError(null);
    if (chainsForAsset.length > 1) {
      setPendingChain(null);
      setStep('chain');
    } else {
      goBackFromChain();
    }
  };

  // Back from the deposit address to the amount that made it. The network is
  // changed from the chip there rather than by walking the picker backwards.
  // The order already made just expires unpaid.
  const goBackFromResult = () => {
    setReceiveResult(null);
    setSelectedRoute(null);
    setAmountCopied(false);
    setAddressCopied(false);
    setShowDepositQr(true);
    setStep('amount');
  };

  // Opens on the coin when there is a choice of them, otherwise straight on
  // the network. With a single coin nothing has selected it on a first run,
  // so the chain step is handed it here.
  const openPicker = (returnTo: 'order' | 'amount') => {
    setPickerReturn(returnTo);
    setPendingAsset(selectedAsset);
    setPendingChain(selectedChain);
    setError(null);
    if (uniqueAssets.length > 1) {
      setStep('asset');
      return;
    }
    if (uniqueAssets.length === 1) setSelectedAsset(uniqueAssets[0]);
    setStep('chain');
  };

  // Creates the request when the chip already names a route, and falls back to
  // the picker when nothing is remembered yet.
  const handleContinue = () => {
    const cents = Math.round(usdValue * 100);
    if (chipLimits?.minUsdCents !== undefined && cents < chipLimits.minUsdCents) {
      setError(`This network takes at least ${formatUsdCents(chipLimits.minUsdCents)}.`);
      return;
    }
    if (chipLimits?.maxUsdCents !== undefined && cents > chipLimits.maxUsdCents) {
      setError(`This network takes at most ${formatUsdCents(chipLimits.maxUsdCents)}.`);
      return;
    }
    setError(null);
    if (routesForSelection.length === 1) {
      generateOrder(routesForSelection[0]);
      return;
    }
    setPickerReturn('order');
    if (routesForSelection.length > 1) {
      setStep('provider');
      return;
    }
    if (routes.length > 0) {
      openPicker('order');
      return;
    }
    void fetchRoutes();
  };

  // The asset and chain steps lend their own.
  useSheetBack(active ? (step === 'provider' ? goBackFromProvider : step === 'result' ? goBackFromResult : undefined) : undefined);

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
  // Stays mounted and opens on grid rows, which resolve to the code's own
  // height: a max-height transition would need a guessed ceiling, and easing
  // against one is what makes a disclosure look like it snaps. The padding
  // lives on the inner wrapper so the closed state has no height at all.
  const depositQr = receiveResult ? (
    <div
      className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
        showDepositQr ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}
      aria-hidden={!showDepositQr}
    >
      <div className="overflow-hidden">
        <div className="flex justify-center pt-5 pb-3">
          <QRCodeContainer value={receiveResult.paymentRequest} size={148} corners={false} />
        </div>
      </div>
    </div>
  ) : null;
  // Parsed at the fee asset's scale, which is not the route's: a BSC route at
  // 18 decimals reads the figure as a millionth of a cent that way. Shown at
  // cents, since the fee is a few of them and its exact precision is nobody's
  // business; under a cent it reads as a bound rather than as nothing. An
  // absent ticker means sats.
  const resultFee = resultInfo
    ? resultInfo.serviceFeeAsset
      ? (() => {
          const fee = BigInt(resultInfo.serviceFeeAmount);
          const ticker = assetDisplayName(resultInfo.serviceFeeAsset);
          const cents = formatReceiveAmount(fee, CROSS_CHAIN_FEE_DECIMALS);
          return fee > 0n && Number(cents) === 0 ? `< 0.01 ${ticker}` : `${cents} ${ticker}`;
        })()
      : `₿${formatWithSpaces(Number(resultInfo.serviceFeeAmount))}`
    : null;
  // Plain deposit address for copy/paste (MetaMask etc.). The QR keeps the
  // EIP-681 URI so scanners auto-fill the amount; falls back to the URI if the
  // SDK omitted the structured info.
  const resultDepositAddress = resultInfo?.depositAddress ?? receiveResult?.paymentRequest ?? '';
  const copyDepositAddress = () => {
    void copyToClipboard(resultDepositAddress);
    setAddressCopied(true);
    setTimeout(() => setAddressCopied(false), 2000);
    showToast('success', 'Address copied');
  };
  const copyDepositAmount = () => {
    void copyToClipboard(resultDepositAmount);
    setAmountCopied(true);
    setTimeout(() => setAmountCopied(false), 2000);
    showToast('success', 'Amount copied');
  };

  // The address carries its own controls, so it is a row in the breakdown
  // rather than a block of its own: the code is what the sender scans, the
  // copy is the bare address a withdrawal form wants. EVM puts the amount in
  // the URI; Solana and Tron give back a bare address, so there they match.
  const depositAddressValue = (
    <span className="flex items-center gap-1">
      <span className="truncate" title={resultDepositAddress} data-testid="cross-chain-deposit-address">
        {truncateAddress(resultDepositAddress, 16)}
      </span>
      <button
        onClick={() => setShowDepositQr(open => !open)}
        aria-expanded={showDepositQr}
        aria-label={showDepositQr ? 'Hide deposit address QR code' : 'Show deposit address QR code'}
        className="shrink-0 p-1.5 -my-1.5 rounded-md hover:bg-white/5 transition-colors"
      >
        <QrCodeIcon size="sm" className="text-spark-text-secondary" />
      </button>
      <button
        onClick={copyDepositAddress}
        aria-label="Copy deposit address"
        className="shrink-0 p-1.5 -my-1.5 rounded-md hover:bg-white/5 transition-colors"
      >
        {addressCopied
          ? <CheckIcon size="sm" className="text-spark-success" />
          : <CopyIcon size="sm" className="text-spark-text-secondary" />}
      </button>
    </span>
  );

  if (!active) return null;

  // Steps are content-sized: the sheet re-measures and re-snaps per step, so a
  // short step is not padded out to the tallest one. `pt-6` is the step padding
  // the other receive tabs use. The selection lists cap themselves against the
  // viewport (see CrossChainAssetStep) rather than against this container.
  return (
    <div className="pt-6">
      {/* Step 1: Amount */}
      {step === 'amount' && (
        <div>
          <div>
            {/* Above the amount: the network governs what the amount may be,
                and a request is the same one nearly every time. */}
            <div className="mb-3">
              <CrossChainRouteChip
                route={chipRoute}
                asset={selectedAsset}
                onClick={() => openPicker('amount')}
                disabled={routes.length === 0}
                data-testid="cross-chain-receive-route-chip"
              />
            </div>

            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-spark-text-primary">Amount</label>
              {limitRange && (
                <span className="text-xs text-spark-text-secondary" data-testid="cross-chain-receive-limits">
                  {limitRange}
                </span>
              )}
            </div>
            <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              enterKeyHint="done"
              value={usdInput}
              onChange={(e) => handleAmountChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (canContinue) handleContinue();
                }
              }}
              placeholder="Enter amount in USD"
              className={`${AMOUNT_FIELD_CLASS} pr-16`}
              data-testid="cross-chain-receive-amount-input"
            />
            {/* The same control the other amount fields carry, held disabled:
                a request is denominated in USD and there is nothing to switch
                to, which the greyed switch says better than its absence. */}
            <CurrencySwitcher isTokenMode tokenSymbol="$" onSwitch={() => {}} disabled />
            </div>

            {/* Quick amount buttons */}
            <div className="flex gap-2 mt-3">
              {QUICK_USD_AMOUNTS.map((quickAmount) => {
                const isSelected = parseFloat(usdInput) === quickAmount;
                return (
                  <button
                    key={quickAmount}
                    onClick={() => setUsdInput(String(quickAmount))}
                    className={`flex-1 py-3 rounded-lg text-sm font-mono font-medium transition-all ${
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

          <div className="space-y-4 pt-6">
            <FormError error={error} />
            <PrimaryButton onClick={handleContinue} className="w-full" disabled={!canContinue} data-testid="cross-chain-receive-continue">
              Continue
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Loading routes / creating order */}
      {(step === 'loading' || step === 'generating') && (
        <div className="flex flex-col items-center justify-center py-12 space-y-3">
          <SpinnerIcon size="lg" className="text-spark-primary animate-spin" />
          <p className="text-sm text-spark-text-secondary">
            {step === 'loading' ? 'Fetching routes...' : 'Creating request...'}
          </p>
        </div>
      )}

      {/* Step 2: Asset selection */}
      {step === 'asset' && (
        <CrossChainAssetStep
          assets={uniqueAssets}
          pending={pendingAsset}
          onPendingChange={setPendingAsset}
          onBack={cancelPicker}
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
          onContinue={() => { if (pendingChain && selectedAsset) selectChain(selectedAsset, pendingChain, routes); }}
          error={error}
        />
      )}

      {/* Step 4: Provider selection (only when >1 provider) */}
      {step === 'provider' && (
        <div className="flex flex-col" style={{ maxHeight: isSheetFull ? '85dvh' : '60dvh' }}>
          <div className="mb-4 min-h-0 flex flex-col">
            <label className="block text-sm font-medium text-spark-text-primary mb-2 shrink-0">
              Select Provider for {selectedAsset} ({formatChainName(routesForSelection[0]?.chain ?? '')})
            </label>
            <div className="space-y-2 overflow-y-auto overscroll-y-none touch-pan-y min-h-0 pr-1">
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
          <div className="shrink-0 pt-2">
            <PrimaryButton
              onClick={() => {
                const r = routesForSelection.find(x => x.provider === pendingProvider);
                if (r) generateOrder(r);
              }}
              className="w-full"
              disabled={!pendingProvider}
            >
              Continue
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Step 5: Result. Capped like the selection lists: content past 90% of
          the viewport stops the sheet fitting it, which left a short screen's
          deposit address below the fold. */}
      {step === 'result' && receiveResult && selectedRoute && (
        <div
          className="pb-2 flex flex-col items-center gap-4 overflow-y-auto overscroll-y-none touch-pan-y min-h-0"
          style={{ maxHeight: isSheetFull ? '85dvh' : '60dvh' }}
        >
          {/* The deposit, as an instruction to pass on: the label names who pays
              it, the way the exit's funding step does. Copies the bare number. */}
          <div className="text-center">
            <p className="text-spark-text-muted text-sm mb-2">Ask the sender for</p>
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
                : <CopyIcon size="sm" className="text-spark-text-muted group-hover:text-spark-text-secondary transition-colors" />}
            </button>
          </div>

          {/* Same rows, same order as the send confirm: the card describes the
              far side of the route either way round. */}
          {resultInfo && (
            <FeeBreakdownCard
              useRawStrings
              className="w-full"
              items={[
                { label: 'Network', value: resultChainName },
                { label: 'Asset', value: resultAssetName },
                { label: 'Provider', value: getProviderDisplayName(selectedRoute.provider) },
                {
                  label: 'Address',
                  node: depositAddressValue,
                  expansion: depositQr,
                },
                // With the fee and what lands: the three figures answer each
                // other, and the route above them is a different question.
                { label: 'You asked for', value: `$${usdInput}` },
                ...(resultFee ? [{ label: 'Fees', value: resultFee }] : []),
                { label: 'You receive', value: `~${formatReceived(resultInfo)}`, highlight: true },
              ]}
            />
          )}



        </div>
      )}
    </div>
  );
};

export default CrossChainReceiveWorkflow;
