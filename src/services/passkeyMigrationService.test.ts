import { describe, it, expect, vi } from 'vitest';
import {
  orderLabelsForMigration,
  assertDifferentWallet,
  isNoCredentialError,
  migrateContacts,
  createMigrationSession,
  transferLightningAddress,
  seedsMatch,
  SharedSeedVerificationError,
} from './passkeyMigrationService';
import { setMigrationSharedCredentialId, clearMigrationSharedCredentialId, buildBrowserPasskeyClient } from './passkeyService';
import type { BreezSdk, Contact, GetInfoResponse, LightningAddressInfo, PasskeyClient, Seed } from '@breeztech/breez-sdk-spark';

vi.mock('./passkeyService', async (importActual) => {
  const actual = await importActual<typeof import('./passkeyService')>();
  return { ...actual, buildBrowserPasskeyClient: vi.fn() };
});

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

describe('transferLightningAddress', () => {
  const lnInfo = { username: 'alice', description: 'desc', lightningAddress: 'alice@x' } as LightningAddressInfo;

  it('returns null when there is no address to move', async () => {
    const from = { getLightningAddress: vi.fn().mockResolvedValue(undefined) } as unknown as BreezSdk;
    const to = { claimLightningAddressTransfer: vi.fn() } as unknown as BreezSdk;

    expect(await transferLightningAddress(from, to, 'pk', 'Default')).toBeNull();
    expect(to.claimLightningAddressTransfer).not.toHaveBeenCalled();
  });

  it('returns null on a successful transfer', async () => {
    const from = {
      getLightningAddress: vi.fn().mockResolvedValue(lnInfo),
      authorizeLightningAddressTransfer: vi.fn().mockResolvedValue({ username: 'alice', pubkey: 'p', signature: 's' }),
    } as unknown as BreezSdk;
    const to = { claimLightningAddressTransfer: vi.fn().mockResolvedValue(lnInfo) } as unknown as BreezSdk;

    expect(await transferLightningAddress(from, to, 'pk', 'Default')).toBeNull();
    expect(to.claimLightningAddressTransfer).toHaveBeenCalled();
  });

  it('returns the failed address when the address exists but the transfer throws', async () => {
    const from = {
      getLightningAddress: vi.fn().mockResolvedValue(lnInfo),
      authorizeLightningAddressTransfer: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as BreezSdk;
    const to = { claimLightningAddressTransfer: vi.fn() } as unknown as BreezSdk;

    expect(await transferLightningAddress(from, to, 'pk', 'Default')).toBe('alice@x');
  });
});

describe('seedsMatch', () => {
  const seed = (mnemonic: string, passphrase?: string): Seed => ({ type: 'mnemonic', mnemonic, passphrase });

  it('matches identical mnemonics and rejects different ones', () => {
    expect(seedsMatch(seed('a b c'), seed('a b c'))).toBe(true);
    expect(seedsMatch(seed('a b c'), seed('x y z'))).toBe(false);
  });

  it('treats a differing passphrase as a different seed', () => {
    expect(seedsMatch(seed('a b c', 'p'), seed('a b c'))).toBe(false);
    expect(seedsMatch(seed('a b c', 'p'), seed('a b c', 'p'))).toBe(true);
  });
});

describe('createMigrationSession.createSharedCredential', () => {
  const seedOf = (mnemonic: string): Seed => ({ type: 'mnemonic', mnemonic });
  const credId = new Uint8Array([9, 9, 9]);

  const mockClient = (registerSeed: Seed, signInSeed: Seed, credentialId: Uint8Array | null = credId) => {
    const client = {
      register: vi.fn().mockResolvedValue({
        wallet: { seed: registerSeed, label: 'Default' },
        labels: [],
        credential: credentialId ? { credentialId } : undefined,
      }),
      signIn: vi.fn().mockResolvedValue({
        wallet: { seed: signInSeed, label: 'Default' },
        labels: [],
        credential: { credentialId },
      }),
    };
    vi.mocked(buildBrowserPasskeyClient).mockReturnValue(client as unknown as PasskeyClient);
    return client;
  };

  it('uses register\'s (already-pinned) seed for the primary label, no extra ceremony', async () => {
    clearMigrationSharedCredentialId();
    const client = mockClient(seedOf('a b c'), seedOf('a b c'));

    const session = createMigrationSession();
    await session.createSharedCredential('Default');

    // register() pins its own internal derive, so create does no verification signIn.
    expect(client.signIn).not.toHaveBeenCalled();
    // The primary label's seed is register's, handed off without a ceremony.
    expect(await session.deriveSharedSeed('Default')).toEqual(seedOf('a b c'));
    expect(client.signIn).not.toHaveBeenCalled();
    clearMigrationSharedCredentialId();
  });

  it('derives a non-primary label via a signIn pinned to the created credential', async () => {
    clearMigrationSharedCredentialId();
    const client = mockClient(seedOf('a b c'), seedOf('x y z'));

    const session = createMigrationSession();
    await session.createSharedCredential('Default');

    // A label other than the primary derives its seed via a pinned signIn.
    expect(await session.deriveSharedSeed('Other')).toEqual(seedOf('x y z'));
    expect(client.signIn).toHaveBeenCalledWith({ label: 'Other', allowCredentials: [credId] });
    clearMigrationSharedCredentialId();
  });

  it('persists the created credential so a retry probes it instead of duplicating', async () => {
    clearMigrationSharedCredentialId();
    mockClient(seedOf('a b c'), seedOf('a b c'));

    const session = createMigrationSession();
    await session.createSharedCredential('Default');
    // hasPriorSharedCredential reads live state, so the same session (or a
    // resumed one) routes a retry to the probe branch, never a second passkey.
    expect(session.hasPriorSharedCredential()).toBe(true);
    clearMigrationSharedCredentialId();
  });

  it('refuses to proceed when the platform reports no credential id', async () => {
    clearMigrationSharedCredentialId();
    const client = mockClient(seedOf('a b c'), seedOf('a b c'), null);

    await expect(createMigrationSession().createSharedCredential('Default'))
      .rejects.toBeInstanceOf(SharedSeedVerificationError);
    expect(client.signIn).not.toHaveBeenCalled();
    clearMigrationSharedCredentialId();
  });
});

describe('createMigrationSession.hasPriorSharedCredential', () => {
  it('is false with nothing recorded, true once a shared credential is persisted', () => {
    clearMigrationSharedCredentialId();
    expect(createMigrationSession().hasPriorSharedCredential()).toBe(false);

    // Persisting a credential id (as createSharedCredential does) makes any later
    // session resume onto it instead of creating a duplicate.
    setMigrationSharedCredentialId(new Uint8Array([1, 2, 3]));
    expect(createMigrationSession().hasPriorSharedCredential()).toBe(true);

    clearMigrationSharedCredentialId();
    expect(createMigrationSession().hasPriorSharedCredential()).toBe(false);
  });
});
