import { useState, useCallback, useMemo } from 'react';
import type { PrepareSendPaymentResponse, FeePolicy, SendPaymentOptions, SdkEvent, ConversionOptions } from '@breeztech/breez-sdk-spark';
import type { SendInput } from '@/types/domain';
import { useWallet, useWalletInfo } from '../../../contexts/WalletContext';
import { useStableBalance } from '../../../contexts/StableBalanceContext';
import { getTokenBalance } from '../../../utils/tokenFormatting';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';

export type SendStep = 'input' | 'amount' | 'workflow' | 'processing' | 'result';
export type ProcessingPhase = 'sending' | 'converting';

export interface UseSendPaymentReturn {
  // State
  currentStep: SendStep;
  paymentInput: SendInput | null;
  amount: string;
  error: string | null;
  isLoading: boolean;
  prepareResponse: PrepareSendPaymentResponse | null;
  paymentResult: 'success' | 'failure' | null;
  balanceSats: number | undefined;
  tokenBalance: bigint | undefined;
  feesIncluded: boolean;
  processingPhase: ProcessingPhase;
  /** True when the destination carried its own amount (a BIP21 `amount` or a
   *  bolt11's embedded amount), so the amount step was skipped. Lets the confirm
   *  step send "back" to input instead of the amount step the user never saw. */
  amountFixed: boolean;
  tokenIdentifier: string | null;
  conversionOptions: ConversionOptions | null;
  // Actions
  clearError: () => void;
  reset: () => void;
  processInput: (input?: string | null) => Promise<void>;
  onAmountNext: (amount: bigint, includeFees?: boolean, tokenIdentifier?: string, conversionOptions?: ConversionOptions) => Promise<void>;
  handleSend: (options?: SendPaymentOptions) => Promise<void>;
  handleRun: (runner: () => Promise<void>, hasConversion?: boolean) => Promise<void>;
  setCurrentStep: (step: SendStep) => void;
  backToAmount: () => void;
}

