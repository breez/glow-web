import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { BreezSdk, Seed, PasskeyClient, RegisterResponse, SignInResponse } from '@breeztech/breez-sdk-spark';
import { connect } from '@breeztech/breez-sdk-spark';
import { DialogContainer, DialogCard } from './ui';
import { PrimaryButton, SecondaryButton } from './ui/buttons';
import LoadingSpinner from './LoadingSpinner';
import { AlertCard } from './AlertCard';
import { PasskeyIcon, AlertTriangleIcon } from './Icons';
import { logger, LogCategory } from '@/services/logger';
import {
  buildMigrationPasskeyClient,
  recordMigratedRorCredential,
  isMigrationInProgress,
  setMigrationInProgress,
  setPasskeyMigrated,
  isPasskeyMigrationStarted,
  setPasskeyMigrationStarted,
  clearPasskeyMigrationStarted,
} from '@/services/passkeyService';
import {
  LEGACY_RP_ID,
  ROR_RP_ID,
  createPasskeyTimestampLabel,
} from '@/services/passkeyPrfProvider';
import { buildConnectConfig } from '@/hooks/buildConnectConfig';

type Phase =
  | 'explain'
  | 'probe'                    // login only — listLabels on LEGACY (captures labels)
  | 'enumerate-labels'         // banner only — listLabels on LEGACY (prompt)
  | 'confirm-labels'           // show list + count, user confirms
  | 'check-deposits-all'       // per-label: getWallet, connect, ensureSynced, listUnclaimedDeposits
  | 'blocked-deposits'         // one or more labels have unclaimed deposits
  | 'derive-new-passkey'       // createPasskey on ROR (one-time)
  | 'sweep-label'              // per-label loop body: connect both, save, sweep, ln-address
  | 'switch'                   // adopt primary (last/active) new SDK
  | 'done'
  | 'error';

export type MigrationEntry = 'banner' | 'login';

/** Outcome reported back to the caller when the modal closes. */
export type MigrationOutcome =
  /** User chose "No old passkey" or probe found none. Caller may proceed with a fresh ROR passkey. */
  | 'proceed'
  /** Migration completed (caller should do nothing — App has taken over), OR user cancelled. */
  | 'handled';

export interface PasskeyMigrationModalProps {
  isOpen: boolean;
  entry: MigrationEntry;
  /** Active legacy SDK — required when `entry === 'banner'` (auto-reconnect already connected it). */
  activeLegacySdk?: BreezSdk | null;
  onClose: (outcome: MigrationOutcome) => void;
  /**
   * Invoked when the migration completes. The caller should adopt the provided
   * (already connected + synced) new SDK as the active wallet. The modal will
   * NOT disconnect `newSdk` after calling this — ownership is transferred.
   */
  onSwitchToNewWallet: (newSdk: BreezSdk, label: string) => Promise<void>;
}

/**
 * Order labels so the "primary" (currently active per localStorage `passkeyLabel`,
 * or 'Default' as a fallback) is migrated LAST. Other labels keep relative order.
 * The last-migrated new SDK is the one we adopt for the active session.
 */
function orderLabelsForMigration(labels: string[], storedLabel: string): string[] {
  if (labels.length === 0) return [];
  let primary: string | undefined = labels.find((l) => l === storedLabel);
  if (!primary) primary = labels.find((l) => l === 'Default');
  if (!primary) primary = labels[labels.length - 1];
  const others = labels.filter((l) => l !== primary);
  return [...others, primary];
}

