import React, { useState } from 'react';
import type { Payment, ConversionSide, TokenMetadata } from '@breeztech/breez-sdk-spark';
import {
  DialogHeader, PaymentInfoCard, PaymentInfoRow,
  CollapsibleCodeField, CollapsibleSection, BottomSheetContainer, BottomSheetCard
} from './ui';
import { formatWithSpaces } from '../utils/formatNumber';
import { useStableBalance } from '../contexts/StableBalanceContext';
import { getTokenAmountFromPayment, formatTokenAmount, buildTokenDisplayConfig } from '../utils/tokenFormatting';
import { useFiatData } from '../contexts/FiatDataContext';
import { useContactsContext } from '../contexts/ContactsContext';
import { getPaymentDescription, getProviderDisplayName, isCrossChainPayment } from '../utils/paymentDescription';
import { capitalizeFirst, getCrossChainDestination, formatReceiveAmount } from '../utils/crossChainFormat';

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
  recipientAddress: false,
});

const PaymentDetailsDialog: React.FC<PaymentDetailsDialogProps> = ({ optionalPayment, onClose }) => {
  // Parent unmounts/remounts this component on payment selection change
  // (`{selectedPayment && <PaymentDetailsDialog ... />}`), so lazy init is
  // sufficient — no reset-in-effect needed.
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>(getDefaultVisibleFields);

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

  // Format a conversion side's amount or fee in its native unit
  // Note: side.amount and side.fee are strings from WASM (u128 serialized as string)
  const formatSideValue = (side: ConversionSide, isFee?: boolean): string => {
    const value = BigInt(isFee ? side.fee : side.amount);
    if (side.asset.ticker === 'BTC') {
      return `₿${formatWithSpaces(Number(value))}`;
    }
    const config = stableBalance.displayConfig ?? buildTokenDisplayConfig(
      { ticker: side.asset.ticker, decimals: side.asset.decimals } as TokenMetadata,
      fiatCurrencies,
    );
    return formatTokenAmount(value, config, isFee ? { fullPrecision: true } : undefined);
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
  const isAmountAdjusted = payment.conversionDetails?.conversions?.some(c => !!c.amountAdjustment) ?? false;
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

  // Cross-chain ("USD Transfer"): surface the destination (recipient address +
  // chain/asset) the funds landed on, instead of leading with the internal
  // BOLT11/spark source leg. Null for all non-cross-chain payments.
  const dest = isCrossChainPayment(payment) ? getCrossChainDestination(payment) : null;

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

            {/* Cross-chain destination — what chain/asset it landed on + recipient */}
            {dest?.deliveredAmount !== undefined && dest.assetDecimals !== undefined && dest.assetTicker && (
              <PaymentInfoRow
                label="Received Amount"
                value={`~${formatReceiveAmount(dest.deliveredAmount, dest.assetDecimals)} ${dest.assetTicker}`}
              />
            )}
            {dest?.chainName && (
              <PaymentInfoRow
                label="Network"
                value={capitalizeFirst(dest.chainName)}
              />
            )}
            {dest?.recipientAddress && (
              <CollapsibleCodeField
                label="Recipient Address"
                value={dest.recipientAddress}
                isVisible={visibleFields.recipientAddress}
                onToggle={() => toggleField('recipientAddress')}
                copyable
              />
            )}

            {/* Description is noise for cross-chain (it's the internal BOLT11 leg) */}
            {!dest && payment.details?.type === 'lightning' && payment.details.description && (
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

            {!dest && payment.details?.type === 'lightning' && payment.details.htlcDetails?.preimage && (
              <CollapsibleCodeField
                label="Payment Preimage"
                value={payment.details.htlcDetails.preimage}
                isVisible={visibleFields.preimage}
                onToggle={() => toggleField('preimage')}
              />
            )}

            {!dest && payment.details?.type === 'lightning' && payment.details.destinationPubkey && (
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
            {(() => {
              const conversions = payment.conversionDetails?.conversions;
              if (!conversions?.length) return null;
              return (
              <CollapsibleSection
                label="Conversion Details"
                isVisible={visibleFields.conversionDetails}
                onToggle={() => toggleField('conversionDetails')}
                bare
              >
                <div className="space-y-3">
                  {conversions.map((conv, i) => {
                    const isCrossChain = conv.provider === 'orchestra' || conv.provider === 'boltz';
                    const fromFee = BigInt(conv.from.fee);
                    const toFee = BigInt(conv.to.fee);
                    const feeSide = isCrossChain ? conv.to : (fromFee > 0n ? conv.from : conv.to);
                    return (
                      <div
                        key={i}
                        className="bg-spark-surface border border-spark-border/50 rounded-lg px-3"
                      >
                        <PaymentInfoRow
                          label="Provider"
                          value={getProviderDisplayName(conv.provider)}
                        />
                        <PaymentInfoRow
                          label="Initial Amount"
                          value={formatSideValue(conv.from)}
                        />
                        <PaymentInfoRow
                          label="Converted Amount"
                          value={formatSideValue(conv.to)}
                        />
                        {(fromFee > 0n || toFee > 0n) && (
                          <PaymentInfoRow label="Fee" value={formatSideValue(feeSide, true)} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </CollapsibleSection>
              );
            })()}

          </PaymentInfoCard>
        </div>
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default PaymentDetailsDialog;
