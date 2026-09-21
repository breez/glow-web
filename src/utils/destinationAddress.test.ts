import { describe, expect, it } from 'vitest';
import type { InputType } from '@breeztech/breez-sdk-spark';
import { destinationAddressOf, foreignAddressNetwork, foreignNetworkMessage } from './destinationAddress';

const address = (value: string, network: string): InputType =>
  ({ type: 'bitcoinAddress', address: value, network, source: { type: 'bitcoinAddress' } }) as unknown as InputType;

const bip21 = (value: string, network: string): InputType =>
  ({ type: 'bip21', uri: `bitcoin:${value}`, paymentMethods: [address(value, network)] }) as unknown as InputType;

describe('foreignAddressNetwork', () => {
  it('passes an address on the wallet network', () => {
    expect(foreignAddressNetwork(address('bc1qmainnet', 'bitcoin'), 'mainnet')).toBeUndefined();
    expect(foreignAddressNetwork(address('bcrt1qregtest', 'regtest'), 'regtest')).toBeUndefined();
  });

  it('names the network of an address from another one', () => {
    expect(foreignAddressNetwork(address('tb1qtestnet', 'testnet3'), 'mainnet')).toBe('testnet3');
    expect(foreignAddressNetwork(address('bcrt1qregtest', 'regtest'), 'mainnet')).toBe('regtest');
    expect(foreignAddressNetwork(address('bc1qmainnet', 'bitcoin'), 'regtest')).toBe('bitcoin');
  });

  it('reads the address out of a BIP21 URI', () => {
    expect(foreignAddressNetwork(bip21('tb1qtestnet', 'testnet3'), 'mainnet')).toBe('testnet3');
    expect(destinationAddressOf(bip21('tb1qtestnet', 'testnet3'))).toBe('tb1qtestnet');
  });

  it('passes a destination that names no address', () => {
    expect(foreignAddressNetwork(null, 'mainnet')).toBeUndefined();
    expect(foreignAddressNetwork({ type: 'sparkAddress' } as unknown as InputType, 'mainnet')).toBeUndefined();
  });
});

describe('foreignNetworkMessage', () => {
  it('names both networks', () => {
    expect(foreignNetworkMessage('testnet3', 'mainnet')).toBe(
      'That is a testnet address. Enter a mainnet Bitcoin address.',
    );
    expect(foreignNetworkMessage('bitcoin', 'regtest')).toBe(
      'That is a mainnet address. Enter a regtest Bitcoin address.',
    );
  });
});
