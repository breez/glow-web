import type { SendInput } from '@/types/domain';
import type { LnurlPayRequestDetails, LnurlAuthRequestDetails, LnurlWithdrawRequestDetails, SendPaymentMethod } from '@breeztech/breez-sdk-spark';

/** Who a prepared payment pays, for the confirm step. Read from the prepare
 *  response, not the raw input, so the row shows what the SDK resolved. */
export function getSendDestination(method: SendPaymentMethod): { label: string; value: string } {
  switch (method.type) {
    case 'bitcoinAddress':
      return { label: 'To address', value: method.address.address };
    case 'sparkAddress':
      return { label: 'To Spark address', value: method.address };
    case 'sparkInvoice':
      return { label: 'To Spark invoice', value: method.sparkInvoiceDetails.invoice };
    case 'bolt11Invoice':
      return { label: 'To invoice', value: method.invoiceDetails.invoice.bolt11 };
    case 'crossChainAddress':
      return { label: 'To address', value: method.recipientAddress };
  }
}

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
    case 'lnurlWithdraw':
      // Withdraw pulls funds into this wallet, so the dialog reads as a receive.
      return 'Receive';
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

export function getLnurlWithdrawRequestDetails(input: SendInput | null): LnurlWithdrawRequestDetails | null {
  if (input && input.parsedInput.type === 'lnurlWithdraw') {
    return input.parsedInput;
  }
  return null;
}
