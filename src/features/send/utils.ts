import type { SendInput } from '@/types/domain';
import { isValidLightningAddress } from '@/hooks/useContacts';
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

/** The lightning address an LNURL-pay endpoint belongs to, when there is one.
 *
 *  `address` is populated only when the SDK parsed a `user@domain` input, so a
 *  scanned lnurl1... blob arrives without it and the address has to come from
 *  the LUD-16 `text/identifier` / `text/email` metadata entry the host
 *  publishes. `undefined` means this endpoint is not a lightning address (a
 *  plain tipping LNURL), so callers show the domain and offer no contact. */
export function getLnurlPayAddress(details: LnurlPayRequestDetails): string | undefined {
  if (details.address) return details.address;
  // metadataStr comes from a third-party host, so an unguarded parse here
  // throws during render and takes the whole tree down with it.
  try {
    const entries: unknown = JSON.parse(details.metadataStr);
    if (!Array.isArray(entries)) return undefined;
    for (const entry of entries) {
      if (!Array.isArray(entry)) continue;
      if (entry[0] !== 'text/identifier' && entry[0] !== 'text/email') continue;
      // Validated against the same predicate the contacts form uses, so a
      // recovered identifier is never one contacts would then reject.
      if (typeof entry[1] === 'string' && isValidLightningAddress(entry[1])) return entry[1];
    }
  } catch {
    // Malformed metadata: nothing to recover.
  }
  return undefined;
}

/** The lightning address a destination resolves to, whichever form it was
 *  entered in: typed, `lightning:` prefixed, or a scanned LNURL. One rule for
 *  every caller, so the address the confirm step shows is the one offered as a
 *  contact. `undefined` for destinations that are not lightning addresses. */
export function getSendLightningAddress(input: SendInput | null): string | undefined {
  const parsed = input?.parsedInput;
  if (parsed?.type === 'lightningAddress') return parsed.address;
  if (parsed?.type === 'lnurlPay') return getLnurlPayAddress(parsed);
  return undefined;
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