const PasskeyMigrationModal: React.FC<PasskeyMigrationModalProps> = ({
  isOpen,
  entry,
  activeLegacySdk,
  onClose,
  onSwitchToNewWallet,
}) => {
  const [phase, setPhase] = useState<Phase>('explain');
  const [error, setError] = useState<string | null>(null);
  const [unclaimedCount, setUnclaimedCount] = useState(0);
  const [confirmedLabels, setConfirmedLabels] = useState<string[]>([]);
  // Sweep loop cursor — state so changes re-trigger the sweep-label effect.
  const [currentLabelIndex, setCurrentLabelIndex] = useState(0);

  // Ordered list of labels to migrate (primary last). Populated in probe / enumerate-labels.
  const labelsToMigrateRef = useRef<string[]>([]);
  // Cached legacy seeds per label — populated by check-deposits-all, reused by sweep-label
  // so we don't re-prompt the user for the same label.
  const seedCacheRef = useRef<Map<string, Seed>>(new Map());
  // SDK references that are live during the current phase and may need cleanup.
  const oldSdkRef = useRef<BreezSdk | null>(null);
  const newSdkRef = useRef<BreezSdk | null>(null);
  // The "primary" new SDK — stays alive after sweep-label finishes the last label
  // so switch can hand it off to useBreezSdk.
  const primaryNewSdkRef = useRef<BreezSdk | null>(null);
  // Primary label name (from localStorage `passkeyLabel` at open time).
  const primaryLabelRef = useRef<string>('Default');
  // Stable-balance ticker of the primary (active) wallet — captured during sweep-label
  // on the last iteration and applied to the primary new SDK in switch.
  const activeStableLabelRef = useRef<string | undefined>(undefined);

  // Init guard: only run the init effect once per open transition.
  const hasInitializedRef = useRef(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onSwitchRef = useRef(onSwitchToNewWallet);
  onSwitchRef.current = onSwitchToNewWallet;

  // rpId-scoped passkey clients for the migration, built lazily and reused so
  // each RP's Nostr identity + credential is established once. This replaces
  // the old mutable `passkeyPrfProvider.setRpId(...)` calls: a WebAuthn
  // ceremony only matches credentials registered under its RP ID, so a
  // LEGACY-scoped client derives the legacy wallet and a ROR-scoped client the
  // new one. The pinned `allowCredentials` additionally guards the case where
  // a device holds more than one credential under the same RP ID.
  const legacyClientRef = useRef<PasskeyClient | null>(null);
  const rorClientRef = useRef<PasskeyClient | null>(null);
  const legacyCredIdRef = useRef<Uint8Array | undefined>(undefined);
  const rorCredIdRef = useRef<Uint8Array | undefined>(undefined);
  // Full ROR credential from register(), recorded as active only on success.
  const rorCredentialRef = useRef<RegisterResponse['credential']>(undefined);
  // Rotating user.name for the ROR register (Apple Passwords dedupes by it).
  const migrationUserNameRef = useRef<string>('');

  const legacySignIn = useCallback(async (label?: string): Promise<SignInResponse> => {
    legacyClientRef.current ??= buildMigrationPasskeyClient(LEGACY_RP_ID);
    const resp = await legacyClientRef.current.signIn({
      label,
      allowCredentials: legacyCredIdRef.current ? [legacyCredIdRef.current] : [],
    });
    if (resp.credential?.credentialId) legacyCredIdRef.current = resp.credential.credentialId;
    return resp;
  }, []);

  const rorSignIn = useCallback(async (label?: string): Promise<SignInResponse> => {
    rorClientRef.current ??= buildMigrationPasskeyClient(ROR_RP_ID as string);
    const resp = await rorClientRef.current.signIn({
      label,
      allowCredentials: rorCredIdRef.current ? [rorCredIdRef.current] : [],
    });
    if (resp.credential?.credentialId) rorCredIdRef.current = resp.credential.credentialId;
    return resp;
  }, []);

  // ============================================
  // Init
  // ============================================
  useEffect(() => {
    if (!isOpen) return;
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    setError(null);
    setUnclaimedCount(0);
    setConfirmedLabels([]);
    setCurrentLabelIndex(0);
    labelsToMigrateRef.current = [];
    seedCacheRef.current = new Map();
    oldSdkRef.current = null;
    newSdkRef.current = null;
    primaryNewSdkRef.current = null;
    activeStableLabelRef.current = undefined;
    legacyClientRef.current = null;
    rorClientRef.current = null;
    legacyCredIdRef.current = undefined;
    rorCredIdRef.current = undefined;
    rorCredentialRef.current = undefined;
    migrationUserNameRef.current = `Glow · ${createPasskeyTimestampLabel()}`;

    setMigrationInProgress(true);

    const storedLabel = localStorage.getItem('passkeyLabel') ?? 'Default';
    primaryLabelRef.current = storedLabel;

    logger.info(LogCategory.AUTH, 'Migration modal opened', {
      entry,
      storedLabel,
      hasActiveLegacySdk: !!activeLegacySdk,
      rorConfigured: !!ROR_RP_ID,
    });

    if (entry === 'banner' && !activeLegacySdk) {
      logger.error(LogCategory.AUTH, 'Migration modal opened from banner without active legacy SDK');
      setError('Wallet not connected. Please refresh and try again.');
      setPhase('error');
      return;
    }

    setPhase('explain');
  }, [isOpen, entry, activeLegacySdk]);

  // ============================================
  // Cleanup on close / unmount
  // ============================================
  useEffect(() => {
    if (!isOpen) {
      hasInitializedRef.current = false;
      if (isMigrationInProgress()) setMigrationInProgress(false);
      // Disconnect any SDKs we own. The App-owned `activeLegacySdk` is NOT ours to disconnect.
      if (newSdkRef.current) {
        newSdkRef.current.disconnect().catch(() => {});
        newSdkRef.current = null;
      }
      if (oldSdkRef.current && oldSdkRef.current !== (activeLegacySdk ?? null)) {
        oldSdkRef.current.disconnect().catch(() => {});
      }
      oldSdkRef.current = null;
      // primaryNewSdkRef has been handed off to useBreezSdk by the time close runs;
      // do NOT disconnect it here. Just drop our reference.
      primaryNewSdkRef.current = null;
      seedCacheRef.current = new Map();
    }
  }, [isOpen, activeLegacySdk]);

  // Phase trace
  useEffect(() => {
    if (!isOpen) return;
    logger.info(LogCategory.AUTH, 'Migration phase', { phase, entry });
  }, [phase, isOpen, entry]);

  // ============================================
  // Phase: probe (login only)
  //
  // Calls listLabels() on LEGACY. Success => capture labels and proceed. Cancel /
  // no-credential => this is a genuinely new user, mark migrated and close.
  // ============================================
  useEffect(() => {
    if (!isOpen || phase !== 'probe') return;
    let cancelled = false;

    (async () => {
      try {
        logger.info(LogCategory.AUTH, 'Migration probe: listing labels on legacy', { rpId: LEGACY_RP_ID });
        const labels = (await legacySignIn()).labels;
        if (cancelled) return;
        logger.info(LogCategory.AUTH, 'Migration probe: legacy credential found', {
          labelCount: labels.length,
        });

        const ordered = orderLabelsForMigration(labels.length > 0 ? labels : [primaryLabelRef.current], primaryLabelRef.current);
        labelsToMigrateRef.current = ordered;
        setConfirmedLabels(ordered);
        setPhase('confirm-labels');
      } catch (e) {
        if (cancelled) return;
        logger.info(LogCategory.AUTH, 'Migration probe: no legacy credential (or cancelled), proceeding as new user', {
          error: e instanceof Error ? e.message : String(e),
        });
        setPasskeyMigrated();
        onCloseRef.current('proceed');
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, phase, legacySignIn]);

  // ============================================
  // Phase: enumerate-labels (banner only)
  //
  // Legacy SDK is already active but we don't know what other labels exist yet.
  // Call listLabels() to discover them. This costs one WebAuthn prompt on LEGACY.
  // ============================================
  useEffect(() => {
    if (!isOpen || phase !== 'enumerate-labels') return;
    let cancelled = false;

    (async () => {
      try {
        logger.info(LogCategory.AUTH, 'Migration enumerate-labels: listing labels on legacy', { rpId: LEGACY_RP_ID });
        const labels = (await legacySignIn()).labels;
        if (cancelled) return;
        logger.info(LogCategory.AUTH, 'Migration enumerate-labels: labels listed', {
          labelCount: labels.length,
        });

        const ordered = orderLabelsForMigration(
          labels.length > 0 ? labels : [primaryLabelRef.current],
          primaryLabelRef.current,
        );
        labelsToMigrateRef.current = ordered;
        setConfirmedLabels(ordered);
        setPhase('confirm-labels');
      } catch (e) {
        if (cancelled) return;
        logger.error(LogCategory.AUTH, 'Migration enumerate-labels: failed', {
          error: e instanceof Error ? e.message : String(e),
        });
        setError('Could not read your passkey labels. Please try again.');
        setPhase('error');
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, phase, legacySignIn]);

  // ============================================
  // Phase: check-deposits-all
  //
  // For each label: derive legacy seed (WebAuthn prompt), connect temporary SDK,
  // ensureSynced, listUnclaimedDeposits, disconnect. If ANY label has unclaimed
  // deposits, go to blocked-deposits. Otherwise advance to derive-new-passkey.
  //
  // Seeds are cached into seedCacheRef so sweep-label doesn't need to prompt again.
  // ============================================
  useEffect(() => {
    if (!isOpen || phase !== 'check-deposits-all') return;
    let cancelled = false;

    (async () => {
      const labels = labelsToMigrateRef.current;
      if (labels.length === 0) {
        setError('No labels to migrate.');
        setPhase('error');
        return;
      }

      try {
        let totalDeposits = 0;

        for (const label of labels) {
          if (cancelled) return;
          logger.info(LogCategory.AUTH, 'Migration check-deposits-all: processing label', { label });

          // Derive seed (or reuse cache if we've been through this label before).
          let seed = seedCacheRef.current.get(label);
          if (!seed) {
            const wallet = (await legacySignIn(label)).wallet;
            if (cancelled) return;
            seed = wallet.seed;
            seedCacheRef.current.set(label, seed);
          }

          // For banner + primary label, we can reuse the App-owned activeLegacySdk
          // (same seed) to avoid a redundant connect.
          let sdk: BreezSdk;
          let ownedByModal: boolean;
          if (entry === 'banner' && label === primaryLabelRef.current && activeLegacySdk) {
            sdk = activeLegacySdk;
            ownedByModal = false;
          } else {
            const cfg = buildConnectConfig();
            sdk = await connect({ config: cfg, seed, storageDir: 'spark-wallet-example' });
            if (cancelled) { sdk.disconnect().catch(() => {}); return; }
            ownedByModal = true;
          }

          try {
            const info = await sdk.getInfo({ ensureSynced: true });
            if (cancelled) return;
            const deposits = await sdk.listUnclaimedDeposits({});
            if (cancelled) return;
            logger.info(LogCategory.AUTH, 'Migration check-deposits-all: label state', {
              label,
              identityPubkey: info.identityPubkey,
              balanceSats: info.balanceSats,
              depositCount: deposits.deposits.length,
            });
            totalDeposits += deposits.deposits.length;
          } finally {
            if (ownedByModal) {
              await sdk.disconnect().catch(() => {});
            }
          }
        }

        if (cancelled) return;

        if (totalDeposits > 0) {
          setUnclaimedCount(totalDeposits);
          setPhase('blocked-deposits');
        } else {
          setPhase('derive-new-passkey');
        }
      } catch (e) {
        if (cancelled) return;
        logger.error(LogCategory.AUTH, 'Migration check-deposits-all: failed', {
          error: e instanceof Error ? e.message : String(e),
        });
        setError('Could not check your wallets. Please try again.');
        setPhase('error');
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, phase, entry, activeLegacySdk, legacySignIn]);

  // ============================================
  // Phase: derive-new-passkey (one-time)
  //
  // Creates the single ROR passkey that all labels will share. `getWallet(label)`
  // for each label happens inside sweep-label (per-label prompt).
  // ============================================
  useEffect(() => {
    if (!isOpen || phase !== 'derive-new-passkey') return;
    let cancelled = false;

    (async () => {
      try {
        if (!ROR_RP_ID) throw new Error('ROR_RP_ID not configured');

        // Resume-safety: only probe for an existing ROR credential if we might have
        // created one in a prior attempt. On first attempts we skip the probe so the
        // user doesn't see a pointless "Use a saved passkey" WebAuthn prompt to cancel.
        let alreadyHaveRorCredential = false;
        if (isPasskeyMigrationStarted()) {
          logger.info(LogCategory.AUTH, 'Migration derive-new-passkey: prior attempt detected, probing for existing ROR credential');
          try {
            const probe = await rorSignIn();
            rorCredentialRef.current ??= probe.credential;
            alreadyHaveRorCredential = true;
            logger.info(LogCategory.AUTH, 'Migration derive-new-passkey: existing ROR credential detected, skipping create');
          } catch (e) {
            logger.info(LogCategory.AUTH, 'Migration derive-new-passkey: no existing ROR credential despite prior attempt', {
              reason: e instanceof Error ? e.message : String(e),
            });
          }
          if (cancelled) return;
        } else {
          logger.info(LogCategory.AUTH, 'Migration derive-new-passkey: first attempt, creating ROR passkey directly');
        }

        if (!alreadyHaveRorCredential) {
          setPasskeyMigrationStarted();
          // Fresh client carrying the rotating user.name; retained as the ROR
          // client so later per-label derives reuse the new Nostr identity.
          const registerClient = buildMigrationPasskeyClient(ROR_RP_ID, {
            userName: migrationUserNameRef.current,
            userDisplayName: migrationUserNameRef.current,
          });
          const reg = await registerClient.register({
            label: primaryLabelRef.current,
            excludeCredentials: [],
          });
          if (cancelled) return;
          rorClientRef.current = registerClient;
          rorCredentialRef.current = reg.credential;
          if (reg.credential?.credentialId) rorCredIdRef.current = reg.credential.credentialId;
          logger.info(LogCategory.AUTH, 'Migration derive-new-passkey: passkey created on ROR');
        }

        setCurrentLabelIndex(0);
        setPhase('sweep-label');
      } catch (e) {
        if (cancelled) return;
        logger.error(LogCategory.AUTH, 'Migration derive-new-passkey: failed', {
          error: e instanceof Error ? e.message : String(e),
        });
        setError('Could not create the new passkey. Please try again.');
        setPhase('error');
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, phase, rorSignIn]);

  // ============================================
  // Phase: sweep-label (loops via currentLabelIndex increments)
  //
  // Per-label body:
  //   1. Connect old SDK for this label (reuse activeLegacySdk on banner-primary, else fresh connect)
  //   2. Derive new seed for this label on ROR (WebAuthn prompt)
  //   3. Connect new SDK, ensureSynced
  //   4. Identity-safety assertion
  //   5. saveLabel on ROR (WebAuthn prompt — writes label under new Nostr identity)
  //   6. Sweep spark balance
  //   7. Sweep each token balance
  //   8. Sync new SDK so tokens appear
  //   9. Migrate Lightning address (delete on old, register on new)
  //   10. Migrate contacts (list on old, addContact on new — best-effort)
  //   11. If last label: capture stable-balance ticker + retain newSdk as primary.
  //       Else: disconnect newSdk.
  //   12. Disconnect old SDK (unless App-owned).
  //   13. Advance cursor OR move to `switch`.
  // ============================================
  useEffect(() => {
    if (!isOpen || phase !== 'sweep-label') return;
    let cancelled = false;

    (async () => {
      const labels = labelsToMigrateRef.current;
      const i = currentLabelIndex;
      if (i >= labels.length) {
        setPhase('switch');
        return;
      }
      const label = labels[i];
      const isLast = i === labels.length - 1;

      logger.info(LogCategory.AUTH, 'Migration sweep-label: starting', {
        label,
        index: i,
        total: labels.length,
        isLast,
      });

      let old: BreezSdk | null = null;
      let oldOwnedByModal = false;
      let newSdk: BreezSdk | null = null;

      try {
        if (!ROR_RP_ID) throw new Error('ROR_RP_ID not configured');

        // 1. Connect old SDK for this label.
        const seed = seedCacheRef.current.get(label);
        if (!seed) throw new Error(`No cached seed for label "${label}"`);

        if (entry === 'banner' && label === primaryLabelRef.current && activeLegacySdk) {
          old = activeLegacySdk;
          oldOwnedByModal = false;
          logger.info(LogCategory.AUTH, 'Migration sweep-label: reusing active legacy SDK', { label });
        } else {
          const cfg = buildConnectConfig();
          old = await connect({ config: cfg, seed, storageDir: 'spark-wallet-example' });
          if (cancelled) { old.disconnect().catch(() => {}); return; }
          oldOwnedByModal = true;
          await old.getInfo({ ensureSynced: true });
          if (cancelled) return;
        }
        oldSdkRef.current = old;

        // 2. Derive new seed for this label on ROR.
        logger.info(LogCategory.AUTH, 'Migration sweep-label: deriving new seed on ROR', { label });
        const newWallet = (await rorSignIn(label)).wallet;
        if (cancelled) return;

        // 3. Connect new SDK.
        const newCfg = buildConnectConfig();
        newSdk = await connect({
          config: newCfg,
          seed: newWallet.seed,
          storageDir: 'spark-wallet-example',
        });
        if (cancelled) { newSdk.disconnect().catch(() => {}); return; }
        newSdkRef.current = newSdk;
        const newInfo = await newSdk.getInfo({ ensureSynced: true });
        if (cancelled) return;

        const oldInfo = await old.getInfo({});
        if (cancelled) return;
        logger.info(LogCategory.AUTH, 'Migration sweep-label: identities', {
          label,
          oldIdentity: oldInfo.identityPubkey,
          newIdentity: newInfo.identityPubkey,
          oldBalanceSats: oldInfo.balanceSats,
          oldTokenCount: oldInfo.tokenBalances.size,
        });

        // 4. Identity safety.
        if (newInfo.identityPubkey === oldInfo.identityPubkey) {
          throw new Error(`Migration target for label "${label}" is the same wallet — aborting.`);
        }

        // 5. Publish the label under the new passkey's Nostr identity.
        logger.info(LogCategory.AUTH, 'Migration sweep-label: saving label to new Nostr identity', { label });
        rorClientRef.current ??= buildMigrationPasskeyClient(ROR_RP_ID);
        await rorClientRef.current.labels().store(label);
        if (cancelled) return;

        // 6. Sweep spark balance.
        const receiveResp = await newSdk.receivePayment({ paymentMethod: { type: 'sparkAddress' } });
        const sparkAddress = receiveResp.paymentRequest;
        if (cancelled) return;

        if (oldInfo.balanceSats > 0) {
          logger.info(LogCategory.PAYMENT, 'Migration sweep-label: sending Spark balance', {
            label,
            sats: oldInfo.balanceSats,
          });
          const prepareResp = await old.prepareSendPayment({
            paymentRequest: sparkAddress,
            amount: BigInt(oldInfo.balanceSats),
            feePolicy: 'feesIncluded',
          });
          if (cancelled) return;
          await old.sendPayment({ prepareResponse: prepareResp });
          if (cancelled) return;
          logger.info(LogCategory.PAYMENT, 'Migration sweep-label: Spark balance swept', {
            label,
            sats: oldInfo.balanceSats,
          });
        }

        // 7. Sweep tokens.
        let anyTokensSwept = false;
        for (const [tokenId, tokenBalance] of oldInfo.tokenBalances) {
          if (cancelled) return;
          if (tokenBalance.balance <= 0n) continue;
          logger.info(LogCategory.PAYMENT, 'Migration sweep-label: sending token', {
            label,
            tokenId,
            amount: tokenBalance.balance.toString(),
          });
          const prepareResp = await old.prepareSendPayment({
            paymentRequest: sparkAddress,
            amount: tokenBalance.balance,
            tokenIdentifier: tokenId,
          });
          if (cancelled) return;
          await old.sendPayment({ prepareResponse: prepareResp });
          if (cancelled) return;
          anyTokensSwept = true;
        }

        // 8. Sync new SDK so received tokens show up.
        if (anyTokensSwept || oldInfo.balanceSats > 0) {
          try {
            await newSdk.syncWallet({});
          } catch (e) {
            logger.warn(LogCategory.PAYMENT, 'Migration sweep-label: new SDK sync failed (non-fatal)', {
              label,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          if (cancelled) return;
        }

        // 9. Migrate Lightning address (best-effort).
        let oldLn: Awaited<ReturnType<BreezSdk['getLightningAddress']>> = undefined;
        try {
          oldLn = await old.getLightningAddress();
        } catch (e) {
          logger.warn(LogCategory.AUTH, 'Migration sweep-label: getLightningAddress failed', {
            label,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        if (cancelled) return;

        if (oldLn) {
          const { username, description } = oldLn;
          logger.info(LogCategory.AUTH, 'Migration sweep-label: transferring lightning address', { label, username });
          try {
            // Atomic, symmetric two-signature transfer: the old wallet (current
            // owner) authorizes handing the username to the new wallet's
            // identity pubkey, and the new wallet claims it. No window where the
            // address is unregistered (unlike delete-then-register); the SDK
            // also rejects a self-transfer, already guarded by the identity
            // assertion above.
            const authorization = await old.authorizeLightningAddressTransfer({
              transfereePubkey: newInfo.identityPubkey,
            });
            if (cancelled) return;
            await newSdk.claimLightningAddressTransfer({ authorization, description });
            logger.info(LogCategory.AUTH, 'Migration sweep-label: lightning address transferred', { label, username });
          } catch (e) {
            // Best-effort — do not block migration. Log loudly so username is recoverable from logs.
            logger.error(LogCategory.AUTH, 'Migration sweep-label: lightning address transfer failed', {
              label,
              username,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          if (cancelled) return;
        }

        // 10. Migrate contacts (best-effort).
        try {
          const contacts = await old.listContacts({});
          if (cancelled) return;
          logger.info(LogCategory.AUTH, 'Migration sweep-label: migrating contacts', {
            label,
            contactCount: contacts.length,
          });
          for (const contact of contacts) {
            if (cancelled) return;
            try {
              await newSdk.addContact({
                name: contact.name,
                paymentIdentifier: contact.paymentIdentifier,
              });
            } catch (e) {
              // Per-contact failures shouldn't abort the migration. Log and continue.
              logger.warn(LogCategory.AUTH, 'Migration sweep-label: addContact failed, continuing', {
                label,
                contactId: contact.id,
                contactName: contact.name,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
          logger.info(LogCategory.AUTH, 'Migration sweep-label: contacts migrated', {
            label,
            contactCount: contacts.length,
          });
        } catch (e) {
          logger.warn(LogCategory.AUTH, 'Migration sweep-label: listContacts failed, skipping contact migration', {
            label,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        if (cancelled) return;

        // 11. Retain or release the new SDK.
        if (isLast) {
          // Capture stable-balance ticker for the primary wallet only.
          try {
            const oldSettings = await old.getUserSettings();
            activeStableLabelRef.current = oldSettings.stableBalanceActiveLabel ?? undefined;
            logger.info(LogCategory.AUTH, 'Migration sweep-label: captured primary stable-balance ticker', {
              label,
              activeStableLabel: activeStableLabelRef.current ?? 'none',
            });
          } catch (e) {
            logger.warn(LogCategory.AUTH, 'Migration sweep-label: could not read primary user settings', {
              label,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          // Keep newSdk alive for switch hand-off. Move ownership off newSdkRef so the
          // cleanup effect doesn't disconnect it.
          primaryNewSdkRef.current = newSdk;
          newSdkRef.current = null;
        } else {
          // Disconnect the non-primary new SDK; we're done with it.
          try { await newSdk.disconnect(); } catch { /* best-effort */ }
          newSdkRef.current = null;
        }

        // 11. Disconnect old SDK (unless it's App-owned; let useBreezSdk handle that one).
        if (oldOwnedByModal && old) {
          try { await old.disconnect(); } catch { /* best-effort */ }
        }
        oldSdkRef.current = null;

        logger.info(LogCategory.AUTH, 'Migration sweep-label: label complete', { label, isLast });

        // 12. Advance or finish.
        if (isLast) {
          setPhase('switch');
        } else {
          setCurrentLabelIndex(i + 1);
        }
      } catch (e) {
        if (cancelled) return;
        // Best-effort cleanup before surfacing error.
        if (newSdk && newSdk !== primaryNewSdkRef.current) {
          newSdk.disconnect().catch(() => {});
        }
        if (old && oldOwnedByModal) {
          old.disconnect().catch(() => {});
        }
        logger.error(LogCategory.AUTH, 'Migration sweep-label: failed', {
          label,
          error: e instanceof Error ? e.message : String(e),
        });
        setError(`Could not migrate wallet "${label}". Please try again.`);
        setPhase('error');
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, phase, currentLabelIndex, entry, activeLegacySdk, rorSignIn]);

  // ============================================
  // Phase: switch
  // ============================================
  useEffect(() => {
    if (!isOpen || phase !== 'switch') return;
    let cancelled = false;

    (async () => {
      try {
        const primaryNew = primaryNewSdkRef.current;
        if (!primaryNew) throw new Error('No primary new SDK to switch to');

        // Apply stable-balance ticker to the primary new SDK.
        if (activeStableLabelRef.current) {
          try {
            await primaryNew.updateUserSettings({
              stableBalanceActiveLabel: { type: 'set', label: activeStableLabelRef.current },
            });
            logger.info(LogCategory.AUTH, 'Migration switch: applied stable-balance ticker', {
              label: activeStableLabelRef.current,
            });
          } catch (e) {
            logger.warn(LogCategory.AUTH, 'Migration switch: could not set stable-balance ticker', {
              label: activeStableLabelRef.current,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        // Pin the new ROR credential as active now that migration succeeded
        // (deferred to here so a mid-migration failure never points the active
        // credential at an unusable ROR cred). Also stores AAGUID/BE/user.name
        // metadata, sets passkeyRegistered, and registers the cred for the
        // per-credential management UI.
        if (rorCredentialRef.current && ROR_RP_ID) {
          recordMigratedRorCredential(rorCredentialRef.current, migrationUserNameRef.current, ROR_RP_ID);
        }
        setPasskeyMigrated();
        clearPasskeyMigrationStarted();
        logger.info(LogCategory.AUTH, 'Migration switch: handing off primary new SDK to useBreezSdk', {
          label: primaryLabelRef.current,
        });

        // Ownership transfers — do NOT disconnect from here.
        await onSwitchRef.current(primaryNew, primaryLabelRef.current);
        if (cancelled) return;
        primaryNewSdkRef.current = null;
        logger.info(LogCategory.AUTH, 'Migration switch: complete');
        setPhase('done');
      } catch (e) {
        if (cancelled) return;
        logger.error(LogCategory.AUTH, 'Migration switch: failed', {
          error: e instanceof Error ? e.message : String(e),
        });
        setError('Migration succeeded but we could not reconnect. Please refresh.');
        setPhase('error');
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, phase]);

  // ============================================
  // Handlers
  // ============================================

  const handleCheckForOldPasskey = () => {
    logger.info(LogCategory.AUTH, 'Migration: user clicked Continue (login explain)');
    setPhase('probe');
  };
  const handleNoOldPasskey = () => {
    logger.info(LogCategory.AUTH, 'Migration: user clicked Skip (no old passkey)');
    setPasskeyMigrated();
    onCloseRef.current('proceed');
  };
  const handleStartMigrationFromBanner = () => {
    logger.info(LogCategory.AUTH, 'Migration: user clicked Continue (banner explain)');
    setPhase('enumerate-labels');
  };
  const handleConfirmLabels = () => {
    logger.info(LogCategory.AUTH, 'Migration: user confirmed labels', {
      labels: labelsToMigrateRef.current,
    });
    setPhase('check-deposits-all');
  };

  const handleOpenUnclaimedDeposits = useCallback(() => {
    logger.info(LogCategory.AUTH, 'Migration: user clicked Open unclaimed deposits');
    onCloseRef.current('handled');
  }, []);

  const handleDone = useCallback(() => {
    logger.info(LogCategory.AUTH, 'Migration: user clicked Done');
    onCloseRef.current('handled');
  }, []);

  const handleCancel = useCallback(() => {
    logger.info(LogCategory.AUTH, 'Migration: user cancelled', { phase });
    onCloseRef.current('handled');
  }, [phase]);

  const handleRetry = useCallback(() => {
    logger.info(LogCategory.AUTH, 'Migration: user clicked Retry', { entry, labels: labelsToMigrateRef.current.length });
    setError(null);
    setCurrentLabelIndex(0);
    // If we already have a label list, jump back to the deposits check so we
    // re-validate state before sweeping. Otherwise, start from the enumeration step.
    if (labelsToMigrateRef.current.length > 0) {
      setPhase('check-deposits-all');
    } else if (entry === 'banner') {
      setPhase('enumerate-labels');
    } else {
      setPhase('explain');
    }
  }, [entry]);

  // ============================================
  // Render
  // ============================================

  if (!isOpen) return null;

  const isInFlight =
    phase === 'probe' ||
    phase === 'enumerate-labels' ||
    phase === 'check-deposits-all' ||
    phase === 'derive-new-passkey' ||
    phase === 'sweep-label' ||
    phase === 'switch';

  const spinnerText = (() => {
    switch (phase) {
      case 'probe': return 'Checking for passkey...';
      case 'enumerate-labels': return 'Reading your labels...';
      case 'check-deposits-all': return 'Checking your wallets...';
      case 'derive-new-passkey': return 'Creating new passkey...';
      case 'sweep-label': {
        const labels = labelsToMigrateRef.current;
        const i = currentLabelIndex;
        const label = labels[i] ?? '';
        if (labels.length > 1) {
          return `Migrating "${label}" (${i + 1} of ${labels.length})...`;
        }
        return `Migrating "${label}"...`;
      }
      case 'switch': return 'Finishing up...';
      default: return '';
    }
  })();

  return (
    <DialogContainer>
      <DialogCard maxWidth="sm">
        {/* Header */}
        <div className="text-center mb-4">
          <div className="flex justify-center mb-3">
            <div className="w-14 h-14 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
              <PasskeyIcon size="xl" className="text-spark-primary" />
            </div>
          </div>
          <h2 className="font-display text-lg font-bold text-spark-text-primary">
            {entry === 'login' ? 'Check passkey' : 'Upgrade passkey'}
          </h2>
        </div>

        {/* Body */}
        {phase === 'explain' && entry === 'banner' && (
          <>
            <p className="text-sm text-spark-text-secondary mb-4">
              Your passkey needs upgrading. We'll create a new passkey and move your funds over automatically. You'll be asked to authenticate a few times along the way.
            </p>
            <div className="flex flex-col gap-3">
              <PrimaryButton onClick={handleStartMigrationFromBanner}>
                Continue
              </PrimaryButton>
              <SecondaryButton onClick={handleCancel}>
                Not now
              </SecondaryButton>
            </div>
          </>
        )}

        {phase === 'explain' && entry === 'login' && (
          <>
            <p className="text-sm text-spark-text-secondary mb-4">
              Your passkey might need upgrading. If you created a passkey with a previous version of Glow, we'll move your funds over to a new one automatically. If this is your first time, choose <em>Skip</em> to continue.
            </p>
            <div className="flex flex-col gap-3">
              <PrimaryButton onClick={handleCheckForOldPasskey}>
                Continue
              </PrimaryButton>
              <SecondaryButton onClick={handleNoOldPasskey}>
                Skip
              </SecondaryButton>
            </div>
          </>
        )}

        {phase === 'confirm-labels' && (
          <>
            <p className="text-sm text-spark-text-secondary mb-3">
              We found {confirmedLabels.length} wallet{confirmedLabels.length === 1 ? '' : 's'} on your legacy passkey. Each one will be migrated to a new passkey.
            </p>
            <div className="bg-spark-surface rounded-xl p-3 mb-3">
              <ul className="space-y-1">
                {confirmedLabels.map((label) => (
                  <li key={label} className="text-sm text-spark-text-primary font-mono flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-spark-primary" />
                    {label}
                    {label === primaryLabelRef.current && (
                      <span className="text-xs text-spark-text-muted">(current)</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-spark-text-muted mb-4">
              You'll be asked to authenticate several times — once per wallet for the legacy passkey, plus a couple more for the new one. Please keep this window open until it's done.
            </p>
            <div className="flex flex-col gap-3">
              <PrimaryButton onClick={handleConfirmLabels}>
                Continue
              </PrimaryButton>
              <SecondaryButton onClick={handleCancel}>
                Not now
              </SecondaryButton>
            </div>
          </>
        )}

        {phase === 'blocked-deposits' && (
          <>
            <AlertCard variant="warning" title="Unclaimed deposits">
              <p className="text-sm text-spark-text-secondary">
                You have {unclaimedCount} unclaimed deposit{unclaimedCount === 1 ? '' : 's'} across your wallets. Please resolve {unclaimedCount === 1 ? 'it' : 'them'} before upgrading. You can come back and try again once done.
              </p>
            </AlertCard>
            <div className="flex flex-col gap-3 mt-4">
              <PrimaryButton onClick={handleOpenUnclaimedDeposits}>
                Open unclaimed deposits
              </PrimaryButton>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <AlertCard variant="error" title="Migration failed">
              <p className="text-sm text-spark-text-secondary">
                {error ?? 'Something went wrong.'}
              </p>
            </AlertCard>
            <div className="flex flex-col gap-3 mt-4">
              <PrimaryButton onClick={handleRetry}>Retry</PrimaryButton>
              <SecondaryButton onClick={handleCancel}>Cancel</SecondaryButton>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <p className="text-sm text-spark-text-secondary mb-4 text-center">
              Your passkey has been upgraded and your funds have been moved over.
            </p>
            <div className="flex flex-col gap-3">
              <PrimaryButton onClick={handleDone}>Done</PrimaryButton>
            </div>
          </>
        )}

        {isInFlight && (
          <div className="flex flex-col items-center justify-center py-6">
            <LoadingSpinner text={spinnerText} />
            <div className="mt-3 flex items-center justify-center gap-2 text-xs text-amber-400/80">
              <AlertTriangleIcon size="xs" />
              <span>Keep this window open</span>
            </div>
          </div>
        )}

        {!isInFlight && phase !== 'explain' && phase !== 'confirm-labels' && phase !== 'error' && phase !== 'done' && phase !== 'blocked-deposits' && (
          <button
            onClick={handleCancel}
            className="mt-4 w-full text-sm text-spark-text-muted hover:text-spark-text-secondary transition-colors"
          >
            Cancel
          </button>
        )}
      </DialogCard>
    </DialogContainer>
  );
};

export default PasskeyMigrationModal;
