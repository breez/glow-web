import type { InputType } from '@breeztech/breez-sdk-spark';

/** The on-chain address a destination names. A scanned receive QR is a BIP21 URI, so the address comes out of it. */
export function destinationAddressOf(parsed: InputType | null): string | undefined {
  if (parsed?.type === 'bitcoinAddress') return parsed.address;
  if (parsed?.type !== 'bip21') return undefined;
  return parsed.paymentMethods.flatMap(method => (method.type === 'bitcoinAddress' ? [method.address] : []))[0];
}
