import React, { ReactNode, useState } from 'react';
import type { Payment, ConversionSide, TokenMetadata } from '@breeztech/breez-sdk-spark';
import {
  DialogHeader, PaymentInfoCard, PaymentInfoRow,
  CollapsibleCodeField, CollapsibleSection, BottomSheetContainer, BottomSheetCard
} from './ui';
import { SatAmount } from './SatAmount';
import { useStableBalance } from '../contexts/StableBalanceContext';
import { getTokenAmountFromPayment, formatTokenAmount, buildTokenDisplayConfig, withAssetDecimals } from '../utils/tokenFormatting';
import { useFiatData } from '../contexts/FiatDataContext';
import { useContactsContext } from '../contexts/ContactsContext';
import { getPaymentDescription, getProviderDisplayName, isCrossChainPayment } from '../utils/paymentDescription';
import { formatChainName, getCrossChainDestination, formatReceiveAmount } from '../utils/crossChainFormat';
import { explorerTxUrl, chainExplorerTxUrl } from '../utils/explorer';
import { useTranslation } from 'react-i18next';

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
  externalTxHash: false,
});

const PaymentDetailsDialog: React.FC<PaymentDetailsDialogProps> = ({ optionalPayment, onClose }) => {
  const { t } = useTranslation('common');
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
  const formatSideValue = (side: ConversionSide, isFee?: boolean): ReactNode => {
    const value = BigInt(isFee ? side.fee : side.amount);
    if (side.asset.ticker === 'BTC') {
      return <SatAmount sats={Number(value)} />;
    }
    const base = stableBalance.displayConfig ?? buildTokenDisplayConfig(
      { ticker: side.asset.ticker, decimals: side.asset.decimals } as TokenMetadata,
      fiatCurrencies,
    );
    const config = withAssetDecimals(base, side.asset.decimals);
    return formatTokenAmount(value, config, isFee ? { fullPrecision: true } : undefined);
  };

  // Format a fee value in the payment's native denomination
  const formatPaymentFee = (fee: bigint): ReactNode => {
    if (payment.details?.type === 'token') {
      const base = stableBalance.displayConfig ?? buildTokenDisplayConfig(payment.details.metadata, fiatCurrencies);
      const config = withAssetDecimals(base, payment.details.metadata.decimals);
      return formatTokenAmount(fee, config, { fullPrecision: true });
    }
    return <SatAmount sats={Number(fee)} />;
  };

  // When the conversion amount was adjusted (min limit floor or dust prevention),
  // the token amount doesn't match the payment — show sats instead.
  const isAmountAdjusted = payment.conversionDetails?.conversions?.some(c => !!c.amountAdjustment) ?? false;
  const tokenInfo = getTokenAmountFromPayment(payment);
  const baseDisplayConfig = stableBalance.displayConfig
    ?? (tokenInfo ? buildTokenDisplayConfig(tokenInfo.metadata, fiatCurrencies) : null);
  const tokenDisplayConfig = baseDisplayConfig && tokenInfo
    ? withAssetDecimals(baseDisplayConfig, tokenInfo.metadata.decimals)
    : baseDisplayConfig;
  const hasTokenDisplay = !isAmountAdjusted && !!tokenInfo && !!tokenDisplayConfig;
  const isReceive = payment.paymentType === 'receive';
  const sign = isReceive ? '+' : '-';
  const amountDisplay = hasTokenDisplay
    ? `${sign} ${formatTokenAmount(tokenInfo.amount, tokenDisplayConfig)}`
    : <>{sign} <SatAmount sats={payment.amount} /></>;
  const feeDisplay = payment.fees > 0
    ? (isAmountAdjusted ? <SatAmount sats={Number(payment.fees)} /> : formatPaymentFee(BigInt(payment.fees)))
    : null;

  // Cross-chain ("USD Transfer"): surface the external leg. For a send that's
  // the destination (recipient + delivered amount); for a receive it's the
  // source the sender deposited. Null for all non-cross-chain payments.
  const dest = isCrossChainPayment(payment) ? getCrossChainDestination(payment) : null;
  const conversions = payment.conversionDetails?.conversions;

  // Receive: the amount the sender deposited on the external chain (the `from`
  // side of the cross-chain conversion), e.g. "1.00 USDC".
  const crossChainSource = (() => {
    if (!dest || !isReceive) return null;
    const xc = conversions?.find(c => c.provider === 'orchestra' || c.provider === 'boltz');
    if (!xc) return null;
    return `${formatReceiveAmount(BigInt(xc.from.amount), xc.from.asset.decimals)} ${xc.from.asset.ticker}`;
  })();

  // The external leg's own transaction: the payout on the destination chain for
  // a send, the sender's deposit on the source chain for a receive. Absent
  // until that leg broadcasts, and only orchestra reports it.
  const externalTxRow = dest?.externalTxHash ? (
    <CollapsibleCodeField
      label={t('paymentDetails.transactionId')}
      value={dest.externalTxHash}
      isVisible={visibleFields.externalTxHash}
      onToggle={() => toggleField('externalTxHash')}
      href={dest.chainName ? chainExplorerTxUrl(dest.chainName, dest.externalTxHash) : undefined}
    />
  ) : null;

  return (
    <BottomSheetContainer isOpen={optionalPayment != null} onClose={onClose}>
      <BottomSheetCard>
        <DialogHeader title={getPaymentDescription(payment, findContactByAddress, stableBalance.displayConfig?.fiatCurrencyName)} onClose={onClose} />
        <div className="space-y-4 overflow-y-auto">
          {/* General Payment Information */}
          <PaymentInfoCard>
            <PaymentInfoRow
              label={t('paymentDetails.amount')}
              value={amountDisplay}
            />

            {/* Cross-chain fee lives in the Conversion Details dropdown. */}
            {!dest && feeDisplay && (
              <PaymentInfoRow
                label={t('paymentDetails.fee')}
                value={feeDisplay}
              />
            )}

            <PaymentInfoRow
              label={t('paymentDetails.dateTime')}
              value={formatDateTime(payment.timestamp)}
            />

            {/* Cross-chain external leg. Receive: the deposited source amount +
                source network. Send: delivered amount + recipient address. */}
            {dest && isReceive && (
              <>
                {crossChainSource && (
                  <PaymentInfoRow label={t('paymentDetails.sentAmount')} value={crossChainSource} />
                )}
                {dest.chainName && (
                  <PaymentInfoRow label={t('paymentDetails.network')} value={formatChainName(dest.chainName)} />
                )}
                {externalTxRow}
              </>
            )}
            {dest && !isReceive && (
              <>
                {dest.deliveredAmount !== undefined && dest.assetDecimals !== undefined && dest.assetTicker && (
                  <PaymentInfoRow
                    label={t('paymentDetails.receivedAmount')}
                    value={`~${formatReceiveAmount(dest.deliveredAmount, dest.assetDecimals)} ${dest.assetTicker}`}
                  />
                )}
                {dest.chainName && (
                  <PaymentInfoRow label={t('paymentDetails.network')} value={formatChainName(dest.chainName)} />
                )}
                {dest.recipientAddress && (
                  <CollapsibleCodeField
                    label={t('paymentDetails.recipientAddress')}
                    value={dest.recipientAddress}
                    isVisible={visibleFields.recipientAddress}
                    onToggle={() => toggleField('recipientAddress')}
                  />
                )}
                {externalTxRow}
              </>
            )}

            {/* Description is noise for cross-chain (it's the internal BOLT11 leg) */}
            {!dest && payment.details?.type === 'lightning' && payment.details.description && (
              payment.details.description.length > LONG_TEXT_THRESHOLD ? (
                <CollapsibleCodeField
                  label={t('paymentDetails.description')}
                  value={payment.details.description}
                  isVisible={visibleFields.description}
                  onToggle={() => toggleField('description')}
                />
              ) : (
                <PaymentInfoRow
                  label={t('paymentDetails.description')}
                  value={payment.details.description}
                />
              )
            )}

            {payment.details?.type === 'lightning' && payment.details.lnurlPayInfo?.lnAddress && (
              payment.details.lnurlPayInfo.lnAddress.length > LONG_TEXT_THRESHOLD ? (
                <CollapsibleCodeField
                  label={t('paymentDetails.lightningAddress')}
                  value={payment.details.lnurlPayInfo.lnAddress}
                  isVisible={visibleFields.lnAddress}
                  onToggle={() => toggleField('lnAddress')}
                />
              ) : (
                <PaymentInfoRow
                  label={t('paymentDetails.lightningAddress')}
                  value={payment.details.lnurlPayInfo.lnAddress}
                />
              )
            )}

            {payment.details?.type === 'lightning' && payment.details.lnurlPayInfo && !payment.details.lnurlPayInfo.lnAddress && payment.details.lnurlPayInfo.domain && (
              payment.details.lnurlPayInfo.domain.length > LONG_TEXT_THRESHOLD ? (
                <CollapsibleCodeField
                  label={t('paymentDetails.lnurlPayment')}
                  value={payment.details.lnurlPayInfo.domain}
                  isVisible={visibleFields.lnurlDomain}
                  onToggle={() => toggleField('lnurlDomain')}
                />
              ) : (
                <PaymentInfoRow
                  label={t('paymentDetails.lnurlPayment')}
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
                  label={t('paymentDetails.comment')}
                  value={comment}
                  isVisible={visibleFields.comment}
                  onToggle={() => toggleField('comment')}
                />
              ) : (
                <PaymentInfoRow
                  label={t('paymentDetails.comment')}
                  value={comment}
                />
              );
            })()}

            {payment.details?.type === 'lightning' && payment.details.invoice && (
              <CollapsibleCodeField
                label={t('paymentDetails.invoice')}
                value={payment.details.invoice}
                isVisible={visibleFields.invoice}
                onToggle={() => toggleField('invoice')}
              />
            )}

            {!dest && payment.details?.type === 'lightning' && payment.details.htlcDetails?.preimage && (
              <CollapsibleCodeField
                label={t('paymentDetails.preimage')}
                value={payment.details.htlcDetails.preimage}
                isVisible={visibleFields.preimage}
                onToggle={() => toggleField('preimage')}
              />
            )}

            {!dest && payment.details?.type === 'lightning' && payment.details.destinationPubkey && (
              <CollapsibleCodeField
                label={t('paymentDetails.destinationPubkey')}
                value={payment.details.destinationPubkey}
                isVisible={visibleFields.destinationPubkey}
                onToggle={() => toggleField('destinationPubkey')}
              />
            )}

            {payment.details?.type === 'lightning' && payment.details.lnurlPayInfo?.rawSuccessAction && (
              <>
                <PaymentInfoRow
                  label={t('paymentDetails.successAction')}
                  value={payment.details.lnurlPayInfo.rawSuccessAction.type || 'Unknown'}
                />
                {payment.details.lnurlPayInfo.rawSuccessAction.type === 'message' && 
                  payment.details.lnurlPayInfo.rawSuccessAction.data && (
                  (payment.details.lnurlPayInfo.rawSuccessAction.data.message || '').length > LONG_TEXT_THRESHOLD ? (
                    <CollapsibleCodeField
                      label={t('paymentDetails.message')}
                      value={payment.details.lnurlPayInfo.rawSuccessAction.data.message || ''}
                      isVisible={visibleFields.message}
                      onToggle={() => toggleField('message')}
                    />
                  ) : (
                    <PaymentInfoRow
                      label={t('paymentDetails.message')}
                      value={payment.details.lnurlPayInfo.rawSuccessAction.data.message || ''}
                    />
                  )
                )}
                {payment.details.lnurlPayInfo.rawSuccessAction.type === 'url' && 
                  payment.details.lnurlPayInfo.rawSuccessAction.data && (
                  (payment.details.lnurlPayInfo.rawSuccessAction.data.url || '').length > LONG_TEXT_THRESHOLD ? (
                    <CollapsibleCodeField
                      label={t('paymentDetails.url')}
                      value={payment.details.lnurlPayInfo.rawSuccessAction.data.url || ''}
                      isVisible={visibleFields.url}
                      onToggle={() => toggleField('url')}
                    />
                  ) : (
                    <PaymentInfoRow
                      label={t('paymentDetails.url')}
                      value={payment.details.lnurlPayInfo.rawSuccessAction.data.url || ''}
                    />
                  )
                )}
              </>
            )}
            
            {(payment.details?.type === 'deposit' || payment.details?.type === 'withdraw') && payment.details.txId && (
              <div className="mt-4">
                <CollapsibleCodeField
                  label={t('paymentDetails.transactionId')}
                  value={payment.details.txId}
                  isVisible={visibleFields.txId}
                  onToggle={() => toggleField('txId')}
                  href={explorerTxUrl(payment.details.txId)}
                />
              </div>
            )}


            {/* Conversion Details — shows original payment values */}
            {(() => {
              if (!conversions?.length) return null;
              return (
              <CollapsibleSection
                label={t('paymentDetails.conversionDetails')}
                isVisible={visibleFields.conversionDetails}
                onToggle={() => toggleField('conversionDetails')}
                bare
              >
                <div className="space-y-3">
                  {conversions.map((conv, i) => {
                    const fromFee = BigInt(conv.from.fee);
                    const toFee = BigInt(conv.to.fee);
                    // Show the discrete fee from whichever side carries it (the
                    // deposit side for cross-chain, in the source asset).
                    const feeValue = fromFee > 0n || toFee > 0n
                      ? formatSideValue(fromFee > 0n ? conv.from : conv.to, true)
                      : null;
                    return (
                      <div
                        key={i}
                        className="bg-spark-surface border border-spark-border/50 rounded-lg px-3"
                      >
                        <PaymentInfoRow
                          label={t('paymentDetails.provider')}
                          value={getProviderDisplayName(conv.provider)}
                        />
                        <PaymentInfoRow
                          label={t('paymentDetails.initialAmount')}
                          value={formatSideValue(conv.from)}
                        />
                        <PaymentInfoRow
                          label={t('paymentDetails.convertedAmount')}
                          value={formatSideValue(conv.to)}
                        />
                        {feeValue && (
                          <PaymentInfoRow label={t('paymentDetails.fee')} value={feeValue} />
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
