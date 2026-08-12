/**
 * Guard for the drain: a vault that already holds the seed used to make
 * startup return early and leave the legacy copy behind.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Seed } from '@breeztech/breez-sdk-spark';

const vault = vi.hoisted(() => ({ seed: null as Seed | null }));

vi.mock('./secureStorage', () => ({
  deviceOnlyStorage: {
    isSupported: () => true,
    hasStoredSeed: async () => vault.seed !== null,
    retrieveSeed: async () => vault.seed!,
    storeSeed: async (seed: Seed) => { vault.seed = seed; },
  },
}));

import { migrateLegacyMnemonicIfNeeded, getSavedMnemonic, saveMnemonic } from './legacyMnemonicMigration';

const MNEMONIC = 'abandon abandon ability';
const OTHER = 'zoo zoo wrong';

describe('migrateLegacyMnemonicIfNeeded', () => {
  beforeEach(() => {
    vault.seed = null;
    localStorage.clear();
  });

  it('moves the plaintext mnemonic into an empty vault', async () => {
    saveMnemonic(MNEMONIC);
    await migrateLegacyMnemonicIfNeeded();
    expect(vault.seed).toEqual({ type: 'mnemonic', mnemonic: MNEMONIC });
    expect(getSavedMnemonic()).toBeNull();
  });

  it('deletes the plaintext mnemonic when the vault already holds the same seed', async () => {
    vault.seed = { type: 'mnemonic', mnemonic: MNEMONIC };
    saveMnemonic(MNEMONIC);
    await migrateLegacyMnemonicIfNeeded();
    expect(getSavedMnemonic()).toBeNull();
  });

  it('keeps a plaintext mnemonic that differs from the vault seed', async () => {
    vault.seed = { type: 'mnemonic', mnemonic: OTHER };
    saveMnemonic(MNEMONIC);
    await migrateLegacyMnemonicIfNeeded();
    expect(getSavedMnemonic()).toBe(MNEMONIC);
    expect(vault.seed).toEqual({ type: 'mnemonic', mnemonic: OTHER });
  });

  it('treats a vault passphrase as a different wallet', async () => {
    vault.seed = { type: 'mnemonic', mnemonic: MNEMONIC, passphrase: 'x' };
    saveMnemonic(MNEMONIC);
    await migrateLegacyMnemonicIfNeeded();
    expect(getSavedMnemonic()).toBe(MNEMONIC);
  });
});
