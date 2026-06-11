import type { SendInput } from '@/types/domain';
import type { LnurlPayRequestDetails, LnurlAuthRequestDetails } from '@breeztech/breez-sdk-spark';

export function getPaymentMethodName(input: SendInput | null): string {
  if (!input) return '';
  switch (input.parsedInput.type) {
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
    case 'lnurlAuth':
      return 'LNURL Auth';
    case 'crossChainAddress':
      return 'Send USD';
    default:
      return 'Payment';
  }
}

export function getLnurlPayRequestDetails(input: SendInput | null): LnurlPayRequestDetails | null {
  if (input && input.parsedInput.type === 'lnurlPay') {
    return input.parsedInput;
  }
  if (input && input.parsedInput.type === 'lightningAddress') {
    return input.parsedInput.payRequest;
  }
  return null;
}

export function getLnurlAuthRequestDetails(input: SendInput | null): LnurlAuthRequestDetails | null {
  if (input && input.parsedInput.type === 'lnurlAuth') {
    return input.parsedInput;
  }
  return null;
}
