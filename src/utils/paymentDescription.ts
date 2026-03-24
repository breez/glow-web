import type { Payment } from '@breeztech/breez-sdk-spark';

type ContactLookup = (address: string) => { name: string } | undefined;

export function getPaymentDescription(payment: Payment, findContactByAddress?: ContactLookup): string {
  if (payment.method === 'lightning') {
    if (payment.details?.type === 'lightning') {
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
  if (payment.method === 'spark') return 'Spark Transfer';
  if (payment.method === 'deposit') return 'BTC Transfer';
  if (payment.method === 'withdraw') return 'BTC Transfer';
  return 'Payment';
}
