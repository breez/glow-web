import React, { useState, useEffect } from 'react';
import type { Payment } from '@breeztech/breez-sdk-spark';
import {
  DialogHeader, PaymentInfoCard, PaymentInfoRow,
  CollapsibleCodeField, BottomSheetContainer, BottomSheetCard
} from './ui';
import { formatWithSpaces } from '../utils/formatNumber';

interface PaymentDetailsDialogProps {
  optionalPayment: Payment | null;
  onClose: () => void;
}

// Threshold for when to use collapsible chevron
const LONG_TEXT_THRESHOLD = 35;

// Get the payment title (same logic as TransactionList)
const getPaymentTitle = (payment: Payment): string => {
  if (payment.method === 'lightning') {
    if (payment.details?.type === 'lightning') {
      if (payment.details.lnurlPayInfo?.lnAddress) {
        return payment.details.lnurlPayInfo.lnAddress;
      }
      return payment.details?.description || 'Lightning Payment';
    }
    return 'Lightning Payment';
  }
  if (payment.method === 'spark') return 'Spark Transfer';
  if (payment.method === 'deposit') return 'BTC Transfer';
  if (payment.method === 'withdraw') return 'BTC Transfer';
  return 'Payment';
};

const getDefaultVisibleFields = () => ({
  invoice: false,
  preimage: false,
  destinationPubkey: false,
  txId: false,
  swapId: false,
  assetId: false,
  destination: false,
  description: false,
  comment: false,
  message: false,
  url: false,
  lnAddress: false,
  lnurlDomain: false
});

