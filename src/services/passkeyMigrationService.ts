/**
 * Passkey-RP migration business logic, decoupled from React.
 *
 * `useMigrationFlow` (the hook) owns the phase state machine, cancellation and
 * SDK lifecycle; this module owns the actual work: the rpId-scoped passkey
 * credential handling (via `createMigrationSession`) and the BreezSdk
 * orchestration (connect / sweep / atomic Lightning-address transfer /
 * contacts). Keeping it here makes the fund-moving logic reviewable and
 * testable in isolation from the UI.
 */
import {
  connect,
  type BreezSdk,
  type GetInfoResponse,
  type PasskeyClient,
  type RegisterResponse,
  type Seed,
} from '@breeztech/breez-sdk-spark';
import { buildConnectConfig } from '@/hooks/buildConnectConfig';
import { logger, LogCategory } from './logger';
import { buildBrowserPasskeyClient, recordMigratedRorCredential, getActivePasskeyCredentialIdBytes, adoptSessionPasskeyClient, setMigrationRorCredentialId, getMigrationRorCredentialIdBytes, bytesToBase64 } from './passkeyService';
import { LEGACY_RP_ID, ROR_RP_ID, createPasskeyTimestampLabel, PasskeyCredentialNotFoundError } from './passkeyPrfProvider';
import { formatError } from '../utils/formatError';

const STORAGE_DIR = 'spark-wallet-example';

// ============================================
// Pure helpers
// ============================================

/**
 * Order labels so the "primary" (currently active per localStorage
 * `passkeyLabel`, or 'Default' as a fallback) is migrated LAST. Other labels
 * keep relative order. The last-migrated new SDK is the one the session adopts.
 */
export function orderLabelsForMigration(labels: string[], storedLabel: string): string[] {
  if (labels.length === 0) return [];
  let primary: string | undefined = labels.find((l) => l === storedLabel);
  if (!primary) primary = labels.find((l) => l === 'Default');
  if (!primary) primary = labels[labels.length - 1];
  const others = labels.filter((l) => l !== primary);
  return [...others, primary];
}

/** No credential id from the platform: can't pin the destination derive or resume onto it. */
export class RorSeedVerificationError extends Error {}

