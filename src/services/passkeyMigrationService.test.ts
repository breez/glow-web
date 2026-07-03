import { describe, it, expect, vi } from 'vitest';
import {
  orderLabelsForMigration,
  assertDifferentWallet,
  isNoCredentialError,
  migrateContacts,
  createMigrationSession,
} from './passkeyMigrationService';
import { setMigrationRorCredentialId, clearMigrationRorCredentialId } from './passkeyService';
import type { BreezSdk, Contact, GetInfoResponse } from '@breeztech/breez-sdk-spark';

const infoWithPubkey = (identityPubkey: string): GetInfoResponse =>
  ({
    identityPubkey,
    balanceSats: 0,
    tokenBalances: new Map(),
  }) as GetInfoResponse;

const contact = (name: string, paymentIdentifier: string): Contact =>
  ({ id: name, name, paymentIdentifier, createdAt: 0, updatedAt: 0 });

describe('orderLabelsForMigration', () => {
  it('moves the stored label (primary) to last, keeping others in order', () => {
    expect(orderLabelsForMigration(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a']);
  });

  it('keeps relative order of others when stored label is in the middle', () => {
    expect(orderLabelsForMigration(['a', 'b', 'c'], 'b')).toEqual(['a', 'c', 'b']);
  });

  it("falls back to 'Default' as primary when stored label is absent", () => {
    expect(orderLabelsForMigration(['a', 'Default', 'b'], 'missing')).toEqual(['a', 'b', 'Default']);
  });

  it("uses the last array element as primary when neither stored label nor 'Default' is present", () => {
    expect(orderLabelsForMigration(['a', 'b', 'c'], 'missing')).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for an empty input', () => {
    expect(orderLabelsForMigration([], 'a')).toEqual([]);
  });

  it('returns a single label unchanged', () => {
    expect(orderLabelsForMigration(['only'], 'only')).toEqual(['only']);
    expect(orderLabelsForMigration(['only'], 'missing')).toEqual(['only']);
  });

  it('prefers the stored label over Default when both are present', () => {
    expect(orderLabelsForMigration(['a', 'Default', 'b'], 'a')).toEqual(['Default', 'b', 'a']);
  });
});

describe('assertDifferentWallet', () => {
  it('throws when the new wallet has the same identity pubkey as the old one', () => {
    expect(() => assertDifferentWallet(infoWithPubkey('same'), infoWithPubkey('same'), 'Default')).toThrow(
      'Migration target for label "Default" is the same wallet, aborting.',
    );
  });

  it('does not throw when the identity pubkeys differ', () => {
    expect(() => assertDifferentWallet(infoWithPubkey('old'), infoWithPubkey('new'), 'Default')).not.toThrow();
  });
});

describe('isNoCredentialError', () => {
  it('is true for the native CREDENTIAL_NOT_FOUND code', () => {
    expect(isNoCredentialError({ code: 'CREDENTIAL_NOT_FOUND' })).toBe(true);
  });

  it('is true for known no-credential messages', () => {
    expect(isNoCredentialError(new Error('Credential not found'))).toBe(true);
    expect(isNoCredentialError(new Error('There are no credentials available'))).toBe(true);
    expect(isNoCredentialError(new Error('empty allowCredentials'))).toBe(true);
  });

  it('is false for transient / cancel / timeout errors (web NotAllowedError)', () => {
    expect(isNoCredentialError(new Error('The operation either timed out or was not allowed'))).toBe(false);
    expect(isNoCredentialError(new Error('The operation was cancelled'))).toBe(false);
    expect(isNoCredentialError(null)).toBe(false);
    expect(isNoCredentialError(undefined)).toBe(false);
  });
});

describe('migrateContacts', () => {
  it('skips contacts already present on the destination (idempotent across retries)', async () => {
    const from = {
      listContacts: vi.fn().mockResolvedValue([
        contact('Alice', 'alice@example.com'),
        contact('Bob', 'bob@example.com'),
      ]),
    } as unknown as BreezSdk;
    const added: string[] = [];
    const to = {
      // Already holds Alice under a case/whitespace variant: only Bob is new.
      listContacts: vi.fn().mockResolvedValue([contact('Alice', '  Alice@Example.com ')]),
      addContact: vi.fn().mockImplementation(async ({ paymentIdentifier }: { paymentIdentifier: string }) => {
        added.push(paymentIdentifier);
        return contact('x', paymentIdentifier);
      }),
    } as unknown as BreezSdk;

    await migrateContacts(from, to, 'Default');

    expect(added).toEqual(['bob@example.com']);
  });

  it('does not add anything when the source list cannot be read', async () => {
    const from = { listContacts: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as BreezSdk;
    const to = { listContacts: vi.fn(), addContact: vi.fn() } as unknown as BreezSdk;

    await expect(migrateContacts(from, to, 'Default')).resolves.toBeUndefined();
    expect(to.addContact).not.toHaveBeenCalled();
  });
});

describe('createMigrationSession.hasPriorRorCredential', () => {
  it('is false with nothing recorded, true once a ROR credential is persisted', () => {
    clearMigrationRorCredentialId();
    expect(createMigrationSession().hasPriorRorCredential()).toBe(false);

    // Persisting a credential id (as createRorCredential does) makes any later
    // session resume onto it instead of creating a duplicate.
    setMigrationRorCredentialId(new Uint8Array([1, 2, 3]));
    expect(createMigrationSession().hasPriorRorCredential()).toBe(true);

    clearMigrationRorCredentialId();
    expect(createMigrationSession().hasPriorRorCredential()).toBe(false);
  });
});
