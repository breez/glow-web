/**
 * Passkey service. Dispatches to the SDK's `PasskeyClient` directly
 * on web or to the native plugin (which owns its own `PasskeyClient`
 * inside the iOS / Android binary) via the shared `PasskeyApi` shape.
 * Plus the host-side localStorage bookkeeping the SDK doesn't model.
 */

import {
  PasskeyClient,
  type PasskeyAvailability,
  type PasskeyCredential,
  type RegisterRequest,
  type RegisterResponse,
  type SignInRequest,
  type SignInResponse,
  type Wallet,
} from '@breeztech/breez-sdk-spark';
import {
  PasskeyAlreadyExistsError,
  PasskeyCredentialNotFoundError,
  PasskeyProvider,
  PasskeyTimedOutError,
} from '@breeztech/breez-sdk-spark/passkey-prf-provider';
import { Capacitor } from '@capacitor/core';
import { LocalStorageCredentialRegistry } from './localStorageCredentialRegistry';
import { rpId, rpName, signalUnknownCredentials } from './passkeyPrfProvider';
import { logger, LogCategory } from './logger';
import {
  clearAllCredentialMeta,
  clearAllHiddenCredentials,
  markCredentialUsed,
  setCredentialUserName,
  unhideCredential,
  removeCredentialMeta,
  removeCredentialUserName,
} from './passkeyMetadata';

export {
  markCredentialUsed,
  getCredentialMeta,
  clearAllCredentialMeta,
  getHiddenCredentialIds,
  hideCredential,
  unhideCredential,
  clearAllHiddenCredentials,
  setCredentialUserName,
  getCredentialUserName,
} from './passkeyMetadata';

const PASSKEY_LABEL_KEY = 'passkeyLabel';
const PASSKEY_REGISTERED_KEY = 'passkeyRegistered';
const PASSKEY_AAGUID_PREFIX = 'passkeyAaguid:';
const PASSKEY_BE_PREFIX = 'passkeyBackupEligible:';
const PASSKEY_PENDING_SWITCH_FROM_KEY = 'passkeyPendingSwitchFromCredentialId';
const PASSKEY_FIRST_SEEN_KEY = 'passkeyFirstSeenAt';
const PASSKEY_LAST_SEEN_KEY = 'passkeyLastSeenAt';
const PASSKEY_LABEL_LAST_USED_PREFIX = 'passkeyLabelLastUsed:';

// ---------- PasskeyApi ----------

/**
 * Adds `userName` / `userDisplayName` so callers can rotate the
 * WebAuthn `user.name` per create (Apple Passwords dedupes by
 * `(rpId, user.name)`).
 */
export interface PasskeyRegisterRequest extends RegisterRequest {
  userName?: string;
  userDisplayName?: string;
}

/** Mobile-only; SDK doesn't surface `connectWithPasskey` on web. */
export interface ConnectWithPasskeyRequest {
  label?: string;
  excludeCredentials?: Uint8Array[];
  userName?: string;
  userDisplayName?: string;
}

export interface ConnectWithPasskeyResponse {
  wallet: Wallet;
  registeredCredential: PasskeyCredential | null;
}

export interface PasskeyApi {
  checkAvailability(): Promise<PasskeyAvailability>;
  register(request: PasskeyRegisterRequest): Promise<RegisterResponse>;
  signIn(request: SignInRequest): Promise<SignInResponse>;
  /** Native only. Undefined on web (WebAuthn collapses no-cred + cancel). */
  connectWithPasskey?(request: ConnectWithPasskeyRequest): Promise<ConnectWithPasskeyResponse>;
  labels(): { list(): Promise<string[]>; store(label: string): Promise<void> };
  credentials(): {
    get(): Promise<Uint8Array[]>;
    remove(credentialId: Uint8Array): Promise<void>;
    clear(): Promise<void>;
  };
}

// ---------- byte helpers ----------

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------- native impl ----------

interface NativePluginWalletJson {
  seed: { type: 'mnemonic'; mnemonic: string; passphrase: string | null }
      | { type: 'entropy'; entropy: string };
  label: string;
}

interface NativePluginCredentialJson {
  credentialId: string;
  userId: string;
  aaguid: string | null;
  backupEligible: boolean | null;
}

