import React, { useState, useEffect } from 'react';
import { DialogHeader, StepPanelGroup, StepPanel, BottomSheetContainer, BottomSheetCard } from '../../components/ui';
import { useWallet } from '../../contexts/WalletContext';
// No fee UI in generic amount step; BTC fee selection is handled inside Bitcoin workflow

// External components
import InputStep from './steps/InputStep';
import Bolt11Workflow from './workflows/Bolt11Workflow';
import BitcoinWorkflow from './workflows/BitcoinWorkflow';
import SparkWorkflow from './workflows/SparkWorkflow';
import LnurlWorkflow from './workflows/LnurlWorkflow';
import AmountStep from './steps/AmountStep';
import ProcessingStep from './steps/ProcessingStep';
import ResultStep from './steps/ResultStep';
import { SendInput } from '@/types/domain';
import { LnurlPayRequestDetails, PrepareLnurlPayRequest } from '@breeztech/breez-sdk-spark';

// Props interfaces
interface SendPaymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialPaymentInput?: SendInput | null;
  onScanQr?: () => void;
}

// Main component
const SendPaymentDialog: React.FC<SendPaymentDialogProps> = ({ isOpen, onClose, initialPaymentInput, onScanQr }) => {
  const wallet = useWallet();
  // Container state: input parsing + routing to workflow per input type
  const [currentStep, setCurrentStep] = useState<'input' | 'amount' | 'workflow' | 'processing' | 'result'>('input');
  const [paymentInput, setPaymentInput] = useState<SendInput | null>(null);
  const [amount, setAmount] = useState<string>('');
  // Fee selection moved into Bitcoin workflow
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [prepareResponse, setPrepareResponse] = useState<import('@breeztech/breez-sdk-spark').PrepareSendPaymentResponse | null>(null);
  const [paymentResult, setPaymentResult] = useState<'success' | 'failure' | null>(null);

  // Reset state when dialog opens, or process initial data
  useEffect(() => {
    if (isOpen) {
      // Reset state first
      setCurrentStep('input');
      setAmount('');
      setPrepareResponse(null);
      setError(null);
      setIsLoading(false);

      // If we have initial parsed data from QR scan, process it immediately
      if (initialPaymentInput) {
        setPaymentInput(initialPaymentInput);
        // Use a microtask to avoid calling async function in effect body
        void (async () => {
          try {
            await processPaymentInputAsync(initialPaymentInput.rawInput);
          } catch (err) {
            console.error('Failed to process initial payment input:', err);
          }
        })();
      } else {
        setPaymentInput(null);
      }
    }
    // Note: processPaymentInputAsync is intentionally not in deps to avoid loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialPaymentInput]);

  // Unified payment processing function (renamed for clarity)
  const processPaymentInputAsync = async (input: string | null = null) => {
    const currentInput = (input || paymentInput?.rawInput)?.trim();
    if (!currentInput) {
      setError('Please enter a payment destination');
      return;
    }


    setIsLoading(true);
    setError(null);

    try {
      // First, use sdk.parse to determine the input type
      const parseResult = await wallet.parseInput(currentInput);
      setPaymentInput({ rawInput: currentInput.trim(), parsedInput: parseResult });
      if (parseResult.type === 'bolt11Invoice' && parseResult.amountMsat && parseResult.amountMsat > 0) {
        const sats = Math.floor(parseResult.amountMsat / 1000);
        setAmount(String(sats));
        await prepareSendPayment(currentInput, sats);
      } else if (parseResult.type === 'bitcoinAddress' || parseResult.type === 'sparkAddress') {
        setCurrentStep('amount');
      } else if (parseResult.type === 'lnurlPay') {
        // Route to LNURL workflow to collect amount and (optional) comment
        setCurrentStep('workflow');
      } else if (parseResult.type === 'lightningAddress') {
        setCurrentStep('workflow');
      } else {
        setError('Invalid payment destination');
        setCurrentStep('input');
      }
    } catch (err) {
      console.error('Failed to parse input:', err);
      setError('Invalid payment destination');
    } finally {
      setIsLoading(false);
    }
  };

  // Common prepare for all input types
  const prepareSendPayment = async (paymentRequest: string, amountSats: number) => {
    if (amountSats <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await wallet.prepareSendPayment({ paymentRequest, amount: BigInt(amountSats) });
      setPrepareResponse(response);
      // Always go to workflow; BTC fee selection happens inside the Bitcoin workflow
      setCurrentStep('workflow');
    } catch (err) {
      console.error('Failed to prepare payment:', err);
      setError(`Failed to prepare payment ${err instanceof Error ? err.message : 'Unknown error'}`);
      setCurrentStep('amount');
    } finally {
      setIsLoading(false);
    }
  };

  const onAmountNext = async (amountNum: number) => {
    if (!amountNum || amountNum <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    setAmount(String(amountNum));
    await prepareSendPayment(paymentInput?.rawInput || '', amountNum);
  };
  // Get payment method display name
  const getPaymentMethodName = (): string => {
    if (!paymentInput) return '';
    switch (paymentInput.parsedInput.type) {
      case 'bolt11Invoice':
        return 'Lightning Invoice';
      case 'sparkAddress':
        return 'Spark Address';
      case 'bitcoinAddress':
        return 'Bitcoin Address';
      case 'lnurlPay':
        return 'LNURL Pay';
      case 'lightningAddress':
        return 'Lightning Address';
      default:
        return 'Payment';
    }
  };

  // Get dialog title based on current step
  const getDialogTitle = (): string => {
    if (currentStep === 'amount' || currentStep === 'workflow') {
      return getPaymentMethodName();
    }
    return 'Send';
  };

  // Generic send handler: transitions to processing/result with error handling
  const handleSend = async (options?: any) => {
    if (!prepareResponse) return;
    setCurrentStep('processing');
    setIsLoading(true);
    setError(null);
    try {
      await wallet.sendPayment({ prepareResponse, options });
      setPaymentResult('success');
    } catch (err) {
      console.error('Payment failed:', err);
      setError(`Payment failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setPaymentResult('failure');
    } finally {
      setIsLoading(false);
      setCurrentStep('result');
    }
  };

  // Generic runner for flows like LNURL Pay where the workflow provides the operation
  const handleRun = async (runner: () => Promise<void>) => {
    setCurrentStep('processing');
    setIsLoading(true);
    setError(null);
    try {
      await runner();
      setPaymentResult('success');
    } catch (err) {
      console.error('Operation failed:', err);
      setError(`Operation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setPaymentResult('failure');
    } finally {
      setIsLoading(false);
      setCurrentStep('result');
    }
  };

  const getLnurlPayRequestDetails = (): LnurlPayRequestDetails | null => {
    if (paymentInput && paymentInput.parsedInput.type === 'lnurlPay') {
      return paymentInput.parsedInput;
    }
    if (paymentInput && paymentInput.parsedInput.type === 'lightningAddress') {
      return paymentInput.parsedInput.payRequest;
    }
    return null;
  };

  return (
    <BottomSheetContainer isOpen={isOpen} onClose={onClose}>
      <BottomSheetCard className="bottom-sheet-card">
        <DialogHeader 
          title={getDialogTitle()} 
          onClose={onClose}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
            </svg>
          }
        />

        <StepPanelGroup>
          {/* Input Step */}
          <StepPanel isActive={currentStep === 'input'}>
            <InputStep
              paymentInput={paymentInput?.rawInput || ''}
              isLoading={isLoading}
              error={error}
              onContinue={(paymentInput) => processPaymentInputAsync(paymentInput)}
              onScanQr={onScanQr}
            />
          </StepPanel>

          {/* Amount Step (common) */}
          <StepPanel isActive={currentStep === 'amount'}>
            <AmountStep
              paymentInput={paymentInput?.rawInput || ''}
              amount={amount}
              isLoading={isLoading}
              error={error}
              onBack={() => setCurrentStep('input')}
              onNext={onAmountNext}
            />
          </StepPanel>

          {/* Workflow Step: delegates to a specific workflow component */}
          <StepPanel isActive={currentStep === 'workflow'}>
            {prepareResponse && prepareResponse.paymentMethod.type === 'bolt11Invoice' && (
              <Bolt11Workflow
                method={prepareResponse.paymentMethod}
                amountSats={prepareResponse.amount}
                onBack={() => setCurrentStep('input')}
                onSend={handleSend}
              />
            )}
            {prepareResponse && prepareResponse.paymentMethod.type === 'bitcoinAddress' && (
              <BitcoinWorkflow
                method={prepareResponse.paymentMethod}
                amountSats={prepareResponse.amount}
                onBack={() => setCurrentStep('amount')}
                onSend={handleSend}
              />
            )}
            {prepareResponse && prepareResponse.paymentMethod.type === 'sparkAddress' && (
              <SparkWorkflow
                method={prepareResponse.paymentMethod}
                amountSats={prepareResponse.amount}
                onBack={() => setCurrentStep('input')}
                onSend={handleSend}
              />
            )}
            {getLnurlPayRequestDetails() && (
              <LnurlWorkflow
                parsed={getLnurlPayRequestDetails()!}
                onBack={() => setCurrentStep('input')}
                onRun={handleRun}
                onPrepare={async (prepareRequest: PrepareLnurlPayRequest) => {
                  return await wallet.prepareLnurlPay(prepareRequest);
                }}
                onPay={async (prepareResponse) => {
                  await wallet.lnurlPay({ prepareResponse });
                }}
              />
            )}
          </StepPanel>

          {/* Processing Step (generic) */}
          <StepPanel isActive={currentStep === 'processing'}>
            <ProcessingStep />
          </StepPanel>

          {/* Result Step (generic) */}
          <StepPanel isActive={currentStep === 'result'}>
            <ResultStep result={paymentResult === 'success' ? 'success' : 'failure'} error={error} onClose={onClose} />
          </StepPanel>
        </StepPanelGroup>
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default SendPaymentDialog;
