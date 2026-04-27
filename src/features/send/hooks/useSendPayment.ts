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
  // Actions
  clearError: () => void;
  reset: () => void;
  processInput: (input?: string | null) => Promise<void>;
  onAmountNext: (amount: bigint, includeFees?: boolean, tokenIdentifier?: string, conversionOptions?: ConversionOptions) => Promise<void>;
  handleSend: (options?: SendPaymentOptions) => Promise<void>;
  handleRun: (runner: () => Promise<void>, hasConversion?: boolean) => Promise<void>;
  setCurrentStep: (step: SendStep) => void;
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
  ) => {
    if (amount <= 0n) {
      setError('Please enter a valid amount');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await wallet.prepareSendPayment({
        paymentRequest,
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
      setCurrentStep('amount');
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

    try {
      const parseResult = await wallet.parse(currentInput);
      const parsed: SendInput = { rawInput: currentInput.trim(), parsedInput: parseResult };
      setPaymentInput(parsed);

      if (parseResult.type === 'bolt11Invoice' && parseResult.amountMsat && parseResult.amountMsat > 0) {
        const sats = Math.floor(parseResult.amountMsat / 1000);
        setAmount(String(sats));
        await prepareSend(currentInput, BigInt(sats));
      } else if (parseResult.type === 'bolt11Invoice') {
        setCurrentStep('amount');
      } else if (parseResult.type === 'bitcoinAddress' || parseResult.type === 'sparkAddress') {
        setCurrentStep('amount');
      } else if (parseResult.type === 'lnurlPay' || parseResult.type === 'lightningAddress') {
        setCurrentStep('workflow');
      } else if (parseResult.type === 'lnurlAuth') {
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
    await prepareSend(
      paymentInput?.rawInput || '',
      amount,
      includeFees ? 'feesIncluded' : undefined,
      tokenIdentifier,
      conversionOptions,
    );
  }, [paymentInput?.rawInput, prepareSend]);

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
    clearError: useCallback(() => setError(null), []),
    reset,
    processInput,
    onAmountNext,
    handleSend,
    handleRun,
    setCurrentStep,
  };
}
