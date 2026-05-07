/**
 * Per-credential passkey metadata (timestamps + hidden list) shared
 * between passkeyService.ts (consumer / writer on create-time and
 * cleanup paths) and passkeyPrfProvider.ts (writer inside the
 * onAssertionCredentialId callback fired on every successful sign-in).
 *
 * Lives in its own module to break the import cycle that would
 * otherwise form between the two: passkeyService imports the
 * passkeyPrfProvider singleton at module init, and passkeyPrfProvider
 * needs `markCredentialUsed` from passkeyService at sign-in time.
 * ESM live-bindings handle the cycle in dev, but Rollup's production
 * inlining can hit a TDZ at module init and break the entire passkey
 * import chain. This file has no upstream imports, so there's no
 * cycle to begin with.
 */

const PASSKEY_CRED_FIRST_SEEN_PREFIX = 'passkeyCredFirstSeenAt:';
const PASSKEY_CRED_LAST_SEEN_PREFIX = 'passkeyCredLastSeenAt:';
const PASSKEY_HIDDEN_KEY = 'passkeyHiddenCredentials';
const PASSKEY_USER_NAME_PREFIX = 'passkeyUserName:';

/**
 * Stamp first-seen (set once) and last-seen (always) for a specific
 * credential ID. Wired into both the create path and the assertion
 * path so the per-cred row in PasskeyManagementPage stays accurate
 * even when the user signs in with a synced cred we never created
 * locally.
 */
export function markCredentialUsed(credentialId: string): void {
  if (!credentialId) return;
  const now = String(Date.now());
  const firstKey = `${PASSKEY_CRED_FIRST_SEEN_PREFIX}${credentialId}`;
  const lastKey = `${PASSKEY_CRED_LAST_SEEN_PREFIX}${credentialId}`;
  if (!localStorage.getItem(firstKey)) {
    localStorage.setItem(firstKey, now);
  }
  localStorage.setItem(lastKey, now);
}

export function getCredentialMeta(credentialId: string): {
  firstSeenAt?: number;
  lastSeenAt?: number;
} {
  const first = localStorage.getItem(`${PASSKEY_CRED_FIRST_SEEN_PREFIX}${credentialId}`);
  const last = localStorage.getItem(`${PASSKEY_CRED_LAST_SEEN_PREFIX}${credentialId}`);
  return {
    firstSeenAt: first ? Number(first) : undefined,
    lastSeenAt: last ? Number(last) : undefined,
  };
}

/** Drop every per-credential first/last-seen entry. */
export function clearAllCredentialMeta(): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PASSKEY_CRED_FIRST_SEEN_PREFIX)
        || key.startsWith(PASSKEY_CRED_LAST_SEEN_PREFIX)) {
      localStorage.removeItem(key);
    }
  }
}

/** Drop per-credential first/last-seen for a single cred. */
export function removeCredentialMeta(credentialId: string): void {
  if (!credentialId) return;
  localStorage.removeItem(`${PASSKEY_CRED_FIRST_SEEN_PREFIX}${credentialId}`);
  localStorage.removeItem(`${PASSKEY_CRED_LAST_SEEN_PREFIX}${credentialId}`);
}

/** Read the user-hidden credential ID list. */
export function getHiddenCredentialIds(): string[] {
  try {
    const raw = localStorage.getItem(PASSKEY_HIDDEN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

export function hideCredential(credentialId: string): void {
  const existing = getHiddenCredentialIds();
  if (existing.includes(credentialId)) return;
  localStorage.setItem(PASSKEY_HIDDEN_KEY, JSON.stringify([...existing, credentialId]));
}

export function unhideCredential(credentialId: string): void {
  const existing = getHiddenCredentialIds();
  if (!existing.includes(credentialId)) return;
  localStorage.setItem(
    PASSKEY_HIDDEN_KEY,
    JSON.stringify(existing.filter((id) => id !== credentialId)),
  );
}

export function clearAllHiddenCredentials(): void {
  localStorage.removeItem(PASSKEY_HIDDEN_KEY);
}

/**
 * Per-credential user.name (the label we passed to
 * navigator.credentials.create as `user.name`, or the value pushed
 * via PublicKeyCredential.signalCurrentUserDetails on a later
 * sign-in). Recorded at the moment we set it, so the management
 * page can render it as the row title when AAGUID isn't known.
 *
 * Synced credentials we never created locally and never renamed
 * here have no entry; the row falls back to a generic "Passkey"
 * label.
 */
export function setCredentialUserName(credentialId: string, userName: string): void {
  if (!credentialId || !userName) return;
  const key = `${PASSKEY_USER_NAME_PREFIX}${credentialId}`;
  if (localStorage.getItem(key) === userName) return;
  localStorage.setItem(key, userName);
}

export function getCredentialUserName(credentialId: string): string | undefined {
  if (!credentialId) return undefined;
  return localStorage.getItem(`${PASSKEY_USER_NAME_PREFIX}${credentialId}`) ?? undefined;
}

export function removeCredentialUserName(credentialId: string): void {
  if (!credentialId) return;
  localStorage.removeItem(`${PASSKEY_USER_NAME_PREFIX}${credentialId}`);
}
