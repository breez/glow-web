import { describe, expect, it } from 'vitest';
import type { InputType } from '@breeztech/breez-sdk-spark';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import {
  ForeignNetworkError,
  destinationAddressOf,
  foreignAddressNetwork,
  foreignNetworkMessage,
  withNetworkCheckedParse,
} from './destinationAddress';

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

describe('withNetworkCheckedParse', () => {
  const client = (parsed: InputType) =>
    ({
      parse: async () => parsed,
      getInfo: async () => ({ balanceSats: 7 }),
    }) as unknown as BreezSdk;

  it('refuses a destination from another network', async () => {
    const wallet = withNetworkCheckedParse(client(address('tb1qtestnet', 'testnet3')), 'mainnet');
    await expect(wallet.parse('tb1qtestnet')).rejects.toBeInstanceOf(ForeignNetworkError);
    await expect(wallet.parse('tb1qtestnet')).rejects.toThrow(
      'That is a testnet address. Enter a mainnet Bitcoin address.',
    );
  });

  it('passes everything else through', async () => {
    const wallet = withNetworkCheckedParse(client(address('bc1qmainnet', 'bitcoin')), 'mainnet');
    expect(await wallet.parse('bc1qmainnet')).toMatchObject({ address: 'bc1qmainnet' });
    expect(await wallet.getInfo({})).toMatchObject({ balanceSats: 7 });
  });
});

describe('destinationAddressOf', () => {
  const address = { type: 'bitcoinAddress', address: 'bcrt1qdest', network: 'regtest', source: {} } as const;

  it('takes a plain address as it is', () => {
    expect(destinationAddressOf(address as never)).toBe('bcrt1qdest');
  });

  it('takes the address out of a scanned bitcoin: URI', () => {
    const uri = { type: 'bip21', uri: 'bitcoin:bcrt1qdest?amount=1', extras: [], paymentMethods: [address] };
    expect(destinationAddressOf(uri as never)).toBe('bcrt1qdest');
  });

  it('refuses anything that names no on-chain address', () => {
    expect(destinationAddressOf({ type: 'bip21', uri: 'bitcoin:?lightning=lnbc1', extras: [], paymentMethods: [] } as never)).toBeUndefined();
    expect(destinationAddressOf(null)).toBeUndefined();
  });
});