interface NativePasskeyPlugin {
  initialize(opts: {
    rpId: string;
    rpName: string;
    userName?: string;
    userDisplayName?: string;
    breezApiKey?: string;
    defaultLabel?: string;
  }): Promise<void>;
  checkAvailability(): Promise<PasskeyAvailability>;
  register(opts: {
    label?: string;
    excludeCredentials?: string[];
  }): Promise<{ wallet: NativePluginWalletJson; credential: NativePluginCredentialJson }>;
  signIn(opts: {
    label?: string;
    allowCredentials?: string[];
    preferImmediatelyAvailableCredentials?: boolean;
  }): Promise<{ wallet: NativePluginWalletJson; labels: string[]; credentialId: string | null }>;
  connectWithPasskey(opts: {
    label?: string;
    excludeCredentials?: string[];
  }): Promise<{ wallet: NativePluginWalletJson; registeredCredential: NativePluginCredentialJson | null }>;
  listLabels(): Promise<{ labels: string[] }>;
  storeLabel(opts: { label: string }): Promise<void>;
  getKnownCredentialIds(): Promise<{ credentialIds: string[] }>;
  removeKnownCredentialId(opts: { credentialId: string }): Promise<void>;
  clearKnownCredentialIds(): Promise<void>;
}

declare global {
  interface Window {
    Capacitor?: {
      Plugins?: { Passkey?: NativePasskeyPlugin };
    };
  }
}

function decodeWallet(json: NativePluginWalletJson): Wallet {
  if (json.seed.type === 'mnemonic') {
    return {
      seed: {
        type: 'mnemonic',
        mnemonic: json.seed.mnemonic,
        passphrase: json.seed.passphrase ?? undefined,
      },
      label: json.label,
    };
  }
  // Passkey-derived wallets are always mnemonic.
  throw new Error('Unexpected entropy seed from passkey path');
}

function decodeCredential(json: NativePluginCredentialJson): PasskeyCredential {
  return {
    credentialId: base64ToBytes(json.credentialId),
    userId: base64ToBytes(json.userId),
    aaguid: json.aaguid ? base64ToBytes(json.aaguid) : undefined,
    backupEligible: json.backupEligible ?? undefined,
  };
}

/**
 * Map plugin `error.code` strings to the SDK's typed Error subclasses
 * so `instanceof` branches fire on native the same way as on web.
 */
function rethrowAsTyped(e: unknown): never {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  switch (code) {
    case 'CREDENTIAL_ALREADY_EXISTS': throw new PasskeyAlreadyExistsError(message);
    case 'CREDENTIAL_NOT_FOUND': throw new PasskeyCredentialNotFoundError(message);
    case 'USER_TIMED_OUT': throw new PasskeyTimedOutError(message);
    default: throw e;
  }
}

/**
 * Web analogue of `rethrowAsTyped`. The WASM layer stringifies the
 * SDK's `PasskeyError` into a plain `Error` (no `code`/`kind`), so the
 * typed class the JS provider threw is lost crossing the WASM boundary.
 * Re-type it by matching the SDK's stable `Display` prefixes so
 * PasskeyPage's `instanceof` recovery branches fire on web the same way
 * they do on native. Anything unrecognized rethrows unchanged.
 */
function rethrowWasmAsTyped(e: unknown): never {
  if (
    e instanceof PasskeyAlreadyExistsError
    || e instanceof PasskeyCredentialNotFoundError
    || e instanceof PasskeyTimedOutError
  ) {
    throw e;
  }
  const message = e instanceof Error ? e.message : String(e);
  if (/Credential already exists/i.test(message)) throw new PasskeyAlreadyExistsError(message);
  if (/Credential not found/i.test(message)) throw new PasskeyCredentialNotFoundError(message);
  if (/Authenticator timed out/i.test(message)) throw new PasskeyTimedOutError(message);
  throw e;
}

class NativePasskey implements PasskeyApi {
  /** The userName the plugin was last initialized with; re-init only if we need a different one. */
  private lastUserName: string | undefined = undefined;
  private initialized = false;

  private plugin(): NativePasskeyPlugin {
    const p = window.Capacitor?.Plugins?.Passkey;
    if (!p) throw new Error('Passkey plugin not available');
    return p;
  }

