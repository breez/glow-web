import { deriveFundingKey, MnemonicNeedsPasskeyError, MnemonicUnavailableError, readWalletMnemonic } from './funding';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInPinnedToActiveCredential } from '@/services/passkeyService';

vi.mock('@/services/secureStorage', () => ({
  deviceOnlyStorage: { isSupported: () => false, hasStoredSeed: async () => false },
  secureStorage: { isSupported: () => false, hasStoredSeed: async () => false },
}));

vi.mock('@/services/passkeyService', () => ({
  isPasskeyMode: () => localStorage.getItem('passkeyLabel') !== null,
  getPasskeyLabel: () => localStorage.getItem('passkeyLabel'),
  signInPinnedToActiveCredential: vi.fn(),
}));

const VECTOR_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('deriveFundingKey', () => {
  it('derives the first BIP84 mainnet address of the reference mnemonic', () => {
    const key = deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 0);
    expect(key.address).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    expect(key.publicKeyHex).toBe(
      '0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c',
    );
  });

  it('derives the second address of the same account', () => {
    const key = deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 1);
    expect(key.address).toBe('bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g');
    expect(key.publicKeyHex).toBe(
      '03e775fd51f0dfb8cd865d9ff1cca2a158cf651fe997fdc9fee9c1d3b5e995ea77',
    );
  });

  it('returns a 32 byte secret key', () => {
    expect(deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 0).secretKey).toHaveLength(32);
  });

  it('uses the testnet coin type and prefix on testnet', () => {
    const key = deriveFundingKey(VECTOR_MNEMONIC, 'testnet', 0);
    expect(key.address.startsWith('tb1q')).toBe(true);
  });

  it('uses the regtest prefix on regtest', () => {
    const key = deriveFundingKey(VECTOR_MNEMONIC, 'regtest', 0);
    expect(key.address.startsWith('bcrt1q')).toBe(true);
  });

  it('gives testnet and mainnet different keys', () => {
    const mainnet = deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 0);
    const testnet = deriveFundingKey(VECTOR_MNEMONIC, 'testnet', 0);
    expect(testnet.publicKeyHex).not.toBe(mainnet.publicKeyHex);
  });

  it('gives every index its own address', () => {
    const first = deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 0);
    const second = deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 1);
    expect(second.address).not.toBe(first.address);
  });

  it('is deterministic for the same inputs', () => {
    expect(deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 3)).toEqual(
      deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 3),
    );
  });

  it('rejects a mnemonic that is not valid', () => {
    expect(() => deriveFundingKey('not a real mnemonic at all', 'mainnet', 0)).toThrow();
  });
});

describe('readWalletMnemonic', () => {
  const signIn = vi.mocked(signInPinnedToActiveCredential);

  beforeEach(() => {
    localStorage.clear();
    signIn.mockReset();
  });

  afterEach(() => localStorage.clear());

  it('uses the phrase this device already holds', async () => {
    localStorage.setItem('walletMnemonic', VECTOR_MNEMONIC);
    await expect(readWalletMnemonic()).resolves.toBe(VECTOR_MNEMONIC);
    expect(signIn).not.toHaveBeenCalled();
  });

  it('says the phrase is gone when nothing can produce it', async () => {
    const read = readWalletMnemonic({ interactive: true });
    await expect(read).rejects.toThrow(MnemonicUnavailableError);
    await expect(read).rejects.toThrow("This wallet's recovery phrase is not on this device.");
  });

  it('derives it through the passkey when the user is there to sign in', async () => {
    localStorage.setItem('passkeyLabel', 'Default');
    signIn.mockResolvedValue({
      wallet: { seed: { type: 'mnemonic', mnemonic: VECTOR_MNEMONIC }, label: 'Default' },
    } as never);
    await expect(readWalletMnemonic({ interactive: true })).resolves.toBe(VECTOR_MNEMONIC);
    expect(signIn).toHaveBeenCalledWith('Default');
  });

  it('never asks for a passkey on a background pass', async () => {
    localStorage.setItem('passkeyLabel', 'Default');
    await expect(readWalletMnemonic()).rejects.toThrow(MnemonicNeedsPasskeyError);
    expect(signIn).not.toHaveBeenCalled();
  });

  it('prefers the stored phrase over a passkey ceremony', async () => {
    localStorage.setItem('passkeyLabel', 'Default');
    localStorage.setItem('walletMnemonic', VECTOR_MNEMONIC);
    await expect(readWalletMnemonic({ interactive: true })).resolves.toBe(VECTOR_MNEMONIC);
    expect(signIn).not.toHaveBeenCalled();
  });
});
