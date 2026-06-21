import React, { useEffect, useMemo, useState } from 'react';
import { DialogHeader, BottomSheetContainer, BottomSheetCard } from '../../components/ui';
import { useWallet } from '../../contexts/WalletContext';
import { useContactsContext } from '../../contexts/ContactsContext';

import InputStep from './steps/InputStep';
import Bolt11Workflow from './workflows/Bolt11Workflow';
import BitcoinWorkflow from './workflows/BitcoinWorkflow';
import SparkWorkflow from './workflows/SparkWorkflow';
import LnurlWorkflow from './workflows/LnurlWorkflow';
import LnurlAuthWorkflow from './workflows/LnurlAuthWorkflow';
import CrossChainWorkflow from './workflows/CrossChainWorkflow';
import AmountStep from './steps/AmountStep';
import ConfirmStep from './steps/ConfirmStep';
import ProcessingStep from './steps/ProcessingStep';
import ResultStep from './steps/ResultStep';
import ContactsSubView from './components/ContactsSubView';
import { PrepareLnurlPayRequest } from '@breeztech/breez-sdk-spark';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';
import { ArrowUpIcon } from '@/components/Icons';
import { useSendPayment } from './hooks/useSendPayment';
import { getPaymentMethodName, getLnurlPayRequestDetails, getLnurlAuthRequestDetails } from './utils';
import { isCrossChainEnabled } from '@/services/settings';

interface SendPaymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialRawInput?: string | null;
  onScanQr?: () => void;
  onSuccessfulSend?: (lightningAddress?: string) => void;
}

