import type { BitcoinAddressDetails, BitcoinNetwork, BreezSdk, InputType, Network } from '@breeztech/breez-sdk-spark';

/** The on-chain address a destination names. A scanned receive QR is a BIP21 URI, so the address comes out of it. */
export function destinationAddressOf(parsed: InputType | null): string | undefined {
  return bitcoinAddressOf(parsed)?.address;
}

function bitcoinAddressOf(parsed: InputType | null): BitcoinAddressDetails | undefined {
  if (parsed?.type === 'bitcoinAddress') return parsed;
  if (parsed?.type !== 'bip21') return undefined;
  return parsed.paymentMethods.flatMap(method => (method.type === 'bitcoinAddress' ? [method] : []))[0];
}

const WALLET_ADDRESSES: Record<Network, BitcoinNetwork> = {
  mainnet: 'bitcoin',
  regtest: 'regtest',
  signet: 'signet',
};

const NETWORK_NAMES: Record<BitcoinNetwork, string> = {
  bitcoin: 'mainnet',
  testnet3: 'testnet',
  testnet4: 'testnet',
  signet: 'signet',
  regtest: 'regtest',
};

/** The network of the address a destination names, when it isn't the wallet's
 *  own. Such an address decodes to a script that is valid here, so a flow that
 *  doesn't check it runs on until the SDK refuses the quote, screens later. */
export function foreignAddressNetwork(parsed: InputType | null, network: Network): BitcoinNetwork | undefined {
  const address = bitcoinAddressOf(parsed);
  if (!address || address.network === WALLET_ADDRESSES[network]) return undefined;
  return address.network;
}

export function foreignNetworkMessage(foreign: BitcoinNetwork, network: Network): string {
  return `That is a ${NETWORK_NAMES[foreign]} address. Enter a ${NETWORK_NAMES[WALLET_ADDRESSES[network]]} Bitcoin address.`;
}

/** A destination that belongs to another Bitcoin network. */
export class ForeignNetworkError extends Error {}

/** Wraps the SDK so a parsed destination always belongs to this wallet's
 *  network. The parser reads any network's address, and one from elsewhere
 *  decodes to a script that is valid here, so a flow that skipped the check
 *  would walk the user on to a payment the SDK refuses at quote time (#450).
 *  Checking on the way out of `parse` covers every flow, including later ones. */
export function withNetworkCheckedParse(client: BreezSdk, network: Network): BreezSdk {
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value !== 'function') return value;
      if (prop !== 'parse') return value.bind(target);
      return async (input: string) => {
        const parsed = (await value.call(target, input)) as InputType;
        const foreign = foreignAddressNetwork(parsed, network);
        if (foreign) throw new ForeignNetworkError(foreignNetworkMessage(foreign, network));
        return parsed;
      };
    },
  });
}

/** The message for a destination the flow could not use: the network mismatch
 *  names itself, anything else falls back to the flow's own wording. */
export function destinationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ForeignNetworkError ? error.message : fallback;
}