  private async initPlugin(opts: { userName?: string; userDisplayName?: string } = {}) {
    if (this.initialized && this.lastUserName === opts.userName) return;
    await this.plugin().initialize({
      rpId,
      rpName,
      userName: opts.userName,
      userDisplayName: opts.userDisplayName,
      breezApiKey: import.meta.env.VITE_BREEZ_API_KEY,
    });
    this.initialized = true;
    this.lastUserName = opts.userName;
  }

  async checkAvailability(): Promise<PasskeyAvailability> {
    await this.initPlugin();
    return this.plugin().checkAvailability();
  }

  async register(request: PasskeyRegisterRequest): Promise<RegisterResponse> {
    // Rotating user.name per create avoids Apple Passwords' dedupe.
    await this.initPlugin({ userName: request.userName, userDisplayName: request.userDisplayName });
    try {
      const r = await this.plugin().register({
        label: request.label,
        excludeCredentials: request.excludeCredentials?.map(bytesToBase64),
      });
      return {
        wallet: decodeWallet(r.wallet),
        credential: decodeCredential(r.credential),
      };
    } catch (e) { rethrowAsTyped(e); }
  }

  async signIn(request: SignInRequest): Promise<SignInResponse> {
    await this.initPlugin();
    try {
      const r = await this.plugin().signIn({
        label: request.label,
        allowCredentials: request.allowCredentials?.map(bytesToBase64),
        preferImmediatelyAvailableCredentials: request.preferImmediatelyAvailableCredentials,
      });
      return {
        wallet: decodeWallet(r.wallet),
        labels: r.labels,
        // Sign-in assertions carry no attestation, so synthesize a
        // credential from the bare ID the plugin observed.
        credential: r.credentialId
          ? { credentialId: base64ToBytes(r.credentialId) }
          : undefined,
      };
    } catch (e) { rethrowAsTyped(e); }
  }

  async connectWithPasskey(request: ConnectWithPasskeyRequest): Promise<ConnectWithPasskeyResponse> {
    await this.initPlugin({ userName: request.userName, userDisplayName: request.userDisplayName });
    try {
      const r = await this.plugin().connectWithPasskey({
        label: request.label,
        excludeCredentials: request.excludeCredentials?.map(bytesToBase64),
      });
      return {
        wallet: decodeWallet(r.wallet),
        registeredCredential: r.registeredCredential ? decodeCredential(r.registeredCredential) : null,
      };
    } catch (e) { rethrowAsTyped(e); }
  }

  labels() {
    return {
      list: async () => {
        await this.initPlugin();
        return (await this.plugin().listLabels()).labels;
      },
      store: async (label: string) => {
        await this.initPlugin();
        await this.plugin().storeLabel({ label });
      },
    };
  }

  credentials() {
    return {
      get: async () => {
        await this.initPlugin();
        const r = await this.plugin().getKnownCredentialIds();
        return r.credentialIds.map(base64ToBytes);
      },
      remove: async (credentialId: Uint8Array) => {
        await this.initPlugin();
        await this.plugin().removeKnownCredentialId({ credentialId: bytesToBase64(credentialId) });
      },
      clear: async () => {
        await this.initPlugin();
        await this.plugin().clearKnownCredentialIds();
      },
    };
  }
}

// ---------- web impl ----------

const browserRegistry = Capacitor.isNativePlatform() ? null : new LocalStorageCredentialRegistry();

function buildBrowserPasskeyClient(opts: { userName?: string; userDisplayName?: string } = {}): PasskeyClient {
  const provider = new PasskeyProvider(
    {
      rpId,
      rpName,
      userName: opts.userName,
      userDisplayName: opts.userDisplayName,
    },
    {
      authenticatorAttachment: 'platform',
      hints: ['client-device'],
      defaultTimeoutMs: 55_000,
    },
  );
  return new PasskeyClient(provider, import.meta.env.VITE_BREEZ_API_KEY);
}

class WebPasskey implements PasskeyApi {
  /** Cached for sign-in / labels / credentials. Register rebuilds for the rotating user.name. */
  private cached: PasskeyClient | null = null;

  private client(): PasskeyClient {
    if (!this.cached) this.cached = buildBrowserPasskeyClient();
    return this.cached;
  }

