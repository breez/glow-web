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
import { sdkReady } from './sdkReady';
import { LocalStorageCredentialRegistry } from './localStorageCredentialRegistry';
import { rpId, rpName, signalUnknownCredentials, LEGACY_RP_ID } from './passkeyPrfProvider';
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
const PASSKEY_RP_ID_KEY = 'passkeyRpId';
const PASSKEY_ACTIVE_CRED_RP_KEY = 'passkeyActiveCredentialRpId';

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

/**
 * Single-CTA sign-in that falls through to register on a fresh device.
 * On web, usable only where the browser supports immediate mediation
 * (`checkAvailability().immediateMediationSupported`): a plain picker
 * can't tell no-credential from cancel.
 */
export interface ConnectWithPasskeyRequest {
  label?: string;
  /** Pin the sign-in to these creds so the OS can't substitute a sibling. */
  allowCredentials?: Uint8Array[];
  excludeCredentials?: Uint8Array[];
  userName?: string;
  userDisplayName?: string;
}

export interface ConnectWithPasskeyResponse {
  wallet: Wallet;
  /** Returning user's published labels; empty for a freshly registered wallet. */
  labels: string[];
  /**
   * The credential that signed in or was registered. `aaguid` is populated
   * only on registration, so a non-null `aaguid` means this call registered.
   */
  credential: PasskeyCredential | null;
}

export interface PasskeyApi {
  checkAvailability(): Promise<PasskeyAvailability>;
  register(request: PasskeyRegisterRequest): Promise<RegisterResponse>;
  signIn(request: SignInRequest): Promise<SignInResponse>;
  /**
   * Single-CTA flow: silent sign-in, label discovery, then a register
   * fall-through for a new user, in one call. Defined on web and native; the
   * detecting flow gates web use on immediate mediation.
   */
  connectWithPasskey?(request: ConnectWithPasskeyRequest): Promise<ConnectWithPasskeyResponse>;
  labels(): { list(): Promise<string[]>; store(label: string): Promise<void> };
  credentials(): {
    get(): Promise<Uint8Array[]>;
    remove(credentialId: Uint8Array): Promise<void>;
    clear(): Promise<void>;
  };
}

// ---------- byte helpers ----------