const PaymentDetailsDialog: React.FC<PaymentDetailsDialogProps> = ({ optionalPayment, onClose }) => {
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>(getDefaultVisibleFields());

  // Reset all expanded fields when a new payment is opened
  useEffect(() => {
    if (optionalPayment) {
      setVisibleFields(getDefaultVisibleFields());
    }
  }, [optionalPayment]);

  // Format date and time
  const formatDateTime = (timestamp: number): string => {
    return new Date(timestamp * 1000).toLocaleString(undefined, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const toggleField = (field: string) => {
    setVisibleFields(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  if (!optionalPayment) return (
    <BottomSheetContainer isOpen={optionalPayment != null} onClose={onClose}>
      <BottomSheetCard>{
        <div></div>}</BottomSheetCard>
    </BottomSheetContainer>

  );
  const payment = optionalPayment!;
  return (
    <BottomSheetContainer isOpen={optionalPayment != null} onClose={onClose}>
      <BottomSheetCard>
        <DialogHeader title={getPaymentTitle(payment)} onClose={onClose} />
        <div className="space-y-4 overflow-y-auto">
          {/* General Payment Information */}
          <PaymentInfoCard>
            <PaymentInfoRow
              label="Amount"
              value={`${payment.paymentType === 'receive' ? '+' : '-'} ${formatWithSpaces(payment.amount)} sats`}
            />

            {payment.fees > 0 && (
              <PaymentInfoRow
                label="Fee"
                value={`${formatWithSpaces(payment.fees)} sats`}
              />
            )}

            <PaymentInfoRow
              label="Date & Time"
              value={formatDateTime(payment.timestamp)}
            />

            {payment.details?.type === 'lightning' && payment.details.description && (
              payment.details.description.length > LONG_TEXT_THRESHOLD ? (
                <CollapsibleCodeField
                  label="Description"
                  value={payment.details.description}
                  isVisible={visibleFields.description}
                  onToggle={() => toggleField('description')}
                />
              ) : (
                <PaymentInfoRow
                  label="Description"
                  value={payment.details.description}
                />
              )
            )}

            {payment.details?.type === 'lightning' && payment.details.lnurlPayInfo?.lnAddress && (
              payment.details.lnurlPayInfo.lnAddress.length > LONG_TEXT_THRESHOLD ? (
                <CollapsibleCodeField
                  label="Lightning Address"
                  value={payment.details.lnurlPayInfo.lnAddress}
                  isVisible={visibleFields.lnAddress}
                  onToggle={() => toggleField('lnAddress')}
                />
              ) : (
                <PaymentInfoRow
                  label="Lightning Address"
                  value={payment.details.lnurlPayInfo.lnAddress}
                />
              )
            )}

            {payment.details?.type === 'lightning' && payment.details.lnurlPayInfo && !payment.details.lnurlPayInfo.lnAddress && payment.details.lnurlPayInfo.domain && (
              payment.details.lnurlPayInfo.domain.length > LONG_TEXT_THRESHOLD ? (
                <CollapsibleCodeField
                  label="LNURL Payment"
                  value={payment.details.lnurlPayInfo.domain}
                  isVisible={visibleFields.lnurlDomain}
                  onToggle={() => toggleField('lnurlDomain')}
                />
              ) : (
                <PaymentInfoRow
                  label="LNURL Payment"
                  value={payment.details.lnurlPayInfo.domain}
                />
              )
            )}

            {payment.details?.type === 'lightning' && payment.details.lnurlPayInfo?.comment && (
              payment.details.lnurlPayInfo.comment.length > LONG_TEXT_THRESHOLD ? (
                <CollapsibleCodeField
                  label="Comment"
                  value={payment.details.lnurlPayInfo.comment}
                  isVisible={visibleFields.comment}
                  onToggle={() => toggleField('comment')}
                />
              ) : (
                <PaymentInfoRow
                  label="Comment"
                  value={payment.details.lnurlPayInfo.comment}
                />
              )
            )}

            {payment.details?.type === 'lightning' && payment.details.invoice && (
              <CollapsibleCodeField
                label="Invoice"
                value={payment.details.invoice}
                isVisible={visibleFields.invoice}
                onToggle={() => toggleField('invoice')}
              />
            )}

            {payment.details?.type === 'lightning' && payment.details.preimage && (
              <CollapsibleCodeField
                label="Payment Preimage"
                value={payment.details.preimage}
                isVisible={visibleFields.preimage}
                onToggle={() => toggleField('preimage')}
              />
            )}

            {payment.details?.type === 'lightning' && payment.details.destinationPubkey && (
              <CollapsibleCodeField
                label="Destination Public Key"
                value={payment.details.destinationPubkey}
                isVisible={visibleFields.destinationPubkey}
                onToggle={() => toggleField('destinationPubkey')}
              />
            )}

            {payment.details?.type === 'lightning' && payment.details.lnurlPayInfo?.rawSuccessAction && (
              <>
                <PaymentInfoRow
                  label="Success Action"
                  value={payment.details.lnurlPayInfo.rawSuccessAction.type || 'Unknown'}
                />
                {payment.details.lnurlPayInfo.rawSuccessAction.type === 'message' && 
                  payment.details.lnurlPayInfo.rawSuccessAction.data && (
                  (payment.details.lnurlPayInfo.rawSuccessAction.data.message || '').length > LONG_TEXT_THRESHOLD ? (
                    <CollapsibleCodeField
                      label="Message"
                      value={payment.details.lnurlPayInfo.rawSuccessAction.data.message || ''}
                      isVisible={visibleFields.message}
                      onToggle={() => toggleField('message')}
                    />
                  ) : (
                    <PaymentInfoRow
                      label="Message"
                      value={payment.details.lnurlPayInfo.rawSuccessAction.data.message || ''}
                    />
                  )
                )}
                {payment.details.lnurlPayInfo.rawSuccessAction.type === 'url' && 
                  payment.details.lnurlPayInfo.rawSuccessAction.data && (
                  (payment.details.lnurlPayInfo.rawSuccessAction.data.url || '').length > LONG_TEXT_THRESHOLD ? (
                    <CollapsibleCodeField
                      label="URL"
                      value={payment.details.lnurlPayInfo.rawSuccessAction.data.url || ''}
                      isVisible={visibleFields.url}
                      onToggle={() => toggleField('url')}
                    />
                  ) : (
                    <PaymentInfoRow
                      label="URL"
                      value={payment.details.lnurlPayInfo.rawSuccessAction.data.url || ''}
                    />
                  )
                )}
              </>
            )}
            
            {payment.details?.type === 'deposit' && payment.details.txId && (
              <div className="mt-4">
                <CollapsibleCodeField
                  label="Transaction ID"
                  value={payment.details.txId}
                  isVisible={visibleFields.txId}
                  onToggle={() => toggleField('txId')}
                />
              </div>
            )}
            {payment.details?.type === 'withdraw' && payment.details.txId && (
              <div className="mt-4">
                <CollapsibleCodeField
                  label="Transaction ID"
                  value={payment.details.txId}
                  isVisible={visibleFields.txId}
                  onToggle={() => toggleField('txId')}
                />
              </div>
            )}

          </PaymentInfoCard>
        </div>
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default PaymentDetailsDialog;
