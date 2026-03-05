import { useState, useCallback } from 'react';
import type { PrepareSendPaymentResponse, FeePolicy, SendPaymentOptions } from '@breeztech/breez-sdk-spark';
import type { SendInput } from '@/types/domain';
import { useWallet } from '../../../contexts/WalletContext';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';

export type SendStep = 'input' | 'amount' | 'workflow' | 'processing' | 'result';

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
  feesIncluded: boolean;
  // Actions
  reset: (initialInput?: SendInput | null) => void;
  processInput: (input?: string | null) => Promise<void>;
  onAmountNext: (amountNum: number, includeFees?: boolean) => Promise<void>;
  handleSend: (options?: SendPaymentOptions) => Promise<void>;
  handleRun: (runner: () => Promise<void>) => Promise<void>;
  setCurrentStep: (step: SendStep) => void;
}

export function useSendPayment(): UseSendPaymentReturn {
  const wallet = useWallet();

  const [currentStep, setCurrentStep] = useState<SendStep>('input');
  const [paymentInput, setPaymentInput] = useState<SendInput | null>(null);
  const [amount, setAmount] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [prepareResponse, setPrepareResponse] = useState<PrepareSendPaymentResponse | null>(null);
  const [paymentResult, setPaymentResult] = useState<'success' | 'failure' | null>(null);
  const [balanceSats, setBalanceSats] = useState<number | undefined>(undefined);
  const [feesIncluded, setFeesIncluded] = useState(false);

  const fetchBalance = useCallback(() => {
    wallet.getInfo({}).then(info => {
      if (info) setBalanceSats(info.balanceSats);
    }).catch(() => { /* balance fetch is best-effort */ });
  }, [wallet]);

  const prepareSend = useCallback(async (paymentRequest: string, amountSats: number, feePolicy?: FeePolicy) => {
    if (amountSats <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await wallet.prepareSendPayment({ paymentRequest, amount: BigInt(amountSats), feePolicy });
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
        await prepareSend(currentInput, sats);
      } else if (parseResult.type === 'bolt11Invoice') {
        fetchBalance();
        setCurrentStep('amount');
      } else if (parseResult.type === 'bitcoinAddress' || parseResult.type === 'sparkAddress') {
        fetchBalance();
        setCurrentStep('amount');
      } else if (parseResult.type === 'lnurlPay' || parseResult.type === 'lightningAddress') {
        fetchBalance();
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
  }, [wallet, paymentInput?.rawInput, prepareSend, fetchBalance]);

  const onAmountNext = useCallback(async (amountNum: number, includeFees?: boolean) => {
    if (!amountNum || amountNum <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    setAmount(String(amountNum));
    setFeesIncluded(!!includeFees);
    await prepareSend(
      paymentInput?.rawInput || '',
      amountNum,
      includeFees ? 'feesIncluded' : undefined,
    );
  }, [paymentInput?.rawInput, prepareSend]);

  const handleSend = useCallback(async (options?: SendPaymentOptions) => {
    if (!prepareResponse) return;
    setCurrentStep('processing');
    setIsLoading(true);
    setError(null);
    try {
      await wallet.sendPayment({ prepareResponse, options });
      setPaymentResult('success');
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Payment failed', { error: formatError(err) });
      setError(`Payment failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setPaymentResult('failure');
    } finally {
      setIsLoading(false);
      setCurrentStep('result');
    }
  }, [wallet, prepareResponse]);

  const handleRun = useCallback(async (runner: () => Promise<void>) => {
    setCurrentStep('processing');
    setIsLoading(true);
    setError(null);
    try {
      await runner();
      setPaymentResult('success');
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Operation failed during payment flow', { error: formatError(err) });
      setError(`Operation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setPaymentResult('failure');
    } finally {
      setIsLoading(false);
      setCurrentStep('result');
    }
  }, []);

  const reset = useCallback((initialInput?: SendInput | null) => {
    setCurrentStep('input');
    setAmount('');
    setPrepareResponse(null);
    setError(null);
    setIsLoading(false);
    setBalanceSats(undefined);
    setFeesIncluded(false);
    setPaymentInput(initialInput ?? null);
    setPaymentResult(null);
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
    feesIncluded,
    reset,
    processInput,
    onAmountNext,
    handleSend,
    handleRun,
    setCurrentStep,
  };
}
