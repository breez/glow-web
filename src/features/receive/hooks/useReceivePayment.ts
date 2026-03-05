import { useState, useCallback } from 'react';
import { useWallet } from '../../../contexts/WalletContext';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';
import type { PaymentMethod, ReceiveStep } from '../../../types/domain';

export interface UseReceivePaymentReturn {
  // State
  activeTab: PaymentMethod;
  currentStep: ReceiveStep;
  description: string;
  amount: string;
  error: string | null;
  isLoading: boolean;
  paymentData: string;
  feeSats: number;
  sparkAddress: string | null;
  bitcoinAddress: string | null;
  sparkLoading: boolean;
  bitcoinLoading: boolean;
  showAmountPanel: boolean;
  // Actions
  setDescription: (desc: string) => void;
  setAmount: (amt: string) => void;
  setShowAmountPanel: (show: boolean) => void;
  handleTabChange: (tab: PaymentMethod, loadLightningAddress: () => void) => void;
  generateBolt11Invoice: () => Promise<void>;
  reset: () => void;
}

export function useReceivePayment(): UseReceivePaymentReturn {
  const wallet = useWallet();

  const [activeTab, setActiveTab] = useState<PaymentMethod>('lightning');
  const [currentStep, setCurrentStep] = useState<ReceiveStep>('loading_limits');
  const [description, setDescription] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [paymentData, setPaymentData] = useState<string>('');
  const [feeSats, setFeeSats] = useState<number>(0);

  const [sparkAddress, setSparkAddress] = useState<string | null>(null);
  const [bitcoinAddress, setBitcoinAddress] = useState<string | null>(null);
  const [sparkLoading, setSparkLoading] = useState<boolean>(false);
  const [bitcoinLoading, setBitcoinLoading] = useState<boolean>(false);
  const [showAmountPanel, setShowAmountPanel] = useState<boolean>(false);

  const reset = useCallback(() => {
    setCurrentStep('input');
    setDescription('');
    setAmount('');
    setError(null);
    setIsLoading(false);
    setPaymentData('');
    setFeeSats(0);
    setSparkAddress(null);
    setBitcoinAddress(null);
    setSparkLoading(false);
    setBitcoinLoading(false);
    setShowAmountPanel(false);
  }, []);

  const generateSparkAddress = useCallback(async () => {
    if (sparkAddress || sparkLoading) return;
    setSparkLoading(true);
    try {
      const receiveResponse = await wallet.receivePayment({
        paymentMethod: { type: 'sparkAddress' },
      });
      setSparkAddress(receiveResponse.paymentRequest);
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Failed to generate Spark address', { error: formatError(err) });
      setError(`Failed to generate Spark address: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSparkLoading(false);
    }
  }, [wallet, sparkAddress, sparkLoading]);

  const generateBitcoinAddress = useCallback(async () => {
    if (bitcoinAddress || bitcoinLoading) return;
    setBitcoinLoading(true);
    try {
      const receiveResponse = await wallet.receivePayment({
        paymentMethod: { type: 'bitcoinAddress' },
      });
      setBitcoinAddress(receiveResponse.paymentRequest);
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Failed to generate Bitcoin address', { error: formatError(err) });
      setError(`Failed to generate Bitcoin address: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setBitcoinLoading(false);
    }
  }, [wallet, bitcoinAddress, bitcoinLoading]);

  const generateBolt11Invoice = useCallback(async () => {
    logger.info(LogCategory.PAYMENT, 'Starting invoice generation', { amount });
    setError(null);
    setIsLoading(true);
    setCurrentStep('loading');

    if (showAmountPanel) {
      logger.debug(LogCategory.PAYMENT, 'Closing amount panel before generating invoice');
      setShowAmountPanel(false);
    }

    try {
      const amountSats = parseInt(amount);
      if (isNaN(amountSats)) {
        throw new Error('Invalid amount');
      }

      logger.debug(LogCategory.PAYMENT, 'Calling wallet.receivePayment for bolt11 invoice', { amountSats });
      const receiveResponse = await wallet.receivePayment({
        paymentMethod: {
          type: 'bolt11Invoice',
          description,
          amountSats,
        },
      });
      logger.info(LogCategory.PAYMENT, 'Invoice generated successfully', {
        paymentRequestLength: receiveResponse.paymentRequest.length,
        fee: Number(receiveResponse.fee) || 0,
      });
      setPaymentData(receiveResponse.paymentRequest);
      setFeeSats(Number(receiveResponse.fee) || 0);
      setCurrentStep('qr');
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Failed to generate invoice', { error: formatError(err) });
      setError(`Failed to generate invoice: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setCurrentStep('input');
      setShowAmountPanel(true);
    } finally {
      setIsLoading(false);
      logger.debug(LogCategory.PAYMENT, 'Receive invoice generation process finished');
    }
  }, [wallet, amount, description, showAmountPanel]);

  const handleTabChange = useCallback((tab: PaymentMethod, loadLightningAddress: () => void) => {
    setActiveTab(tab);
    setCurrentStep('input');
    setError(null);
    setPaymentData('');
    setFeeSats(0);

    if (tab === 'lightning') {
      loadLightningAddress();
    } else if (tab === 'spark') {
      generateSparkAddress();
    } else if (tab === 'bitcoin') {
      generateBitcoinAddress();
    }
  }, [generateSparkAddress, generateBitcoinAddress]);

  return {
    activeTab,
    currentStep,
    description,
    amount,
    error,
    isLoading,
    paymentData,
    feeSats,
    sparkAddress,
    bitcoinAddress,
    sparkLoading,
    bitcoinLoading,
    showAmountPanel,
    setDescription,
    setAmount,
    setShowAmountPanel,
    handleTabChange,
    generateBolt11Invoice,
    reset,
  };
}
