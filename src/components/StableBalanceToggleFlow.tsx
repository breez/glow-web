import React, { useState, useEffect, useCallback } from 'react';
import type { ConversionEstimate } from '@breeztech/breez-sdk-spark';
import { useWallet } from '../contexts/WalletContext';
import { useStableBalance } from '../contexts/StableBalanceContext';
import { useFiatData } from '../contexts/FiatDataContext';
import { USDB_TICKER, USDB_TOKEN_IDENTIFIER } from '../constants/stableBalance';
import { getTokenBalance, fiatToSats, buildTokenDisplayConfig, type TokenDisplayConfig } from '../utils/tokenFormatting';
import { hasAcceptedStableDisclaimer, setStableDisclaimerAccepted } from '../services/settings';
import { logger, LogCategory } from '../services/logger';
import StableBalanceDisclaimer from './StableBalanceDisclaimer';
import { useLatest } from '../hooks/useLatest';
import StableBalanceFeeConfirm from './StableBalanceFeeConfirm';

type FlowStep = 'disclaimer' | 'estimating' | 'confirm' | 'executing';

interface StableBalanceToggleFlowProps {
  isOpen: boolean;
  direction: 'toToken' | 'toBitcoin';
  onComplete: () => void;
  onCancel: () => void;
  restorePrompt?: boolean;
}

