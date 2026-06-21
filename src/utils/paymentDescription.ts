import type { Payment, PaymentDetails } from '@breeztech/breez-sdk-spark';

type ContactLookup = (address: string) => { name: string } | undefined;

/** Strip token-specific suffix from ticker for display (e.g. "USDB" → "USD") */
const TICKER_DISPLAY_OVERRIDES: Record<string, string> = { USDB: 'USD' };

/** Map provider IDs to display names (only overrides, otherwise capitalize) */
const PROVIDER_OVERRIDES: Record<string, string> = {
  amm: 'Flashnet',
  orchestra: 'Flashnet',
};

export const getProviderDisplayName = (provider: string): string =>
  PROVIDER_OVERRIDES[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
const tickerToDisplayName = (ticker: string): string =>
  TICKER_DISPLAY_OVERRIDES[ticker] ?? ticker;

/** Extract conversionInfo from payment details if present */
const getConversionInfo = (details?: PaymentDetails) => {
  if (!details || !('conversionInfo' in details)) return null;
  return details.conversionInfo ?? null;
};

const isCrossChain = (convInfo: ReturnType<typeof getConversionInfo>) =>
  convInfo?.type === 'orchestra' || convInfo?.type === 'boltz';

/** Whether a payment is a cross-chain transfer (orchestra/boltz), not an AMM conversion. */
export const isCrossChainPayment = (payment: Payment): boolean =>
  isCrossChain(getConversionInfo(payment.details));

/** Truncate text to maxLen characters, appending "..." if shortened */
const truncate = (text: string, maxLen: number): string =>
  text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;

export function getPaymentDescription(payment: Payment, findContactByAddress?: ContactLookup, fiatCurrencyName?: string | null): string {
  const convInfo = getConversionInfo(payment.details);

  if (payment.method === 'lightning') {
    if (isCrossChain(convInfo)) return 'USD Transfer';
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
    if (isCrossChain(convInfo)) return 'USD Transfer';
    if (convInfo) {
      const dir = payment.paymentType === 'send' ? 'from' : 'to';
      return `Conversion ${dir} Bitcoin`;
    }
    return 'Spark Transfer';
  }
  if (payment.method === 'token') {
    const ticker = payment.details?.type === 'token' ? payment.details.metadata.ticker : null;
    const displayName = (ticker ? tickerToDisplayName(ticker) : null) || fiatCurrencyName;
    if (isCrossChain(convInfo)) return displayName ? `${displayName} Transfer` : 'Token Transfer';
    if (convInfo) {
      const dir = payment.paymentType === 'send' ? 'from' : 'to';
      return `Conversion ${dir} ${displayName}`;
    }
    return displayName ? `${displayName} Transfer` : 'Token Transfer';
  }
  if (payment.method === 'deposit') return 'BTC Transfer';
  if (payment.method === 'withdraw') return 'BTC Transfer';
  return 'Payment';
}
