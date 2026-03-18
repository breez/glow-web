import React, { useEffect } from 'react';
import { DialogHeader, BottomSheetContainer, BottomSheetCard } from '../../components/ui';
import { useWallet } from '../../contexts/WalletContext';

import InputStep from './steps/InputStep';
import Bolt11Workflow from './workflows/Bolt11Workflow';
import BitcoinWorkflow from './workflows/BitcoinWorkflow';
import SparkWorkflow from './workflows/SparkWorkflow';
import LnurlWorkflow from './workflows/LnurlWorkflow';
import LnurlAuthWorkflow from './workflows/LnurlAuthWorkflow';
import AmountStep from './steps/AmountStep';
import ProcessingStep from './steps/ProcessingStep';
import ResultStep from './steps/ResultStep';
import { SendInput } from '@/types/domain';
import { PrepareLnurlPayRequest } from '@breeztech/breez-sdk-spark';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';
import { ArrowUpIcon } from '@/components/Icons';
import { useSendPayment } from './hooks/useSendPayment';
import { getPaymentMethodName, getLnurlPayRequestDetails, getLnurlAuthRequestDetails } from './utils';

interface SendPaymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialPaymentInput?: SendInput | null;
  onScanQr?: () => void;
}

const SendPaymentDialog: React.FC<SendPaymentDialogProps> = ({ isOpen, onClose, initialPaymentInput, onScanQr }) => {
  const wallet = useWallet();
  const send = useSendPayment();

  // Reset state when dialog opens, or process initial data
  useEffect(() => {
    if (isOpen) {
      send.reset(initialPaymentInput);
      if (initialPaymentInput) {
        void (async () => {
          try {
            await send.processInput(initialPaymentInput.rawInput);
          } catch (err) {
            logger.error(LogCategory.PAYMENT, 'Failed to process initial payment input', {
              error: formatError(err),
            });
          }
        })();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialPaymentInput]);

  const dialogTitle = send.currentStep === 'input'
    ? 'Send'
    : getPaymentMethodName(send.paymentInput);

  const lnurlPayDetails = getLnurlPayRequestDetails(send.paymentInput);
  const lnurlAuthDetails = getLnurlAuthRequestDetails(send.paymentInput);

  return (
    <BottomSheetContainer isOpen={isOpen} onClose={onClose}>
      <BottomSheetCard>
        <DialogHeader
          title={dialogTitle}
          onClose={onClose}
          icon={<ArrowUpIcon />}
        />

        {send.currentStep === 'input' && (
          <InputStep
            paymentInput={send.paymentInput?.rawInput || ''}
            isLoading={send.isLoading}
            error={send.error}
            onContinue={(input) => send.processInput(input)}
            onScanQr={onScanQr}
          />
        )}

        {send.currentStep === 'amount' && (
          <AmountStep
            paymentInput={send.paymentInput?.rawInput || ''}
            amount={send.amount}
            balanceSats={send.balanceSats}
            isLoading={send.isLoading}
            error={send.error}
            onBack={() => send.setCurrentStep('input')}
            onNext={send.onAmountNext}
          />
        )}

        {send.currentStep === 'workflow' && (
          <>
            {send.prepareResponse && send.prepareResponse.paymentMethod.type === 'bolt11Invoice' && (
              <Bolt11Workflow
                method={send.prepareResponse.paymentMethod}
                amountSats={send.prepareResponse.amount}
                onBack={() => send.setCurrentStep('input')}
                onSend={send.handleSend}
              />
            )}
            {send.prepareResponse && send.prepareResponse.paymentMethod.type === 'bitcoinAddress' && (
              <BitcoinWorkflow
                method={send.prepareResponse.paymentMethod}
                amountSats={send.prepareResponse.amount}
                feesIncluded={send.feesIncluded}
                onBack={() => send.setCurrentStep('amount')}
                onSend={send.handleSend}
              />
            )}
            {send.prepareResponse && send.prepareResponse.paymentMethod.type === 'sparkAddress' && (
              <SparkWorkflow
                method={send.prepareResponse.paymentMethod}
                amountSats={send.prepareResponse.amount}
                feesIncluded={send.feesIncluded}
                onBack={() => send.setCurrentStep('input')}
                onSend={send.handleSend}
              />
            )}
            {lnurlPayDetails && (
              <LnurlWorkflow
                parsed={lnurlPayDetails}
                balanceSats={send.balanceSats}
                onBack={() => send.setCurrentStep('input')}
                onRun={send.handleRun}
                onPrepare={async (prepareRequest: PrepareLnurlPayRequest) => {
                  return await wallet.prepareLnurlPay(prepareRequest);
                }}
                onPay={async (prepareResponse) => {
                  await wallet.lnurlPay({ prepareResponse });
                }}
              />
            )}
            {lnurlAuthDetails && (
              <LnurlAuthWorkflow
                parsed={lnurlAuthDetails}
                onBack={() => send.setCurrentStep('input')}
                onRun={send.handleRun}
                onAuth={async (requestData) => {
                  return await wallet.lnurlAuth(requestData);
                }}
              />
            )}
          </>
        )}

        {send.currentStep === 'processing' && (
          <ProcessingStep operationType={send.paymentInput?.parsedInput.type === 'lnurlAuth' ? 'auth' : 'payment'} />
        )}

        {send.currentStep === 'result' && (
          <ResultStep
            result={send.paymentResult === 'success' ? 'success' : 'failure'}
            error={send.error}
            onClose={onClose}
            operationType={send.paymentInput?.parsedInput.type === 'lnurlAuth' ? 'auth' : 'payment'}
          />
        )}
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default SendPaymentDialog;
