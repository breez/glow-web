import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordMigrationCredentialPair,
  getMigrationCounterpartCredentialIdBytes,
  clearMigrationCredentialPairs,
  bytesToBase64,
} from './passkeyService';

const LEGACY = 'legacy.example';
const SHARED = 'shared.example';

// Credential ids are stored as base64, so use real base64 (the getter decodes it).
const cred = (n: number) => bytesToBase64(new Uint8Array([n, n, n]));
const legacyA = cred(1);
const sharedA = cred(2);
const legacyB = cred(3);
const sharedB = cred(4);

const setActive = (credId: string, rpId: string) => {
  localStorage.setItem('passkeyActiveCredentialId', credId);
  localStorage.setItem('passkeyActiveCredentialRpId', rpId);
};
const counterpart = (targetRp: string) => {
  const bytes = getMigrationCounterpartCredentialIdBytes(targetRp);
  return bytes ? bytesToBase64(bytes) : null;
};

describe('migration credential pairs', () => {
  beforeEach(() => localStorage.clear());

  it('pins the shared counterpart when signed in on the legacy credential', () => {
    recordMigrationCredentialPair(LEGACY, legacyA, SHARED, sharedA);
    setActive(legacyA, LEGACY);
    expect(counterpart(SHARED)).toBe(sharedA);
  });

  it('pins the legacy counterpart when signed in on the shared credential (reverse)', () => {
    recordMigrationCredentialPair(LEGACY, legacyA, SHARED, sharedA);
    setActive(sharedA, SHARED);
    expect(counterpart(LEGACY)).toBe(legacyA);
  });

  it('keeps only the latest destination when the same source is re-migrated', () => {
    recordMigrationCredentialPair(LEGACY, legacyA, SHARED, sharedA);
    recordMigrationCredentialPair(LEGACY, legacyA, SHARED, sharedB);
    setActive(legacyA, LEGACY);
    expect(counterpart(SHARED)).toBe(sharedB);
    // the stale destination no longer reverse-maps
    setActive(sharedA, SHARED);
    expect(counterpart(LEGACY)).toBeNull();
  });

  it('accumulates pairs for distinct source passkeys', () => {
    recordMigrationCredentialPair(LEGACY, legacyA, SHARED, sharedA);
    recordMigrationCredentialPair(LEGACY, legacyB, SHARED, sharedB);
    setActive(legacyA, LEGACY);
    expect(counterpart(SHARED)).toBe(sharedA);
    setActive(legacyB, LEGACY);
    expect(counterpart(SHARED)).toBe(sharedB);
  });

  it('returns null for an active credential with no recorded pair', () => {
    recordMigrationCredentialPair(LEGACY, legacyA, SHARED, sharedA);
    setActive(cred(9), LEGACY);
    expect(counterpart(SHARED)).toBeNull();
  });

  it('ignores a degenerate same-RP pair', () => {
    recordMigrationCredentialPair(LEGACY, legacyA, LEGACY, sharedA);
    setActive(legacyA, LEGACY);
    expect(counterpart(LEGACY)).toBeNull();
  });

  it('clears all pairs', () => {
    recordMigrationCredentialPair(LEGACY, legacyA, SHARED, sharedA);
    clearMigrationCredentialPairs();
    setActive(legacyA, LEGACY);
    expect(counterpart(SHARED)).toBeNull();
  });
});