const StableBalanceToggleFlow: React.FC<StableBalanceToggleFlowProps> = ({
  isOpen,
  direction,
  onComplete,
  onCancel,
  restorePrompt,
}) => {
  const wallet = useWallet();
  const stableBalance = useStableBalance();
  const { getOrFetchFiatData } = useFiatData();

  const [step, setStep] = useState<FlowStep>('disclaimer');
  const [conversionEstimate, setConversionEstimate] = useState<ConversionEstimate | null>(null);
  const [resolvedDisplayConfig, setResolvedDisplayConfig] = useState<TokenDisplayConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const startEstimation = useCallback(async () => {
    setError(null);

    try {
      // Fetch wallet info and ensure fiat data is available (cached or freshly fetched)
      const [freshInfo, fiatData, metadataResult] = await Promise.all([
        wallet.getInfo({}),
        getOrFetchFiatData(),
        wallet.getTokensMetadata({ tokenIdentifiers: [USDB_TOKEN_IDENTIFIER] }),
      ]);

      // Build display config from fresh data
      const metadata = metadataResult.tokensMetadata[0];
      const config = metadata ? buildTokenDisplayConfig(metadata, fiatData.fiatCurrencies) : null;
      if (config) setResolvedDisplayConfig(config);

      const tokenBal = getTokenBalance(freshInfo.tokenBalances, USDB_TOKEN_IDENTIFIER);
      const decimals = config?.decimals ?? 8;
      const fiatCurrencyId = config?.fiatCurrencyId ?? 'USD';
      const btcRate = fiatData.fiatRates.find(r => r.coin === fiatCurrencyId)?.value ?? 0;

      // Skip fee dialog if no source balance
      const hasBalance = direction === 'toToken'
        ? freshInfo.balanceSats > 0
        : (tokenBal !== null && tokenBal.balance > 0n);

      if (!hasBalance) {
        setInfo('Balance too low to convert — it will remain as change');
        setStep('confirm');
        return;
      }

      const receiveResponse = await wallet.receivePayment({
        paymentMethod: { type: 'sparkAddress' },
      });
      const sparkAddress = receiveResponse.paymentRequest;

      const conversionType = direction === 'toToken'
        ? { type: 'fromBitcoin' as const }
        : { type: 'toBitcoin' as const, fromTokenIdentifier: USDB_TOKEN_IDENTIFIER };

      // Compute amount: SDK treats amount as MinAmountOut for the conversion validator.
      // Use 90% of expected output to leave headroom for fees/slippage.
      let amount: bigint;
      const FEE_HEADROOM = 0.9;
      if (direction === 'toToken') {
        const btcValue = freshInfo.balanceSats / 100_000_000;
        const fiatValue = btcValue * btcRate * FEE_HEADROOM;
        amount = BigInt(Math.round(fiatValue * Math.pow(10, decimals)));
      } else {
        const fiatValue = Number(tokenBal?.balance ?? 0n) / Math.pow(10, decimals);
        amount = BigInt(fiatToSats(fiatValue * FEE_HEADROOM, btcRate));
      }

      // If amount rounds to zero (e.g. fiat rate not loaded yet), skip fee dialog
      if (amount <= 0n) {
        setInfo('Balance too low to convert — it will remain as change');
        setStep('confirm');
        return;
      }

      // Show modal now — all quick checks passed, preparing fee estimate
      setStep('estimating');

      const prepareResponse = await wallet.prepareSendPayment({
        paymentRequest: { type: 'input', input: sparkAddress },
        amount,
        tokenIdentifier: direction === 'toToken' ? USDB_TOKEN_IDENTIFIER : undefined,
        conversionOptions: { conversionType },
      });

      if (prepareResponse.conversionEstimate) {
        setConversionEstimate(prepareResponse.conversionEstimate);
      }
      setStep('confirm');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg.includes('less than minimum required')) {
        setInfo('Balance too low to convert — it will remain as change');
        setStep('confirm');
        return;
      }
      setStep('confirm');
    }
  }, [wallet, direction, getOrFetchFiatData]);

  // Use refs so the isOpen effect snapshots the latest props/callbacks
  // without re-firing when they change mid-flow.
  const startEstimationRef = useLatest(startEstimation);
  const restorePromptRef = useLatest(restorePrompt);

  // No reset-in-effect needed — parent (CollapsingWalletHeader) bumps
  // `toggleFlowSession` on every open and passes it as `key`, so each
  // open is a fresh mount with all useState at defaults. We only need to
  // route into the right initial step on first mount.
  useEffect(() => {
    if (!isOpen) return;
    if (restorePromptRef.current || !hasAcceptedStableDisclaimer()) {
      setStep('disclaimer');
    } else {
      startEstimationRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const executeToggle = useCallback(async () => {
    logger.debug(LogCategory.SDK, 'executeToggle: starting', { direction, hasEstimate: !!conversionEstimate });
    setStep('executing');
    try {
      // Snapshot current balance before toggling so we can detect an increase
      let balanceBefore = 0n;
      if (conversionEstimate) {
        const infoBefore = await wallet.getInfo({});
        if (direction === 'toToken') {
          const tokenBal = getTokenBalance(infoBefore.tokenBalances, USDB_TOKEN_IDENTIFIER);
          balanceBefore = tokenBal?.balance ?? 0n;
        } else {
          balanceBefore = BigInt(infoBefore.balanceSats);
        }
        logger.debug(LogCategory.SDK, 'executeToggle: balance before toggle', { balanceBefore: balanceBefore.toString() });
      }

      const ticker = direction === 'toToken' ? USDB_TICKER : null;
      logger.debug(LogCategory.SDK, 'executeToggle: calling toggleStableBalance', { ticker });
      await stableBalance.toggleStableBalance(ticker);
      logger.debug(LogCategory.SDK, 'executeToggle: toggleStableBalance returned');

      // If we had a conversion estimate, poll until the new-mode balance increases
      if (conversionEstimate) {
        logger.debug(LogCategory.SDK, 'executeToggle: starting balance poll');
        const maxAttempts = 30;
        for (let i = 0; i < maxAttempts; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const info = await wallet.getInfo({});
          let currentBalance = 0n;
          if (direction === 'toToken') {
            const tokenBal = getTokenBalance(info.tokenBalances, USDB_TOKEN_IDENTIFIER);
            currentBalance = tokenBal?.balance ?? 0n;
          } else {
            currentBalance = BigInt(info.balanceSats);
          }
          logger.debug(LogCategory.SDK, `executeToggle: poll ${i + 1}/${maxAttempts}`, { currentBalance: currentBalance.toString(), balanceBefore: balanceBefore.toString() });
          if (currentBalance > balanceBefore) break;
        }
        logger.debug(LogCategory.SDK, 'executeToggle: poll finished');
      } else {
        logger.debug(LogCategory.SDK, 'executeToggle: no estimate, skipping poll');
      }

      logger.debug(LogCategory.SDK, 'executeToggle: calling onComplete');
      onComplete();
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logger.error(LogCategory.SDK, 'Failed to toggle stable balance', { error: errorMsg });
      setError(`Failed to switch: ${errorMsg}`);
      setStep('confirm');
    }
  }, [direction, stableBalance, conversionEstimate, wallet, onComplete]);

  const handleDisclaimerAccept = useCallback(() => {
    setStableDisclaimerAccepted();
    startEstimation();
  }, [startEstimation]);

  const handleConfirm = useCallback(() => {
    executeToggle();
  }, [executeToggle]);

  if (!isOpen) return null;

  if (step === 'disclaimer') {
    return (
      <StableBalanceDisclaimer
        isOpen
        onAccept={handleDisclaimerAccept}
        onCancel={onCancel}
        {...(restorePrompt ? {
          title: 'USD Balance Detected',
          description:
            "We've detected USD funds in your wallet. Would you like to switch to USD mode?" +
            '\n\n' +
            'Your balance will be held in USD. Incoming BTC is automatically converted to USD, ' +
            'and outgoing payments are converted back to BTC.',
        } : {})}
      />
    );
  }

  return (
    <StableBalanceFeeConfirm
      isOpen
      direction={direction}
      conversionEstimate={conversionEstimate}
      displayConfig={resolvedDisplayConfig ?? stableBalance.displayConfig}
      isEstimating={step === 'estimating'}
      isExecuting={step === 'executing'}
      error={error}
      info={info}
      onConfirm={handleConfirm}
      onCancel={onCancel}
    />
  );
};

export default StableBalanceToggleFlow;