export function bytesToBase64(bytes: Uint8Array): string {
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
    allowCredentials?: string[];
    excludeCredentials?: string[];
  }): Promise<{
    wallet: NativePluginWalletJson;
    /** Absent on native shells that predate the labels bridge. */
    labels?: string[];
    registeredCredential: NativePluginCredentialJson | null;
  }>;
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
        // Always true on native: it suppresses the cross-device sheet so a
        // device with no passkey fast-fails as CREDENTIAL_NOT_FOUND and the
        // caller can route to create. The caller's flag is the web
        // immediate-mediation capability, which is false on native, and
        // forwarding it re-opens the picker on a device with nothing to pick.
        preferImmediatelyAvailableCredentials: true,
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
        allowCredentials: request.allowCredentials?.map(bytesToBase64),
        excludeCredentials: request.excludeCredentials?.map(bytesToBase64),
      });
      return {
        wallet: decodeWallet(r.wallet),
        // Native shells that predate the labels bridge omit the field.
        labels: r.labels ?? [],
        credential: r.registeredCredential ? decodeCredential(r.registeredCredential) : null,
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

export function buildBrowserPasskeyClient(opts: { userName?: string; userDisplayName?: string; rpId?: string } = {}): PasskeyClient {
  const provider = new PasskeyProvider(
    {
      rpId: opts.rpId ?? rpId,
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

  /**
   * Retain an externally-built client (scoped to the session RP ID) as the
   * cached one, so labels()/store reuse its primed, pinned Nostr identity
   * instead of a cold default-RP client that would re-derive it unpinned
   * (which surfaces the all-passkeys OS picker).
   */
  adoptClient(client: PasskeyClient): void {
    this.cached = client;
  }

  async checkAvailability(): Promise<PasskeyAvailability> {
    // Runs on mount via isPrfAvailable(). client() builds a PasskeyProvider,
    // a WASM class, so wait for the module now that SDK boot is deferred.
    await sdkReady();
    return this.client().checkAvailability();
  }

  async register(request: PasskeyRegisterRequest): Promise<RegisterResponse> {
    // buildBrowserPasskeyClient constructs a WASM PasskeyProvider; wait for the
    // module (a no-op once ready, which it usually is by the time a user taps).
    await sdkReady();
    // Fresh client per create rotates user.name (Apple Passwords
    // dedupes by `(rpId, user.name)`) and re-evaluates the Nostr
    // identity, which is fine since register publishes the label.
    const oneShot = buildBrowserPasskeyClient({
      userName: request.userName,
      userDisplayName: request.userDisplayName,
    });
    logger.info(LogCategory.AUTH, 'Passkey register ceremony', {
      rpId,
      label: request.label ?? null,
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

  async signIn(request: SignInRequest): Promise<SignInResponse> {
    await sdkReady();
    try {
      return await this.client().signIn(request);
    } catch (e) { rethrowWasmAsTyped(e); }
  }

  async connectWithPasskey(request: ConnectWithPasskeyRequest): Promise<ConnectWithPasskeyResponse> {
    // buildBrowserPasskeyClient constructs a WASM PasskeyProvider; wait for the
    // module (a no-op once ready, which it usually is by the time a user taps).
    await sdkReady();
    // Fresh client per call rotates user.name on the register fallthrough,
    // exactly like register(): connectWithPasskey's internal create() derives
    // the WebAuthn identity from the provider, not the request.
    const oneShot = buildBrowserPasskeyClient({
      userName: request.userName,
      userDisplayName: request.userDisplayName,
    });
    try {
      const response = await oneShot.connectWithPasskey({
        label: request.label,
        allowCredentials: request.allowCredentials,
        excludeCredentials: request.excludeCredentials,
      });
      // Adopt the one-shot as the session client: its Nostr identity cache
      // is now primed by the sign-in/register, so a later signIn or
      // labels().store reuses it instead of re-deriving (a surprise PRF
      // prompt). Mirrors how the explicit flow's signIn primes this.client().
      this.cached = oneShot;
      // Record a freshly registered cred (aaguid set only on register) in
      // the local store that backs credentials().get(); the SDK no longer
      // tracks them.
      const credentialId = response.credential?.credentialId;
      if (credentialId && response.credential?.aaguid) {
        await browserRegistry!.add(rpId, credentialId);
      }
      return {
        wallet: response.wallet,
        labels: response.labels,
        credential: response.credential ?? null,
      };
    } catch (e) { rethrowWasmAsTyped(e); }
  }

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

/**
 * Adopt an already-primed, RP-scoped client as the session's passkey client
 * (web only). Used after migration: the new shared client has its Nostr identity
 * derived + pinned, so handing it off keeps post-migration labels()/store as
 * cache hits instead of a cold re-derive on the stale legacy client.
 */
export function adoptSessionPasskeyClient(client: PasskeyClient): void {
  const api = getPasskey();
  if (api instanceof WebPasskey) api.adoptClient(client);
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
  // Reject empty bytes too: a zero-length id would pass the null check and
  // write an empty active-credential pin (read back as null), silently
  // unpinning the wallet.
  if (!cred || !cred.credentialId || cred.credentialId.length === 0) return;
  const credentialIdB64 = bytesToBase64(cred.credentialId);
  if (userName) setCredentialUserName(credentialIdB64, userName);
  localStorage.setItem('passkeyActiveCredentialId', credentialIdB64);
  localStorage.setItem(PASSKEY_ACTIVE_CRED_RP_KEY, rpId);
  setPasskeyRpId(rpId);
  logger.info(LogCategory.AUTH, 'Passkey credential registered', {
    credentialId: credentialIdB64,
    rpId,
  });
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
export function getActivePasskeyCredentialIdBytes(forRpId?: string): Uint8Array | null {
  const b64 = localStorage.getItem('passkeyActiveCredentialId');
  if (!b64) return null;
  const pinRpId = localStorage.getItem(PASSKEY_ACTIVE_CRED_RP_KEY);
  if (forRpId && pinRpId && pinRpId !== forRpId) return null;
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
export function recordSignedInCredential(
  credentialId: Uint8Array | undefined,
  ceremonyRpId: string = rpId,
): void {
  if (!credentialId) return;
  const b64 = bytesToBase64(credentialId);
  localStorage.setItem('passkeyActiveCredentialId', b64);
  localStorage.setItem(PASSKEY_ACTIVE_CRED_RP_KEY, ceremonyRpId);
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
  rpIdOverride?: string,
  // Maps to WebAuthn `mediation: 'immediate'` on web: the assertion
  // fast-fails (no sheet) when no local credential is present, so the
  // silent discovery probe can fall through to create. Honored only
  // where the browser advertises it (native fast-fails regardless).
  preferImmediatelyAvailableCredentials?: boolean,
): Promise<SignInResponse> {
  const effectiveRpId = rpIdOverride ?? getPasskeyRpId() ?? rpId;
  // Same-RP pin first. On a cross-RP switch (the active pin is for the other RP)
  // fall back to the migrated counterpart credential for this RP, so the OS goes
  // straight to it instead of listing every passkey. Null on both => OS picker.
  const pinCredId = getActivePasskeyCredentialIdBytes(effectiveRpId)
    ?? getMigrationCounterpartCredentialIdBytes(effectiveRpId);
  const allowCredentials = pinCredId ? [pinCredId] : [];
  logger.info(LogCategory.AUTH, 'Passkey sign-in ceremony', {
    rpId: effectiveRpId,
    pinned: !!pinCredId,
    label: label ?? null,
  });
  // Web only: derive against a specific RP ID (e.g. a legacy-RP user before
  // migration, whose credential lives under LEGACY_RP_ID). On native the RP ID
  // is fixed by the plugin, so the override is ignored.
  const useScoped = !Capacitor.isNativePlatform() && effectiveRpId !== rpId;
  let response: SignInResponse;
  if (useScoped) {
    // Sign in on a client scoped to the session RP, then retain it as the
    // cached client. signIn primes the Nostr identity, so a later labels()/store
    // is a cache hit rather than a cold, unpinned re-derive (the OS picker).
    // buildBrowserPasskeyClient constructs a WASM PasskeyProvider, and this runs
    // at mount for returning passkey users, so wait for the module first.
    await sdkReady();
    const client = buildBrowserPasskeyClient({ rpId: effectiveRpId });
    response = await client.signIn({ label, allowCredentials, preferImmediatelyAvailableCredentials });
    const api = getPasskey();
    if (api instanceof WebPasskey) api.adoptClient(client);
  } else {
    response = await getPasskey().signIn({ label, allowCredentials, preferImmediatelyAvailableCredentials });
  }
  logger.info(LogCategory.AUTH, 'Passkey sign-in ceremony completed', {
    rpId: effectiveRpId,
    credentialId: response.credential?.credentialId
      ? bytesToBase64(response.credential.credentialId)
      : null,
    label: response.wallet.label,
  });
  recordSignedInCredential(response.credential?.credentialId, effectiveRpId);
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
  localStorage.removeItem(PASSKEY_ACTIVE_CRED_RP_KEY);
  localStorage.removeItem(PASSKEY_FIRST_SEEN_KEY);
  localStorage.removeItem(PASSKEY_LAST_SEEN_KEY);
  clearAllLabelLastUsed();
  clearAllCredentialMeta();
  clearAllHiddenCredentials();
  // AAGUIDs intentionally kept: only captured at create.
  invalidatePasskey();
}

/**
 * Forget every credential id known to this device without signaling
 * the credential manager: account deletion wipes local state while the
 * passkey itself stays valid for a later restore (unlike
 * clearPasskeyHistory, which reacts to a passkey that is already gone
 * and asks the manager to drop it too). On native this clears the
 * plugin's Keychain / Block Store registry, which no web-side storage
 * wipe can reach.
 */
export async function clearKnownCredentials(): Promise<void> {
  try {
    await getPasskey().credentials().clear();
  } catch (e) {
    logger.warn(LogCategory.AUTH, 'Failed to clear credential registry', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  invalidatePasskey();
}

let prfAvailablePromise: Promise<boolean> | null = null;

/**
 * Memoized isPrfAvailable().
 *
 * The welcome screen picks its onboarding flow from this, and defaults to the
 * non-passkey one until it resolves. The splash waits on it (main.tsx) so a
 * first-time user never sees the wrong flow flash past — or, worse, taps into
 * mnemonic onboarding during that window. Shared so the check runs once and
 * both callers observe the same result.
 */
export function prfAvailability(): Promise<boolean> {
  if (!prfAvailablePromise) {
    prfAvailablePromise = isPrfAvailable().catch(() => false);
  }
  return prfAvailablePromise;
}

let availabilityPromise: Promise<PasskeyAvailability> | null = null;

/**
 * Memoized `checkAvailability()`.
 *
 * The probe used to run twice per sign-in: once behind the splash for
 * the welcome screen's flow pick, then again on PasskeyPage mount. It
 * is a first-touch SDK call (and the domain-association check on
 * native), so the second run put real work between the user's tap and
 * the WebAuthn call. Immediate mediation needs the tap's transient
 * activation to still be live when it fires, and on a cold profile (a
 * fresh private window) that second probe was enough to lose it: the
 * first attempt failed and only Try Again worked.
 *
 * A `notAssociated` result is not cached: that one can come from a
 * transient probe failure, and pinning it would make the error screen's
 * retry pointless.
 */
export function passkeyAvailability(): Promise<PasskeyAvailability> {
  if (!availabilityPromise) {
    availabilityPromise = getPasskey().checkAvailability()
      .then((availability) => {
        if (availability.type === 'notAssociated') availabilityPromise = null;
        return availability;
      })
      .catch((e) => {
        availabilityPromise = null;
        throw e;
      });
  }
  return availabilityPromise;
}

/** Collapse the SDK's four availability variants to a single bool. */
export async function isPrfAvailable(): Promise<boolean> {
  const ua = navigator.userAgent;
  // Firefox PRF support is still unreliable; gate off entirely.
  if (/Firefox\//i.test(ua) && !/Seamonkey\//i.test(ua)) return false;

  const availability = await passkeyAvailability();
  return availability.type !== 'prfUnsupported';
}

export function isPasskeyMode(): boolean {
  return localStorage.getItem(PASSKEY_LABEL_KEY) !== null;
}

export function setPasskeyMode(label?: string, rpId?: string): void {
  localStorage.setItem(PASSKEY_LABEL_KEY, label ?? 'Default');
  localStorage.setItem(PASSKEY_REGISTERED_KEY, '1');
  if (rpId) setPasskeyRpId(rpId);
}

export function clearPasskeyMode(): void {
  // Clears label + active credential only. passkeyRpId is device metadata
  // that must survive logout so the correct RP ID is used on next sign-in.
  localStorage.removeItem(PASSKEY_LABEL_KEY);
  localStorage.removeItem('passkeyActiveCredentialId');
  localStorage.removeItem(PASSKEY_ACTIVE_CRED_RP_KEY);
  invalidatePasskey();
}

// ---------- RP ID persistence (device metadata; survives logout) ----------

/** The RP ID this device's passkey was created/derived under, or null. */
export function getPasskeyRpId(): string | null {
  return localStorage.getItem(PASSKEY_RP_ID_KEY);
}

/** Persist the RP ID used for this device's passkey. */
export function setPasskeyRpId(rpId: string): void {
  localStorage.setItem(PASSKEY_RP_ID_KEY, rpId);
}

// ---------- Passkey-RP migration state ----------

// Module-level flag (not persisted): set while the migration modal runs a
// sweep so useBreezSdk's paymentSucceeded handler suppresses the celebration
// overlay for the internal sweep transfers.
let migrationInProgress = false;
export function setMigrationInProgress(active: boolean): void {
  migrationInProgress = active;
}
export function isMigrationInProgress(): boolean {
  return migrationInProgress;
}

const PASSKEY_MIGRATED_KEY = 'passkeyMigrated';
const PASSKEY_MIGRATION_SHARED_CRED_KEY = 'passkeyMigrationSharedCredentialId';

/** True once the user has migrated to (or explicitly skipped) the shared RP ID. */
export function isPasskeyMigrated(): boolean {
  return localStorage.getItem(PASSKEY_MIGRATED_KEY) === 'true';
}

/** Mark migration done (or skipped: same outcome, don't prompt again). */
export function setPasskeyMigrated(): void {
  localStorage.setItem(PASSKEY_MIGRATED_KEY, 'true');
  logger.info(LogCategory.AUTH, 'Marked passkey as migrated');
}

/**
 * Dev/test only: re-arm the passkey-RP migration. Drops the migrated flag,
 * reverts to the legacy RP (so the next sign-in is on the legacy wallet and
 * `onLegacyRp` holds), and clears any in-flight migration credential so a
 * re-run creates a fresh shared passkey instead of resuming onto an old one.
 */
export function resetPasskeyMigrationState(): void {
  localStorage.removeItem(PASSKEY_MIGRATED_KEY);
  // Pin the RP back to legacy explicitly. Removing the key falls back to the
  // module default (the shared RP when configured), which would leave the next
  // sign-in on the new RP instead of the legacy wallet.
  setPasskeyRpId(LEGACY_RP_ID);
  clearMigrationSharedCredentialId();
  logger.warn(LogCategory.AUTH, 'Reset passkey migration state (dev)');
}

// The shared credential id created mid-migration, persisted (base64) the moment
// register succeeds. Its presence is the precise "a shared passkey already exists"
// signal: on resume the flow pins the probe to it (re-finding the exact passkey
// instead of the OS picker) and must never create a second one, since a
// duplicate derives a different wallet and would strand already-swept funds.
// Cleared once migration completes.
export function setMigrationSharedCredentialId(credentialId: Uint8Array): void {
  if (credentialId.length === 0) return;
  localStorage.setItem(PASSKEY_MIGRATION_SHARED_CRED_KEY, bytesToBase64(credentialId));
}
export function getMigrationSharedCredentialIdBytes(): Uint8Array | null {
  const b64 = localStorage.getItem(PASSKEY_MIGRATION_SHARED_CRED_KEY);
  if (!b64) return null;
  try {
    return base64ToBytes(b64);
  } catch {
    return null;
  }
}
export function clearMigrationSharedCredentialId(): void {
  localStorage.removeItem(PASSKEY_MIGRATION_SHARED_CRED_KEY);
}

// ---------- Migration credential pairs (device metadata; survives logout) ----------

// Maps a migrated source (legacy) credential to the shared credential it migrated
// to, so a later RP switch can pin `allowCredentials` straight to the counterpart
// instead of surfacing the full passkey picker. One entry per source credential
// (re-migrating the same passkey overwrites its destination with the latest);
// distinct passkeys accumulate. Persisted so it survives logout.
const PASSKEY_MIGRATION_CRED_PAIRS_KEY = 'passkeyMigrationCredentialPairs';
type MigrationCredentialPair = { oldRpId: string; oldCredId: string; newRpId: string; newCredId: string };
// ponytail: bound the list; a device migrates a handful of passkeys, not hundreds.
const MAX_MIGRATION_CRED_PAIRS = 50;

function safeBase64ToBytes(b64: string): Uint8Array | null {
  try {
    return base64ToBytes(b64);
  } catch {
    return null;
  }
}

function readMigrationCredentialPairs(): MigrationCredentialPair[] {
  const raw = localStorage.getItem(PASSKEY_MIGRATION_CRED_PAIRS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Remember that `oldCredId` (under `oldRpId`) migrated to `newCredId` (under
 * `newRpId`). Upserts by source credential: re-migrating the same passkey keeps
 * only the latest destination; other passkeys accumulate.
 */
export function recordMigrationCredentialPair(
  oldRpId: string,
  oldCredId: string,
  newRpId: string,
  newCredId: string,
): void {
  if (!oldCredId || !newCredId || oldRpId === newRpId) return;
  const pairs = readMigrationCredentialPairs().filter((p) => p.oldCredId !== oldCredId);
  pairs.push({ oldRpId, oldCredId, newRpId, newCredId });
  localStorage.setItem(
    PASSKEY_MIGRATION_CRED_PAIRS_KEY,
    JSON.stringify(pairs.slice(-MAX_MIGRATION_CRED_PAIRS)),
  );
}

/**
 * Given the credential currently signed in with, return the migrated counterpart
 * credential that lives under `targetRpId` (bytes for `allowCredentials`), or null
 * when no pair matches (an unmigrated passkey, or a first-ever switch to that RP).
 */
export function getMigrationCounterpartCredentialIdBytes(targetRpId: string): Uint8Array | null {
  const activeCredId = localStorage.getItem('passkeyActiveCredentialId');
  const activeRpId = localStorage.getItem(PASSKEY_ACTIVE_CRED_RP_KEY);
  if (!activeCredId || !activeRpId) return null;
  for (const p of readMigrationCredentialPairs()) {
    if (p.oldCredId === activeCredId && p.oldRpId === activeRpId && p.newRpId === targetRpId) {
      return safeBase64ToBytes(p.newCredId);
    }
    if (p.newCredId === activeCredId && p.newRpId === activeRpId && p.oldRpId === targetRpId) {
      return safeBase64ToBytes(p.oldCredId);
    }
  }
  return null;
}

export function clearMigrationCredentialPairs(): void {
  localStorage.removeItem(PASSKEY_MIGRATION_CRED_PAIRS_KEY);
}

/**
 * Record the newly-created shared credential as active after a successful
 * migration: pins it as active (so resume derives target it), stores its
 * AAGUID / backupEligible / user.name metadata, and adds it to the
 * shared-namespaced browser registry so per-credential management lists it.
 * Web only. Call this only once migration has fully succeeded, so a partial
 * failure never leaves the active credential pointing at an unusable shared cred.
 */
export function recordMigratedSharedCredential(
  cred: RegisterResponse['credential'],
  userName: string | undefined,
  sharedRpId: string,
): void {
  recordRegisteredCredential(cred, userName);
  if (!Capacitor.isNativePlatform() && cred && browserRegistry) {
    browserRegistry.add(sharedRpId, cred.credentialId).catch(() => {
      /* registry add is best-effort; management UI tolerates a missing entry. */
    });
  }
}

/**
 * Pin the next sign-in to `credentialId`. Caller disconnects the SDK
 * and routes to PasskeyPage so the detect flow re-runs.
 */
export function pinActivePasskeyCredentialId(credentialId: string): void {
  localStorage.setItem('passkeyActiveCredentialId', credentialId);
  localStorage.setItem(PASSKEY_ACTIVE_CRED_RP_KEY, rpId);
  localStorage.removeItem(PASSKEY_LABEL_KEY);
  unhideCredential(credentialId);
  invalidatePasskey();
}

export function hasPasskeyHistory(): boolean {
  return localStorage.getItem(PASSKEY_REGISTERED_KEY) === '1';
}

export async function listLabels(): Promise<string[]> {
  logger.info(LogCategory.AUTH, 'Listing labels from nostr relays');
  // Collapse byte-identical duplicates: partial relay coverage can return the
  // same label event twice, which would list one label (one wallet) twice.
  // Distinct strings (incl. case/whitespace variants) are different wallets and
  // are kept as-is.
  return [...new Set(await getPasskey().labels().list())];
}

export async function saveLabel(label: string): Promise<void> {
  logger.info(LogCategory.AUTH, 'Saving label to nostr relays');
  await getPasskey().labels().store(label);
}