const SendPaymentDialog: React.FC<SendPaymentDialogProps> = ({ isOpen, onClose, initialRawInput, onScanQr, onSuccessfulSend }) => {
  const wallet = useWallet();
  const send = useSendPayment();
  const { findContactByAddress } = useContactsContext();
  const [showContactsView, setShowContactsView] = useState(false);
  const [selectedContactAddress, setSelectedContactAddress] = useState<string | null>(null);

  // Parent (WalletPage) bumps `sendDialogSession` on every open and passes
  // it as `key`, so each open is a fresh mount: hooks re-init, useState
  // returns defaults, no reset-in-effect needed. We only need an effect
  // to consume `initialRawInput` on first mount.
  useEffect(() => {
    if (!initialRawInput) return;
    void (async () => {
      try {
        await send.processInput(initialRawInput);
      } catch (err) {
        logger.error(LogCategory.PAYMENT, 'Failed to process initial payment input', {
          error: formatError(err),
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRawInput]);

  // Detect successful send to non-contact lightning address for save prompt
  const lightningAddressForSave = useMemo(() => {
    if (send.paymentResult !== 'success') return undefined;
    if (send.paymentInput?.parsedInput.type !== 'lightningAddress') return undefined;
    const address = send.paymentInput.rawInput;
    if (findContactByAddress(address)) return undefined;
    return address;
  }, [send.paymentResult, send.paymentInput, findContactByAddress]);

  const handleClose = () => {
    if (lightningAddressForSave) {
      onSuccessfulSend?.(lightningAddressForSave);
    }
    onClose();
  };

  // Back to the input step from a step that surfaces a prepare/amount error;
  // clear it so the stale message doesn't follow the user onto the input screen.
  const backToInput = () => {
    send.clearError();
    send.setCurrentStep('input');
  };

  const dialogTitle = send.currentStep === 'input'
    ? (isCrossChainEnabled() ? 'Send BTC or USD' : 'Send BTC')
    : getPaymentMethodName(send.paymentInput);

  const recipientLabel = useMemo(() => {
    if (send.paymentInput?.parsedInput.type !== 'lightningAddress') return undefined;
    const address = send.paymentInput.rawInput;
    const contact = findContactByAddress(address);
    return contact ? `Pay to ${contact.name}` : `Pay to ${address}`;
  }, [send.paymentInput, findContactByAddress]);

  const lnurlPayDetails = getLnurlPayRequestDetails(send.paymentInput);
  const lnurlAuthDetails = getLnurlAuthRequestDetails(send.paymentInput);

  // Prepare can fail before producing a response (e.g. insufficient funds on a
  // fixed-amount payment). With no response and no LNURL workflow to render, show
  // the error on the confirm step with the send action disabled, rather than a
  // blank step. Only read inside the workflow-step block below.
  const prepareFailed = !send.prepareResponse && !lnurlPayDetails && !lnurlAuthDetails && !!send.error;

  return (
    <BottomSheetContainer isOpen={isOpen} onClose={handleClose} showBackdrop>
      <BottomSheetCard>
        <div className="relative overflow-x-clip">
          {/* Contacts sub-view — slides in from right */}
          <div
            className={`transition-all duration-200 ease-out ${
              showContactsView
                ? 'relative opacity-100 translate-x-0'
                : 'absolute inset-0 opacity-0 translate-x-full pointer-events-none'
            }`}
          >
            {showContactsView && (
              <ContactsSubView
                onBack={() => setShowContactsView(false)}
                onSelect={(address) => {
                  setShowContactsView(false);
                  setSelectedContactAddress(address);
                }}
              />
            )}
          </div>

          {/* Main send view — slides out to left */}
          <div
            className={`transition-all duration-200 ease-out ${
              showContactsView
                ? 'absolute inset-0 opacity-0 -translate-x-full pointer-events-none'
                : 'relative opacity-100 translate-x-0'
            }`}
          >
            <DialogHeader
              title={dialogTitle}
              onClose={handleClose}
              icon={<ArrowUpIcon />}
            />

            {send.currentStep === 'input' && (
              <InputStep
                // Remount on contact-selection change so InputStep
                // lazy-inits from the latest props.
                key={`input-${selectedContactAddress ?? ''}`}
                paymentInput={send.paymentInput?.rawInput || ''}
                selectedContactAddress={selectedContactAddress}
                isLoading={send.isLoading}
                error={send.error}
                onClearError={send.clearError}
                onContinue={(input) => send.processInput(input)}
                onScanQr={onScanQr}
                onOpenContacts={() => {
                  setSelectedContactAddress(null);
                  setShowContactsView(true);
                }}
              />
            )}

            {send.currentStep === 'amount' && (
              <AmountStep
                paymentInput={send.paymentInput?.rawInput || ''}
                amount={send.amount}
                balanceSats={send.balanceSats}
                tokenBalance={send.tokenBalance}
                isLoading={send.isLoading}
                error={send.error}
                onBack={backToInput}
                onNext={send.onAmountNext}
                amountFirst={send.paymentInput?.parsedInput.type === 'crossChainAddress'}
              />
            )}

            {send.currentStep === 'workflow' && (
              <>
                {send.prepareResponse && send.prepareResponse.paymentMethod.type === 'bolt11Invoice' && (
                  <Bolt11Workflow
                    method={send.prepareResponse.paymentMethod}
                    amountSats={send.prepareResponse.amount}
                    feesIncluded={send.feesIncluded}
                    conversionEstimate={send.prepareResponse.conversionEstimate}
                    balanceSats={send.balanceSats}
                    tokenBalance={send.tokenBalance}
                    onBack={() => send.setCurrentStep('input')}
                    onSend={send.handleSend}
                  />
                )}
                {send.prepareResponse && send.prepareResponse.paymentMethod.type === 'bitcoinAddress' && (
                  <BitcoinWorkflow
                    method={send.prepareResponse.paymentMethod}
                    amountSats={send.prepareResponse.amount}
                    feesIncluded={send.feesIncluded}
                    conversionEstimate={send.prepareResponse.conversionEstimate}
                    balanceSats={send.balanceSats}
                    tokenBalance={send.tokenBalance}
                    onBack={() => send.setCurrentStep(send.amountFixed ? 'input' : 'amount')}
                    onSend={send.handleSend}
                  />
                )}
                {send.prepareResponse && send.prepareResponse.paymentMethod.type === 'sparkAddress' && (
                  <SparkWorkflow
                    method={send.prepareResponse.paymentMethod}
                    amountSats={send.prepareResponse.amount}
                    feesIncluded={send.feesIncluded}
                    conversionEstimate={send.prepareResponse.conversionEstimate}
                    balanceSats={send.balanceSats}
                    tokenBalance={send.tokenBalance}
                    onBack={() => send.setCurrentStep('input')}
                    onSend={send.handleSend}
                  />
                )}
                {lnurlPayDetails && (
                  <LnurlWorkflow
                    parsed={lnurlPayDetails}
                    recipientLabel={recipientLabel}
                    balanceSats={send.balanceSats}
                    tokenBalance={send.tokenBalance}
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
                {prepareFailed && (
                  <ConfirmStep
                    amountSats={/^\d+$/.test(send.amount) ? BigInt(send.amount) : null}
                    feesSat={null}
                    balanceSats={send.balanceSats}
                    tokenBalance={send.tokenBalance}
                    error={send.error}
                    isLoading={false}
                    disableConfirm
                    onBack={backToInput}
                    onConfirm={() => {}}
                  />
                )}
                {send.paymentInput?.parsedInput.type === 'crossChainAddress' && (
                  <CrossChainWorkflow
                    addressDetails={send.paymentInput.parsedInput}
                    amountSats={parseInt(send.amount) || 0}
                    feesIncluded={send.feesIncluded}
                    tokenIdentifier={send.tokenIdentifier}
                    conversionOptions={send.conversionOptions}
                    onBack={send.backToAmount}
                    onRun={send.handleRun}
                  />
                )}
              </>
            )}

            {send.currentStep === 'processing' && (
              <ProcessingStep operationType={send.paymentInput?.parsedInput.type === 'lnurlAuth' ? 'auth' : 'payment'} processingPhase={send.processingPhase} />
            )}

            {send.currentStep === 'result' && (
              <ResultStep
                result={send.paymentResult === 'success' ? 'success' : 'failure'}
                error={send.error}
                onClose={handleClose}
                operationType={send.paymentInput?.parsedInput.type === 'lnurlAuth' ? 'auth' : 'payment'}
              />
            )}
          </div>
        </div>
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default SendPaymentDialog;