  invalidate(): void {
    this.cached = null;
  }

  checkAvailability(): Promise<PasskeyAvailability> {
    return this.client().checkAvailability();
  }

  async register(request: PasskeyRegisterRequest): Promise<RegisterResponse> {
    // Fresh client per create rotates user.name (Apple Passwords
    // dedupes by `(rpId, user.name)`) and re-evaluates the Nostr
    // identity, which is fine since register publishes the label.
    const oneShot = buildBrowserPasskeyClient({
      userName: request.userName,
      userDisplayName: request.userDisplayName,
    });
    try {
      const response = await oneShot.register({
        label: request.label,
        excludeCredentials: request.excludeCredentials,
      });
      // The SDK no longer tracks credentials, so record the new ID in
      // the local store that backs credentials().get().
      const credentialId = response.credential?.credentialId;
      if (credentialId) await browserRegistry!.add(rpId, credentialId);
      return response;
    } catch (e) { rethrowWasmAsTyped(e); }
  }

  signIn(request: SignInRequest): Promise<SignInResponse> {
    return this.client().signIn(request);
  }

  // No connectWithPasskey on web (left undefined).

  labels() {
    const c = this.client();
    return {
      list: () => c.labels().list(),
      store: (label: string) => c.labels().store(label),
    };
  }

  credentials() {
    return {
      get: () => browserRegistry!.read(rpId),
      remove: (id: Uint8Array) => browserRegistry!.remove(rpId, id),
      clear: () => browserRegistry!.clear(rpId),
    };
  }
}

// ---------- dispatcher ----------

let cached: PasskeyApi | null = null;

export function getPasskey(): PasskeyApi {
  if (cached) return cached;
  cached = Capacitor.isNativePlatform() ? new NativePasskey() : new WebPasskey();
  return cached;
}

export function invalidatePasskey(): void {
  if (cached instanceof WebPasskey) cached.invalidate();
  cached = null;
}

// ---------- host-side helpers ----------

/**
 * Known credential IDs as base64. Native reads the plugin's synced
 * store (iCloud Keychain / Block Store); web reads the local store.
 */
export async function getKnownCredentialIdsBase64(): Promise<string[]> {
  const ids = await getPasskey().credentials().get();
  return ids.map(bytesToBase64);
}

/**
 * Persist post-register metadata: AAGUID + backupEligible (only
 * available at create), the rotating user.name, the device-level
 * registered flag, and pin the new cred as the active one.
 */
export function recordRegisteredCredential(
  cred: RegisterResponse['credential'],
  userName: string | undefined,
): void {
  if (!cred) return;
  const credentialIdB64 = bytesToBase64(cred.credentialId);
  if (userName) setCredentialUserName(credentialIdB64, userName);
  localStorage.setItem('passkeyActiveCredentialId', credentialIdB64);
  const aaguidBytes = cred.aaguid;
  if (aaguidBytes) {
    localStorage.setItem(
      `${PASSKEY_AAGUID_PREFIX}${credentialIdB64}`,
      bytesToBase64(aaguidBytes),
    );
  }
  if (cred.backupEligible !== null && cred.backupEligible !== undefined) {
    localStorage.setItem(
      `${PASSKEY_BE_PREFIX}${credentialIdB64}`,
      cred.backupEligible ? '1' : '0',
    );
  }
  markCredentialUsed(credentialIdB64);
  localStorage.setItem(PASSKEY_REGISTERED_KEY, '1');
  markPasskeyUsed();
}

/**
 * Read the credential ID we last signed in with, as raw bytes for
 * passing to `signIn({ allowCredentials })`. Returns null when no
 * passkey session is pinned (fresh state, after `clearPasskeyHistory`,
 * or in mnemonic mode).
 *
 * Callers that surface secrets tied to the active wallet (e.g. the
 * recovery-phrase reveal) should pin `allowCredentials` to this so
 * the OS picker can't substitute a sibling credential for the same
 * RP and derive a different wallet's seed.
 */
export function getActivePasskeyCredentialIdBytes(): Uint8Array | null {
  const b64 = localStorage.getItem('passkeyActiveCredentialId');
  if (!b64) return null;
  try {
    return base64ToBytes(b64);
  } catch {
    return null;
  }
}

