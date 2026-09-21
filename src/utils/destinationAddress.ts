import type { BitcoinAddressDetails, BitcoinNetwork, InputType, Network } from '@breeztech/breez-sdk-spark';

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
