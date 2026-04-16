import React, { useState, useEffect } from 'react';
import type { Payment } from '@breeztech/breez-sdk-spark';
import type { ConversionStep } from '@breeztech/breez-sdk-spark';
import {
  DialogHeader, PaymentInfoCard, PaymentInfoRow,
  CollapsibleCodeField, CollapsibleSection, BottomSheetContainer, BottomSheetCard
} from './ui';
import { formatWithSpaces } from '../utils/formatNumber';
import { useStableBalance } from '../contexts/StableBalanceContext';
import { getTokenAmountFromPayment, formatTokenAmount, buildTokenDisplayConfig } from '../utils/tokenFormatting';
import { useFiatData } from '../contexts/FiatDataContext';
import { useContactsContext } from '../contexts/ContactsContext';
import { getPaymentDescription } from '../utils/paymentDescription';

interface PaymentDetailsDialogProps {
  optionalPayment: Payment | null;
  onClose: () => void;
}

// Threshold for when to use collapsible chevron
const LONG_TEXT_THRESHOLD = 35;

const getDefaultVisibleFields = () => ({
  invoice: false,
  preimage: false,
  destinationPubkey: false,
  txId: false,
  description: false,
  comment: false,
  message: false,
  url: false,
  lnAddress: false,
  lnurlDomain: false,
  conversionDetails: false,
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

  const stableBalance = useStableBalance();
  const { fiatCurrencies } = useFiatData();
  const { findContactByAddress } = useContactsContext();

  if (!optionalPayment) return (
    <BottomSheetContainer isOpen={optionalPayment != null} onClose={onClose}>
      <BottomSheetCard>{
        <div></div>}</BottomSheetCard>
    </BottomSheetContainer>

  );
  const payment = optionalPayment!;

  // Format a conversion step's amount or fee in its native unit
  const formatStepValue = (step: ConversionStep, value: bigint, isFee?: boolean): string => {
    if (step.method === 'token' && step.tokenMetadata) {
      const config = stableBalance.displayConfig ?? buildTokenDisplayConfig(step.tokenMetadata, fiatCurrencies);
      return formatTokenAmount(value, config, isFee ? { fullPrecision: true } : undefined);
    }
    return `₿${formatWithSpaces(Number(value))}`;
  };

  // Format a fee value in the payment's native denomination
  const formatPaymentFee = (fee: bigint): string => {
    if (payment.details?.type === 'token') {
      const config = stableBalance.displayConfig ?? buildTokenDisplayConfig(payment.details.metadata, fiatCurrencies);
      return formatTokenAmount(fee, config, { fullPrecision: true });
    }
    return `₿${formatWithSpaces(Number(fee))}`;
  };

  // When the conversion amount was adjusted (min limit floor or dust prevention),
  // the token amount doesn't match the payment — show sats instead.
  const isAmountAdjusted = !!payment.conversionDetails?.from?.amountAdjustment;
  const tokenInfo = getTokenAmountFromPayment(payment);
  const tokenDisplayConfig = stableBalance.displayConfig
    ?? (tokenInfo ? buildTokenDisplayConfig(tokenInfo.metadata, fiatCurrencies) : null);
  const hasTokenDisplay = !isAmountAdjusted && !!tokenInfo && !!tokenDisplayConfig;
  const sign = payment.paymentType === 'receive' ? '+' : '-';
  const amountDisplay = hasTokenDisplay
    ? `${sign} ${formatTokenAmount(tokenInfo.amount, tokenDisplayConfig)}`
    : `${sign} ₿${formatWithSpaces(payment.amount)}`;
  const feeDisplay = payment.fees > 0
    ? (isAmountAdjusted ? `₿${formatWithSpaces(Number(payment.fees))}` : formatPaymentFee(BigInt(payment.fees)))
    : null;

  return (
    <BottomSheetContainer isOpen={optionalPayment != null} onClose={onClose}>
      <BottomSheetCard>
        <DialogHeader title={getPaymentDescription(payment, findContactByAddress, stableBalance.displayConfig?.fiatCurrencyName)} onClose={onClose} />
        <div className="space-y-4 overflow-y-auto">
          {/* General Payment Information */}
          <PaymentInfoCard>
            <PaymentInfoRow
              label="Amount"
              value={amountDisplay}
            />

            {feeDisplay && (
              <PaymentInfoRow
                label="Fee"
                value={feeDisplay}
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

            {payment.details?.type === 'lightning' && (() => {
              const comment = payment.details.lnurlPayInfo?.comment
                ?? payment.details.lnurlReceiveMetadata?.senderComment;
              if (!comment) return null;
              return comment.length > LONG_TEXT_THRESHOLD ? (
                <CollapsibleCodeField
                  label="Comment"
                  value={comment}
                  isVisible={visibleFields.comment}
                  onToggle={() => toggleField('comment')}
                />
              ) : (
                <PaymentInfoRow
                  label="Comment"
                  value={comment}
                />
              );
            })()}

            {payment.details?.type === 'lightning' && payment.details.invoice && (
              <CollapsibleCodeField
                label="Invoice"
                value={payment.details.invoice}
                isVisible={visibleFields.invoice}
                onToggle={() => toggleField('invoice')}
              />
            )}

            {payment.details?.type === 'lightning' && payment.details.htlcDetails?.preimage && (
              <CollapsibleCodeField
                label="Payment Preimage"
                value={payment.details.htlcDetails.preimage}
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
            
            {(payment.details?.type === 'deposit' || payment.details?.type === 'withdraw') && payment.details.txId && (
              <div className="mt-4">
                <CollapsibleCodeField
                  label="Transaction ID"
                  value={payment.details.txId}
                  isVisible={visibleFields.txId}
                  onToggle={() => toggleField('txId')}
                />
              </div>
            )}


            {/* Conversion Details — shows original payment values */}
            {payment.conversionDetails && (
              <CollapsibleSection
                label="Conversion Details"
                isVisible={visibleFields.conversionDetails}
                onToggle={() => toggleField('conversionDetails')}
              >
                {payment.conversionDetails.from && (
                  <PaymentInfoRow
                    label="Initial Amount"
                    value={formatStepValue(payment.conversionDetails.from, payment.conversionDetails.from.amount)}
                  />
                )}
                {payment.conversionDetails.to && (
                  <PaymentInfoRow
                    label="Converted Amount"
                    value={formatStepValue(payment.conversionDetails.to, payment.conversionDetails.to.amount)}
                  />
                )}
                {(() => {
                  // Find the fee from whichever step has it
                  const fromStep = payment.conversionDetails!.from;
                  const toStep = payment.conversionDetails!.to;
                  const fee = fromStep?.fee != null && fromStep.fee > 0n ? fromStep.fee
                    : (toStep?.fee != null && toStep.fee > 0n) ? toStep.fee
                    : null;
                  if (fee != null && fee > 0n) {
                    // Always denominate using the token step when available
                    const tokenStep = fromStep?.method === 'token' ? fromStep
                      : toStep?.method === 'token' ? toStep
                      : null;
                    const feeFormatted = formatStepValue(tokenStep ?? fromStep ?? toStep!, fee, true);
                    return <PaymentInfoRow label="Fee" value={feeFormatted} />;
                  }
                  // Fall back to conversionInfo.fee — denominated in the token side's units
                  const conversionInfoFee = (payment.details?.type === 'spark' || payment.details?.type === 'token')
                    ? payment.details.conversionInfo?.fee : undefined;
                  if (!conversionInfoFee || conversionInfoFee === '0') return null;
                  // Format using the token step metadata if available
                  const tokenStep = fromStep?.method === 'token' ? fromStep
                    : toStep?.method === 'token' ? toStep : null;
                  const feeFormatted = tokenStep?.tokenMetadata
                    ? formatTokenAmount(BigInt(conversionInfoFee),
                        stableBalance.displayConfig ?? buildTokenDisplayConfig(tokenStep.tokenMetadata, fiatCurrencies),
                        { fullPrecision: true })
                    : formatPaymentFee(BigInt(conversionInfoFee));
                  return <PaymentInfoRow label="Fee" value={feeFormatted} />;
                })()}
              </CollapsibleSection>
            )}

          </PaymentInfoCard>
        </div>
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default PaymentDetailsDialog;
