import type { Payment, PaymentDetails } from '@breeztech/breez-sdk-spark';

type ContactLookup = (address: string) => { name: string } | undefined;

/** Strip token-specific suffix from ticker for display (e.g. "USDB" → "USD") */
const TICKER_DISPLAY_OVERRIDES: Record<string, string> = { USDB: 'USD' };
const tickerToDisplayName = (ticker: string): string =>
  TICKER_DISPLAY_OVERRIDES[ticker] ?? ticker;

/** Check if payment details have conversionInfo */
const hasConversionInfo = (details?: PaymentDetails): boolean =>
  !!details && 'conversionInfo' in details && details.conversionInfo != null;

/** Truncate text to maxLen characters, appending "..." if shortened */
const truncate = (text: string, maxLen: number): string =>
  text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;

export function getPaymentDescription(payment: Payment, findContactByAddress?: ContactLookup, fiatCurrencyName?: string | null): string {
  if (payment.method === 'lightning') {
    if (payment.details?.type === 'lightning') {
      const comment = payment.details.lnurlPayInfo?.comment
        ?? payment.details.lnurlReceiveMetadata?.senderComment;
      if (comment) return truncate(comment, 50);
      if (payment.details.lnurlPayInfo?.lnAddress) {
        const contact = findContactByAddress?.(payment.details.lnurlPayInfo.lnAddress);
        const isSend = payment.paymentType === 'send';
        if (contact) return isSend ? `Pay to ${contact.name}` : contact.name;
        return isSend ? `Pay to ${payment.details.lnurlPayInfo.lnAddress}` : payment.details.lnurlPayInfo.lnAddress;
      }
      return payment.details?.description || 'Lightning Payment';
    }
    return 'Lightning Payment';
  }
  if (payment.method === 'spark') {
    if (hasConversionInfo(payment.details)) {
      const dir = payment.paymentType === 'send' ? 'from' : 'to';
      return `Conversion ${dir} Bitcoin`;
    }
    return 'Spark Transfer';
  }
  if (payment.method === 'token') {
    const ticker = payment.details?.type === 'token' ? payment.details.metadata.ticker : null;
    const displayName = (ticker ? tickerToDisplayName(ticker) : null) || fiatCurrencyName;
    if (hasConversionInfo(payment.details)) {
      const dir = payment.paymentType === 'send' ? 'from' : 'to';
      return `Conversion ${dir} ${displayName}`;
    }
    return displayName ? `${displayName} Transfer` : 'Token Transfer';
  }
  if (payment.method === 'deposit') return 'BTC Transfer';
  if (payment.method === 'withdraw') return 'BTC Transfer';
  return 'Payment';
}