/**
 * Pin this cred as active (so subsequent derives constrain
 * `allowCredentials`) and stamp its last-used timestamp.
 */
export function recordSignedInCredential(credentialId: Uint8Array | undefined): void {
  if (!credentialId) return;
  const b64 = bytesToBase64(credentialId);
  localStorage.setItem('passkeyActiveCredentialId', b64);
  markCredentialUsed(b64);
  markPasskeyUsed();
}

/**
 * Sign in pinned to the credential we last signed in with, then record
 * it as active. Pinning makes the OS resume the same wallet instead of
 * surfacing a picker (which could substitute a sibling credential for
 * the same RP and derive a different wallet's seed). Fresh state (no
 * active credential) falls back to an empty `allowCredentials`, i.e. the
 * discoverable-credential picker for first sign-in.
 *
 * This is the single entry point for every resume/sign-in derive so the
 * active-credential pin can't be silently dropped at one call site.
 */
export async function signInPinnedToActiveCredential(
  label?: string,
): Promise<SignInResponse> {
  const activeCredId = getActivePasskeyCredentialIdBytes();
  const response = await getPasskey().signIn({
    label,
    allowCredentials: activeCredId ? [activeCredId] : [],
  });
  recordSignedInCredential(response.credential?.credentialId);
  return response;
}

export function getCredentialAaguid(credentialId: string): string | undefined {
  return localStorage.getItem(`${PASSKEY_AAGUID_PREFIX}${credentialId}`) ?? undefined;
}

export function getAllCredentialAaguids(): string[] {
  const out: string[] = [];
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PASSKEY_AAGUID_PREFIX)) {
      const v = localStorage.getItem(key);
      if (v) out.push(v);
    }
  }
  return out;
}

/** Most-recently-recorded BE flag across all known credentials. */
export function getLatestBackupEligible(): boolean | undefined {
  let latest: string | null = null;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PASSKEY_BE_PREFIX)) {
      latest = localStorage.getItem(key);
    }
  }
  if (latest === null) return undefined;
  return latest === '1';
}

/** Stamp first-seen (set once) and last-seen (always). */
export function markPasskeyUsed(): void {
  const now = String(Date.now());
  if (!localStorage.getItem(PASSKEY_FIRST_SEEN_KEY)) {
    localStorage.setItem(PASSKEY_FIRST_SEEN_KEY, now);
  }
  localStorage.setItem(PASSKEY_LAST_SEEN_KEY, now);
}

export function getPasskeyMeta(): { firstSeenAt?: number; lastSeenAt?: number } {
  const first = localStorage.getItem(PASSKEY_FIRST_SEEN_KEY);
  const last = localStorage.getItem(PASSKEY_LAST_SEEN_KEY);
  return {
    firstSeenAt: first ? Number(first) : undefined,
    lastSeenAt: last ? Number(last) : undefined,
  };
}

export function markLabelUsed(label: string): void {
  localStorage.setItem(`${PASSKEY_LABEL_LAST_USED_PREFIX}${label}`, String(Date.now()));
}

export function getLabelLastUsed(label: string): number | undefined {
  const raw = localStorage.getItem(`${PASSKEY_LABEL_LAST_USED_PREFIX}${label}`);
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function clearAllLabelLastUsed(): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PASSKEY_LABEL_LAST_USED_PREFIX)) {
      localStorage.removeItem(key);
    }
  }
}

export function clearAllCredentialAaguids(): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PASSKEY_AAGUID_PREFIX) || key.startsWith(PASSKEY_BE_PREFIX)) {
      localStorage.removeItem(key);
    }
  }
}

/**
 * Drop one cred's metadata when the user confirms it has been
 * deleted from OS Settings. Preserves siblings and
 * `passkeyRegistered`.
 */
