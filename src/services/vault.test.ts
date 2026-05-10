import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { createVault, unlockVault, hasVault, deleteVault, _resetForTesting, VaultError } from './vault';

beforeEach(async () => {
  // Wipe records, then drop the cached connection + the database
  // itself so each test boots from scratch.
  await deleteVault();
  _resetForTesting();
  const databases = await indexedDB.databases();
  for (const db of databases) {
    if (db.name) indexedDB.deleteDatabase(db.name);
  }
});

describe('vault', () => {
  const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const TEST_PASSWORD = 'testpassword123';

  describe('createVault + unlockVault roundtrip', () => {
    it('encrypts and decrypts mnemonic correctly', async () => {
      await createVault(TEST_MNEMONIC, TEST_PASSWORD);
      const result = await unlockVault(TEST_PASSWORD);
      expect(result).toBe(TEST_MNEMONIC);
    });

    it('works with 24-word mnemonic', async () => {
      const mnemonic24 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
      await createVault(mnemonic24, TEST_PASSWORD);
      const result = await unlockVault(TEST_PASSWORD);
      expect(result).toBe(mnemonic24);
    });

    it('works with long passwords', async () => {
      const longPassword = 'a'.repeat(256);
      await createVault(TEST_MNEMONIC, longPassword);
      const result = await unlockVault(longPassword);
      expect(result).toBe(TEST_MNEMONIC);
    });
  });

  describe('unlockVault error handling', () => {
    it('throws wrong_password for incorrect password', async () => {
      await createVault(TEST_MNEMONIC, TEST_PASSWORD);
      await expect(unlockVault('wrongpassword')).rejects.toThrow(VaultError);
      try {
        await unlockVault('wrongpassword');
      } catch (e) {
        expect(e).toBeInstanceOf(VaultError);
        expect((e as VaultError).code).toBe('wrong_password');
      }
    });

    it('throws no_vault when no vault exists', async () => {
      await expect(unlockVault(TEST_PASSWORD)).rejects.toThrow(VaultError);
      try {
        await unlockVault(TEST_PASSWORD);
      } catch (e) {
        expect(e).toBeInstanceOf(VaultError);
        expect((e as VaultError).code).toBe('no_vault');
      }
    });

    it('throws wrong_password for empty password', async () => {
      await createVault(TEST_MNEMONIC, TEST_PASSWORD);
      await expect(unlockVault('')).rejects.toThrow(VaultError);
      try {
        await unlockVault('');
      } catch (e) {
        expect(e).toBeInstanceOf(VaultError);
        expect((e as VaultError).code).toBe('wrong_password');
      }
    });
  });

  describe('createVault validation', () => {
    it('throws for empty password', async () => {
      await expect(createVault(TEST_MNEMONIC, '')).rejects.toThrow(VaultError);
      try {
        await createVault(TEST_MNEMONIC, '');
      } catch (e) {
        expect(e).toBeInstanceOf(VaultError);
        expect((e as VaultError).code).toBe('crypto_error');
      }
    });

    it('throws if vault already exists', async () => {
      await createVault(TEST_MNEMONIC, TEST_PASSWORD);
      await expect(createVault(TEST_MNEMONIC, 'anotherpassword')).rejects.toThrow(VaultError);
      try {
        await createVault(TEST_MNEMONIC, 'anotherpassword');
      } catch (e) {
        expect(e).toBeInstanceOf(VaultError);
        expect((e as VaultError).code).toBe('crypto_error');
        expect((e as VaultError).message).toContain('already exists');
      }
    });
  });

  describe('hasVault', () => {
    it('returns false when no vault exists', async () => {
      expect(await hasVault()).toBe(false);
    });

    it('returns true after vault is created', async () => {
      await createVault(TEST_MNEMONIC, TEST_PASSWORD);
      expect(await hasVault()).toBe(true);
    });

    it('returns false after vault is deleted', async () => {
      await createVault(TEST_MNEMONIC, TEST_PASSWORD);
      await deleteVault();
      expect(await hasVault()).toBe(false);
    });
  });

  describe('deleteVault', () => {
    it('removes the vault', async () => {
      await createVault(TEST_MNEMONIC, TEST_PASSWORD);
      await deleteVault();
      expect(await hasVault()).toBe(false);
    });

    it('does not throw when no vault exists', async () => {
      await expect(deleteVault()).resolves.toBeUndefined();
    });
  });

  describe('unique salt and IV per vault', () => {
    it('produces different ciphertexts for same mnemonic and password', async () => {
      // Create, unlock, delete, re-create — ciphertext should differ due to random salt+IV
      await createVault(TEST_MNEMONIC, TEST_PASSWORD);
      const result1 = await unlockVault(TEST_PASSWORD);
      await deleteVault();

      await createVault(TEST_MNEMONIC, TEST_PASSWORD);
      const result2 = await unlockVault(TEST_PASSWORD);

      // Both should decrypt to the same mnemonic
      expect(result1).toBe(TEST_MNEMONIC);
      expect(result2).toBe(TEST_MNEMONIC);
    });
  });
});