export function seedsMatch(a: Seed, b: Seed): boolean {
  if (a.type === 'mnemonic' && b.type === 'mnemonic') {
    return a.mnemonic === b.mnemonic && (a.passphrase ?? '') === (b.passphrase ?? '');
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Refuse to migrate a wallet onto itself (a same-identity transfer is a no-op self-send). */
export function assertDifferentWallet(
  oldInfo: GetInfoResponse,
  newInfo: GetInfoResponse,
  label: string,
): void {
  if (newInfo.identityPubkey === oldInfo.identityPubkey) {
    throw new Error(`Migration target for label "${label}" is the same wallet, aborting.`);
  }
}

/**
 * True only for a deterministic "this device has no such passkey" signal. A
 * cancel / OS timeout / relay blip is NOT this: web collapses those into the
 * same NotAllowedError, so the migration probe must treat a non-match as
 * retryable rather than silently marking a funded legacy wallet as migrated.
 */
export function isNoCredentialError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  const msg = e instanceof Error ? e.message : String(e);
  return (
    e instanceof PasskeyCredentialNotFoundError
    || code === 'CREDENTIAL_NOT_FOUND'
    || /Credential not found|no credentials|empty allowCredentials/i.test(msg)
  );
}

// ============================================
// BreezSdk operations
// ============================================

/** Connect a temporary SDK for a derived seed. */
export async function connectForSeed(seed: Seed): Promise<BreezSdk> {
  const cfg = buildConnectConfig();
  return connect({ config: cfg, seed, storageDir: STORAGE_DIR });
}


/**
 * Sweep the entire Spark sats balance (fees included) plus every non-zero token
 * balance from `from` to `to`, then sync the destination so the received funds
 * surface. Throws on a failed sats/token send (the caller routes to error).
 */
export async function sweepBalances(
  from: BreezSdk,
  to: BreezSdk,
  fromInfo: GetInfoResponse,
  label: string,
): Promise<void> {
  const receiveResp = await to.receivePayment({ paymentMethod: { type: 'sparkAddress' } });
  const sparkAddress = receiveResp.paymentRequest;

  if (fromInfo.balanceSats > 0) {
    logger.info(LogCategory.PAYMENT, 'Migration sweep: sending Spark balance', {
      label,
      sats: fromInfo.balanceSats,
    });
    const prepareResp = await from.prepareSendPayment({
      paymentRequest: { type: 'input', input: sparkAddress },
      amount: BigInt(fromInfo.balanceSats),
      feePolicy: 'feesIncluded',
    });
    await from.sendPayment({ prepareResponse: prepareResp });
    logger.info(LogCategory.PAYMENT, 'Migration sweep: Spark balance swept', {
      label,
      sats: fromInfo.balanceSats,
    });
  }

  let anyTokensSwept = false;
  for (const [tokenId, tokenBalance] of fromInfo.tokenBalances) {
    if (tokenBalance.balance <= 0n) continue;
    logger.info(LogCategory.PAYMENT, 'Migration sweep: sending token', {
      label,
      tokenId,
      amount: tokenBalance.balance.toString(),
    });
    const prepareResp = await from.prepareSendPayment({
      paymentRequest: { type: 'input', input: sparkAddress },
      amount: tokenBalance.balance,
      tokenIdentifier: tokenId,
    });
    await from.sendPayment({ prepareResponse: prepareResp });
    anyTokensSwept = true;
  }

  if (anyTokensSwept || fromInfo.balanceSats > 0) {
    try {
      await to.syncWallet({});
    } catch (e) {
      logger.warn(LogCategory.PAYMENT, 'Migration sweep: destination sync failed (non-fatal)', {
        label,
        error: formatError(e),
      });
    }
  }
}

/**
 * Moves the Lightning address from `from` to `to` using the SDK's atomic,
 * symmetric two-signature transfer. The current owner authorizes the transfer
 * to the new wallet's identity pubkey, then the new wallet claims it. This
 * avoids the unregister-then-register window and the SDK rejects self-transfers.
 *
 * Best effort: failures are logged but never block the migration. If the
 * current Lightning address can't be determined, the transfer is skipped.
 * Returns `true` only when a transfer was attempted and failed, allowing the
 * caller to warn that incoming Lightning payments may still arrive at the
 * original address.
 */
export async function transferLightningAddress(
  from: BreezSdk,
  to: BreezSdk,
  transfereePubkey: string,
  label: string,
): Promise<boolean> {
  const currentAddress = await from.getLightningAddress().catch((e) => {
    logger.warn(LogCategory.AUTH, 'Migration: failed to fetch lightning address; skipping transfer', { label, error: formatError(e) });
    return undefined;
  });
  if (!currentAddress) return false;

  const { username, description } = currentAddress;
  logger.info(LogCategory.AUTH, 'Migration: transferring lightning address', { label, username });
  try {
    const authorization = await from.authorizeLightningAddressTransfer({ transfereePubkey });
    await to.claimLightningAddressTransfer({ authorization, description });
    logger.info(LogCategory.AUTH, 'Migration: lightning address transferred', { label, username });
    return false;
  } catch (e) {
    logger.error(LogCategory.AUTH, 'Migration: lightning address transfer failed', {
      label,
      username,
      error: formatError(e),
    });
    return true;
  }
}

/**
 * Copy contacts from `from` to `to`. Best-effort: per-contact failures and a
 * failed list are logged and skipped, never blocking the migration.
 */
export async function migrateContacts(from: BreezSdk, to: BreezSdk, label: string): Promise<void> {
  try {
    const contacts = await from.listContacts({});
    // Dedupe on paymentIdentifier (the stable natural key): addContact mints a
    // fresh id every call and never dedupes, so without this a retry that
    // replays an already-migrated label would add a second copy of each contact.
    const existing = await to.listContacts({});
    const seen = new Set(existing.map((c) => c.paymentIdentifier.trim().toLowerCase()));
    logger.info(LogCategory.AUTH, 'Migration: migrating contacts', { label, contactCount: contacts.length });
    for (const contact of contacts) {
      const key = contact.paymentIdentifier.trim().toLowerCase();
      if (seen.has(key)) continue;
      try {
        await to.addContact({ name: contact.name, paymentIdentifier: contact.paymentIdentifier });
        seen.add(key);
      } catch (e) {
        logger.warn(LogCategory.AUTH, 'Migration: addContact failed, continuing', {
          label,
          contactId: contact.id,
          contactName: contact.name,
          error: formatError(e),
        });
      }
    }
    logger.info(LogCategory.AUTH, 'Migration: contacts migrated', { label, contactCount: contacts.length });
  } catch (e) {
    logger.warn(LogCategory.AUTH, 'Migration: listContacts failed, skipping contact migration', {
      label,
      error: formatError(e),
    });
  }
}

/** Read the wallet's stable-balance ticker (best-effort), to re-apply on the new wallet. */
export async function captureStableTicker(sdk: BreezSdk, label: string): Promise<string | undefined> {
  try {
    const settings = await sdk.getUserSettings();
    const ticker = settings.stableBalanceActiveLabel ?? undefined;
    logger.info(LogCategory.AUTH, 'Migration: captured primary stable-balance ticker', {
      label,
      activeStableLabel: ticker ?? 'none',
    });
    return ticker;
  } catch (e) {
    logger.warn(LogCategory.AUTH, 'Migration: could not read primary user settings', { label, error: formatError(e) });
    return undefined;
  }
}

/** Apply a stable-balance ticker to the adopted wallet (best-effort). */
export async function applyStableTicker(sdk: BreezSdk, ticker: string): Promise<void> {
  try {
    await sdk.updateUserSettings({ stableBalanceActiveLabel: { type: 'set', label: ticker } });
    logger.info(LogCategory.AUTH, 'Migration: applied stable-balance ticker', { label: ticker });
  } catch (e) {
    logger.warn(LogCategory.AUTH, 'Migration: could not set stable-balance ticker', { label: ticker, error: formatError(e) });
  }
}

// ============================================
// Migration session: rpId-scoped passkey credentials
// ============================================

/**
 * Encapsulates the rpId-scoped legacy + ROR passkey clients and credential
 * pinning for one migration run. A WebAuthn ceremony only matches credentials
 * registered under its RP ID, so the LEGACY-scoped client derives the legacy
 * wallet and the ROR-scoped client the new one. Pinned `allowCredentials`
 * additionally guards a device holding more than one credential under an RP ID.
 */
export interface MigrationSession {
  /** Sign in on LEGACY with no label to discover + order this passkey's labels. */
  enumerateLabels(storedLabel: string): Promise<string[]>;
  /** Derive the legacy wallet seed for a label. */
  deriveLegacySeed(label: string): Promise<Seed>;
  /**
   * True when a prior attempt already created (and persisted) the ROR passkey.
   * The flow must then reuse it via `probeRorCredential` and never create a
   * second one: a duplicate derives a different wallet and would strand funds
   * already swept in the first attempt.
   */
  hasPriorRorCredential(): boolean;
  /** Probe for the recorded ROR credential (resume-safety): captures it, or throws if unreachable. */
  probeRorCredential(): Promise<void>;
  /** Create the single shared ROR passkey (registered under `primaryLabel`). */
  createRorCredential(primaryLabel: string): Promise<void>;
  /** Derive the new (ROR) wallet seed for a label. */
  deriveRorSeed(label: string): Promise<Seed>;
  /** Publish a label under the new ROR Nostr identity. */
  storeRorLabel(label: string): Promise<void>;
  /** Pin the new ROR credential as active + record its metadata. Call only on success. */
  commitRorCredential(): void;
}

export function createMigrationSession(): MigrationSession {
  // Rotating user.name for the ROR register (Apple Passwords dedupes by it).
  const userName = `Glow · ${createPasskeyTimestampLabel()}`;
  let legacyClient: PasskeyClient | null = null;
  let rorClient: PasskeyClient | null = null;
  // Pin every legacy ceremony (including label discovery) to the active passkey,
  // else the first signIn's picker lets a multi-passkey user drift to a different
  // wallet and migrate the wrong one. Null (fresh-browser login, no active cred,
  // or a pin recorded under the ROR RP that can never match a legacy ceremony)
  // falls back to the picker, which is the right way to choose the passkey there.
  let legacyCredId: Uint8Array | undefined = getActivePasskeyCredentialIdBytes(LEGACY_RP_ID) ?? undefined;
  // A prior attempt's ROR credential id (persisted at create time), if any.
  // Seeding rorCredId with it pins the resume probe to that exact passkey.
  const priorRorCredId = getMigrationRorCredentialIdBytes() ?? undefined;
  let rorCredId: Uint8Array | undefined = priorRorCredId;
  let rorCredential: RegisterResponse['credential'] = undefined;
  // The primary label's pinned ROR seed, cached so deriveRorSeed reuses it
  // instead of running another ceremony for that label.
  let rorPrimarySeed: Seed | undefined;
  let rorPrimaryLabel: string | undefined;
  // The default label's legacy seed from label discovery, cached so
  // deriveLegacySeed reuses it for that label.
  let legacyDiscoverySeed: Seed | undefined;
  let legacyDiscoveryLabel: string | undefined;

  const getLegacyClient = () => (legacyClient ??= buildBrowserPasskeyClient({ rpId: LEGACY_RP_ID }));
  const getRorClient = () => (rorClient ??= buildBrowserPasskeyClient({ rpId: ROR_RP_ID as string }));

  function logCeremony(event: string, rpId: string, pinned: boolean, credentialId: Uint8Array | undefined, label?: string) {
    logger.info(LogCategory.AUTH, event, {
      rpId,
      pinned,
      credentialId: credentialId ? bytesToBase64(credentialId) : null,
      label: label ?? null,
    });
  }

  async function legacySignIn(label?: string) {
    const pinned = !!legacyCredId;
    const resp = await getLegacyClient().signIn({
      label,
      allowCredentials: legacyCredId ? [legacyCredId] : [],
    });
    if (resp.credential?.credentialId) legacyCredId = resp.credential.credentialId;
    logCeremony('Migration: legacy ceremony completed', LEGACY_RP_ID, pinned, resp.credential?.credentialId, label);
    return resp;
  }

  async function rorSignIn(label?: string) {
    const pinned = !!rorCredId;
    const resp = await getRorClient().signIn({
      label,
      allowCredentials: rorCredId ? [rorCredId] : [],
    });
    if (resp.credential?.credentialId) rorCredId = resp.credential.credentialId;
    logCeremony('Migration: ROR ceremony completed', ROR_RP_ID as string, pinned, resp.credential?.credentialId, label);
    return resp;
  }

  return {
    hasPriorRorCredential() {
      return rorCredId !== undefined || getMigrationRorCredentialIdBytes() != null;
    },
    async enumerateLabels(storedLabel) {
      const resp = await legacySignIn();
      legacyDiscoverySeed = resp.wallet.seed;
      legacyDiscoveryLabel = resp.wallet.label;
      return orderLabelsForMigration(resp.labels.length > 0 ? resp.labels : [storedLabel], storedLabel);
    },
    async deriveLegacySeed(label) {
      // Reuse the discovery signIn's seed for its label; hand it off once,
      // then drop the session's copy so it does not linger.
      if (label === legacyDiscoveryLabel && legacyDiscoverySeed) {
        const seed = legacyDiscoverySeed;
        legacyDiscoverySeed = undefined;
        legacyDiscoveryLabel = undefined;
        logger.info(LogCategory.AUTH, 'Migration: reusing discovery-derived legacy seed (no ceremony)', { label });
        return seed;
      }
      return (await legacySignIn(label)).wallet.seed;
    },
    async probeRorCredential() {
      const probe = await rorSignIn();
      rorCredential ??= probe.credential;
    },
    async createRorCredential(primaryLabel) {
      // Fresh client carrying the rotating user.name; retained as the ROR client
      // so later per-label derives reuse the new Nostr identity.
      const registerClient = buildBrowserPasskeyClient({
        rpId: ROR_RP_ID as string,
        userName,
        userDisplayName: userName,
      });
      const registration = await registerClient.register({ label: primaryLabel, excludeCredentials: [] });
      rorClient = registerClient;
      rorCredential = registration.credential;
      logCeremony('Migration: ROR passkey created', ROR_RP_ID as string, false, registration.credential?.credentialId, primaryLabel);
      if (!registration.credential?.credentialId) {
        // No credential id: can't pin the destination derive; refuse before any sweep.
        throw new RorSeedVerificationError('platform did not report the created credential id');
      }
      rorCredId = registration.credential.credentialId;
      // Persist now so an interrupted run resumes onto THIS passkey (pinned probe),
      // never a duplicate.
      setMigrationRorCredentialId(registration.credential.credentialId);
      // Pin the destination derive to the created credential: register()'s own
      // derive is unpinned and can bind to another resident passkey, so ignore
      // its returned seed in favor of this pinned one.
      const pinned = await rorSignIn(primaryLabel);
      if (!seedsMatch(pinned.wallet.seed, registration.wallet.seed)) {
        logger.warn(LogCategory.AUTH, 'Migration: register-returned seed differs from the pinned derive; using the pinned wallet', {
          label: primaryLabel,
        });
      }
      rorPrimarySeed = pinned.wallet.seed;
      rorPrimaryLabel = primaryLabel;
    },
    async deriveRorSeed(label) {
      // Reuse the pinned primary seed; hand off once, then drop the session's
      // copy so it does not linger.
      if (label === rorPrimaryLabel && rorPrimarySeed) {
        const seed = rorPrimarySeed;
        rorPrimarySeed = undefined;
        rorPrimaryLabel = undefined;
        logger.info(LogCategory.AUTH, 'Migration: reusing cached primary seed (no ceremony)', { label });
        return seed;
      }
      return (await rorSignIn(label)).wallet.seed;
    },
    async storeRorLabel(label) {
      await getRorClient().labels().store(label);
    },
    commitRorCredential() {
      if (rorCredential && ROR_RP_ID) {
        recordMigratedRorCredential(rorCredential, userName, ROR_RP_ID);
      }
      // Hand the primed, pinned ROR client to the app session so post-migration
      // labels()/store reuse its warm Nostr identity instead of re-deriving on
      // the stale legacy client (which would surface the all-passkeys picker).
      adoptSessionPasskeyClient(getRorClient());
    },
  };
}