export async function removeStaleCredential(credentialId: string): Promise<void> {
  if (!credentialId) return;
  logger.warn(LogCategory.AUTH, 'Removing stale credential metadata', { credentialId });

  try {
    await signalUnknownCredentials([credentialId]);
  } catch (e) {
    logger.debug(LogCategory.AUTH, 'signalUnknownCredentials failed during stale removal', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    await getPasskey().credentials().remove(base64ToBytes(credentialId));
  } catch (e) {
    logger.debug(LogCategory.AUTH, 'credentials.remove failed during stale removal', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  localStorage.removeItem(`${PASSKEY_AAGUID_PREFIX}${credentialId}`);
  localStorage.removeItem(`${PASSKEY_BE_PREFIX}${credentialId}`);
  removeCredentialUserName(credentialId);
  removeCredentialMeta(credentialId);
  unhideCredential(credentialId);
}

export function setPendingSwitchFromCredentialId(credentialId: string | null): void {
  if (credentialId) {
    localStorage.setItem(PASSKEY_PENDING_SWITCH_FROM_KEY, credentialId);
  } else {
    localStorage.removeItem(PASSKEY_PENDING_SWITCH_FROM_KEY);
  }
}

export function consumePendingSwitchFromCredentialId(): string | null {
  const v = localStorage.getItem(PASSKEY_PENDING_SWITCH_FROM_KEY);
  localStorage.removeItem(PASSKEY_PENDING_SWITCH_FROM_KEY);
  return v;
}

/**
 * Wipe device-level passkey history when signIn returns
 * CredentialNotFound on a previously-registered device.
 */
export async function clearPasskeyHistory(): Promise<void> {
  logger.warn(LogCategory.AUTH, 'Clearing passkey history (deletion detected)');
  const passkey = getPasskey();
  let knownIdsB64: string[] = [];
  try {
    const ids = await passkey.credentials().get();
    knownIdsB64 = ids.map(bytesToBase64);
  } catch (e) {
    logger.debug(LogCategory.AUTH, 'credentials.get failed pre-wipe', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  try {
    await passkey.credentials().clear();
  } catch (e) {
    logger.warn(LogCategory.AUTH, 'Failed to clear credential registry', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  if (knownIdsB64.length > 0) {
    void signalUnknownCredentials(knownIdsB64);
  }
  localStorage.removeItem(PASSKEY_REGISTERED_KEY);
  localStorage.removeItem('passkeyActiveCredentialId');
  localStorage.removeItem(PASSKEY_FIRST_SEEN_KEY);
  localStorage.removeItem(PASSKEY_LAST_SEEN_KEY);
  clearAllLabelLastUsed();
  clearAllCredentialMeta();
  clearAllHiddenCredentials();
  // AAGUIDs intentionally kept: only captured at create.
  invalidatePasskey();
}

/** Collapse the SDK's four availability variants to a single bool. */
export async function isPrfAvailable(): Promise<boolean> {
  const ua = navigator.userAgent;
  // Firefox PRF support is still unreliable; gate off entirely.
  if (/Firefox\//i.test(ua) && !/Seamonkey\//i.test(ua)) return false;

  const availability = await getPasskey().checkAvailability();
  return availability.type !== 'prfUnsupported';
}

export function isPasskeyMode(): boolean {
  return localStorage.getItem(PASSKEY_LABEL_KEY) !== null;
}

export function setPasskeyMode(label?: string): void {
  localStorage.setItem(PASSKEY_LABEL_KEY, label ?? 'Default');
  localStorage.setItem(PASSKEY_REGISTERED_KEY, '1');
}

export function clearPasskeyMode(): void {
  localStorage.removeItem(PASSKEY_LABEL_KEY);
  localStorage.removeItem('passkeyActiveCredentialId');
  invalidatePasskey();
}

/**
 * Pin the next sign-in to `credentialId`. Caller disconnects the SDK
 * and routes to PasskeyPage so the detect flow re-runs.
 */
export function pinActivePasskeyCredentialId(credentialId: string): void {
  localStorage.setItem('passkeyActiveCredentialId', credentialId);
  localStorage.removeItem(PASSKEY_LABEL_KEY);
  unhideCredential(credentialId);
  invalidatePasskey();
}

export function hasPasskeyHistory(): boolean {
  return localStorage.getItem(PASSKEY_REGISTERED_KEY) === '1';
}

export async function listLabels(): Promise<string[]> {
  logger.info(LogCategory.AUTH, 'Listing labels from nostr relays');
  return getPasskey().labels().list();
}

export async function saveLabel(label: string): Promise<void> {
  logger.info(LogCategory.AUTH, 'Saving label to nostr relays');
  await getPasskey().labels().store(label);
}