export function useSendPayment(): UseSendPaymentReturn {
  const wallet = useWallet();
  const walletInfo = useWalletInfo();
  const stableBalance = useStableBalance();

  const [currentStep, setCurrentStep] = useState<SendStep>('input');
  const [paymentInput, setPaymentInput] = useState<SendInput | null>(null);
  const [amount, setAmount] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [prepareResponse, setPrepareResponse] = useState<PrepareSendPaymentResponse | null>(null);
  const [paymentResult, setPaymentResult] = useState<'success' | 'failure' | null>(null);
  const [feesIncluded, setFeesIncluded] = useState(false);
  const [processingPhase, setProcessingPhase] = useState<ProcessingPhase>('sending');
  const [amountFixed, setAmountFixed] = useState(false);
  const [tokenIdentifier, setTokenIdentifier] = useState<string | null>(null);
  const [conversionOptions, setConversionOptions] = useState<ConversionOptions | null>(null);

  // Balance is read live from the wallet info context, which is auto-refreshed
  // by useBreezSdk on `synced`/`paymentSucceeded`/`claimedDeposits` events. We
  // don't snapshot it locally — that was the bug that caused validation to use
  // a stale balance after auto-conversion completed mid-flow.
  const balanceSats = walletInfo?.balanceSats;
  const tokenBalance = useMemo<bigint | undefined>(() => {
    if (!walletInfo?.tokenBalances) return undefined;
    if (!stableBalance.isActive || !stableBalance.tokenIdentifier) return undefined;
    const tb = getTokenBalance(walletInfo.tokenBalances, stableBalance.tokenIdentifier);
    return tb ? tb.balance : 0n;
  }, [walletInfo, stableBalance.isActive, stableBalance.tokenIdentifier]);

  const prepareSend = useCallback(async (
    paymentRequest: string,
    amount: bigint,
    feePolicy?: FeePolicy,
    tokenIdentifier?: string,
    conversionOptions?: ConversionOptions,
    // Step to return to if prepare fails. Defaults to the amount step; the
    // fixed-amount path skips amount entry and passes 'workflow' so the error
    // surfaces on the confirm step (with the send action disabled) instead.
    errorStep: SendStep = 'amount',
  ) => {
    if (amount <= 0n) {
      setError('Please enter a valid amount');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await wallet.prepareSendPayment({
        paymentRequest: { type: 'input', input: paymentRequest },
        amount,
        feePolicy,
        tokenIdentifier,
        conversionOptions,
      });
      setPrepareResponse(response);
      setCurrentStep('workflow');
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Failed to prepare payment', { error: formatError(err) });
      setError(`Failed to prepare payment ${err instanceof Error ? err.message : 'Unknown error'}`);
      // Clear any stale response so the confirm step renders its prepare-failed
      // fallback (error + disabled send) instead of an old success render.
      setPrepareResponse(null);
      setCurrentStep(errorStep);
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  const processInput = useCallback(async (input: string | null = null) => {
    const currentInput = (input || paymentInput?.rawInput)?.trim();
    if (!currentInput) {
      setError('Please enter a payment destination');
      return;
    }

    setIsLoading(true);
    setError(null);
    // Re-evaluating a destination from scratch: drop the amount, fee choice, and
    // prepare response from any previous attempt so a re-submitted input (e.g. the
    // same URI with its amount removed) doesn't carry the old values forward.
    setAmount('');
    setFeesIncluded(false);
    setAmountFixed(false);
    setPrepareResponse(null);

    try {
      const parseResult = await wallet.parse(currentInput);

      // Unwrap a BIP21 URI (bitcoin:<addr>?amount=&label=) to its underlying
      // payment method. `paymentRequest` becomes the bare address/invoice sent to
      // prepareSendPayment (the URI itself isn't a valid send request), while
      // `rawInput` keeps the original text so the input field still shows it on
      // back-navigation. The URI amount (sats) is used as the exact send amount.
      let effective = parseResult;
      let paymentRequest = currentInput;
      let prefillAmountSat: number | undefined;
      if (parseResult.type === 'bip21') {
        const method = parseResult.paymentMethods.find(
          (m) => m.type === 'bitcoinAddress' || m.type === 'sparkAddress' || m.type === 'bolt11Invoice',
        );
        if (!method) {
          setError('Invalid payment destination');
          setCurrentStep('input');
          return;
        }
        effective = method;
        if (method.type === 'bolt11Invoice') {
          paymentRequest = method.invoice.bolt11;
        } else if (method.type === 'bitcoinAddress' || method.type === 'sparkAddress') {
          paymentRequest = method.address;
        }
        prefillAmountSat = parseResult.amountSat;
      }

      const parsed: SendInput = { rawInput: currentInput, paymentRequest, parsedInput: effective };
      setPaymentInput(parsed);

      // A fixed amount is always denominated in sats and must be paid exactly: a
      // bolt11 invoice's embedded amount, or a BIP21 `amount` parameter. Prepare
      // directly with that sats amount and skip amount entry (the same flow used for
      // amount-bearing bolt11 invoices). This also avoids the amount step's
      // stable-balance token denomination, where a sats prefill would be read as a
      // fiat value; the SDK applies any active stable-balance conversion to fund the
      // exact sats output.
      const invoiceSats =
        effective.type === 'bolt11Invoice' && effective.amountMsat && effective.amountMsat > 0
          ? Math.floor(effective.amountMsat / 1000)
          : undefined;
      const fixedSats =
        invoiceSats ?? (prefillAmountSat && prefillAmountSat > 0 ? prefillAmountSat : undefined);
      const isPayableAmountType =
        effective.type === 'bolt11Invoice' ||
        effective.type === 'bitcoinAddress' ||
        effective.type === 'sparkAddress';

      if (isPayableAmountType && fixedSats !== undefined) {
        setAmountFixed(true);
        setAmount(String(fixedSats));
        await prepareSend(paymentRequest, BigInt(fixedSats), undefined, undefined, undefined, 'workflow');
      } else if (isPayableAmountType) {
        setAmountFixed(false);
        setCurrentStep('amount');
      } else if (effective.type === 'crossChainAddress') {
        setCurrentStep('amount');
      } else if (
        effective.type === 'lnurlPay' ||
        effective.type === 'lightningAddress' ||
        effective.type === 'lnurlAuth'
      ) {
        setCurrentStep('workflow');
      } else {
        setError('Invalid payment destination');
        setCurrentStep('input');
      }
    } catch (err) {
      logger.warn(LogCategory.PAYMENT, 'Failed to parse payment input', { error: formatError(err) });
      setError('Invalid payment destination');
    } finally {
      setIsLoading(false);
    }
  }, [wallet, paymentInput?.rawInput, prepareSend]);

  const parsedInputType = paymentInput?.parsedInput.type;
  const onAmountNext = useCallback(async (
    amount: bigint,
    includeFees?: boolean,
    tokenIdentifier?: string,
    conversionOptions?: ConversionOptions,
  ) => {
    if (amount <= 0n) {
      setError('Please enter a valid amount');
      return;
    }
    setFeesIncluded(!!includeFees);

    // Cross-chain: skip prepareSend, the workflow handles route selection + prepare
    if (parsedInputType === 'crossChainAddress') {
      setAmount(String(amount));
      setTokenIdentifier(tokenIdentifier ?? null);
      setConversionOptions(conversionOptions ?? null);
      setCurrentStep('workflow');
      return;
    }

    await prepareSend(
      paymentInput?.paymentRequest || '',
      amount,
      includeFees ? 'feesIncluded' : undefined,
      tokenIdentifier,
      conversionOptions,
    );
  }, [paymentInput?.paymentRequest, parsedInputType, prepareSend]);

  const handleSend = useCallback(async (options?: SendPaymentOptions) => {
    if (!prepareResponse) return;
    const hasConversion = !!prepareResponse.conversionEstimate;
    logger.info(LogCategory.PAYMENT, 'handleSend called', {
      hasConversion,
      conversionEstimate: prepareResponse.conversionEstimate ? JSON.parse(JSON.stringify(prepareResponse.conversionEstimate)) : null,
    });
    setProcessingPhase(hasConversion ? 'converting' : 'sending');
    setCurrentStep('processing');
    setIsLoading(true);
    setError(null);

    let listenerId: string | undefined;
    if (hasConversion) {
      try {
        const initialBalance = (await wallet.getInfo({}))?.balanceSats ?? 0;
        listenerId = await wallet.addEventListener({
          onEvent: async (event: SdkEvent) => {
            if (event.type === 'synced') {
              try {
                const currentBalance = (await wallet.getInfo({}))?.balanceSats ?? 0;
                if (currentBalance > initialBalance) {
                  logger.debug(LogCategory.PAYMENT, 'Conversion complete, balance increased', {
                    initialBalance,
                    currentBalance,
                  });
                  setProcessingPhase('sending');
                }
              } catch { /* best-effort balance check */ }
            }
          },
        });
      } catch {
        // If listener setup fails, just stay on 'converting' — non-critical
      }
    }

    try {
      await wallet.sendPayment({ prepareResponse, options });
      setPaymentResult('success');
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Payment failed', { error: formatError(err) });
      setError(`Payment failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setPaymentResult('failure');
    } finally {
      if (listenerId) {
        wallet.removeEventListener(listenerId).catch(() => {});
      }
      setProcessingPhase('sending');
      setIsLoading(false);
      setCurrentStep('result');
    }
  }, [wallet, prepareResponse]);

  const handleRun = useCallback(async (runner: () => Promise<void>, hasConversion?: boolean) => {
    setProcessingPhase(hasConversion ? 'converting' : 'sending');
    setCurrentStep('processing');
    setIsLoading(true);
    setError(null);

    let listenerId: string | undefined;
    if (hasConversion) {
      try {
        const initialBalance = (await wallet.getInfo({}))?.balanceSats ?? 0;
        listenerId = await wallet.addEventListener({
          onEvent: async (event: SdkEvent) => {
            if (event.type === 'synced') {
              try {
                const currentBalance = (await wallet.getInfo({}))?.balanceSats ?? 0;
                if (currentBalance > initialBalance) {
                  logger.debug(LogCategory.PAYMENT, 'Conversion complete, balance increased', {
                    initialBalance,
                    currentBalance,
                  });
                  setProcessingPhase('sending');
                }
              } catch { /* best-effort balance check */ }
            }
          },
        });
      } catch {
        // If listener setup fails, just stay on 'converting' — non-critical
      }
    }

    try {
      await runner();
      setPaymentResult('success');
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Operation failed during payment flow', { error: formatError(err) });
      setError(`Operation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setPaymentResult('failure');
    } finally {
      if (listenerId) {
        wallet.removeEventListener(listenerId).catch(() => {});
      }
      setProcessingPhase('sending');
      setIsLoading(false);
      setCurrentStep('result');
    }
  }, [wallet]);

  const reset = useCallback(() => {
    setCurrentStep('input');
    setAmount('');
    setPrepareResponse(null);
    setError(null);
    setIsLoading(false);
    setFeesIncluded(false);
    setPaymentInput(null);
    setPaymentResult(null);
    setProcessingPhase('sending');
    setAmountFixed(false);
    setTokenIdentifier(null);
    setConversionOptions(null);
  }, []);

  // Return to the amount step from the cross-chain workflow. Clears `amount`
  // first: cross-chain stores it as sats, but the amount step renders in
  // USD/token mode, so a stale sats value would show in the wrong unit
  // (e.g. "406 sats" rendered as "$406"). Start fresh instead.
  const backToAmount = useCallback(() => {
    setAmount('');
    setError(null);
    setCurrentStep('amount');
  }, []);

  return {
    currentStep,
    paymentInput,
    amount,
    error,
    isLoading,
    prepareResponse,
    paymentResult,
    balanceSats,
    tokenBalance,
    feesIncluded,
    processingPhase,
    amountFixed,
    tokenIdentifier,
    conversionOptions,
    clearError: useCallback(() => setError(null), []),
    reset,
    processInput,
    onAmountNext,
    handleSend,
    handleRun,
    setCurrentStep,
    backToAmount,
  };
}
