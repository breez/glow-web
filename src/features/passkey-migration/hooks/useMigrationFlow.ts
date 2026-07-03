/**
 * Phase orchestration for the passkey-RP migration (mirrors `useSendPayment`).
 *
 * Owns the phase state machine, the per-phase effects (each thin: call the
 * service, guard cancellation, transition phase), the SDK lifecycle refs +
 * cleanup, and the user actions. All fund-moving / credential work lives in
 * `passkeyMigrationService`; this hook only sequences it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BreezSdk, Seed } from '@breeztech/breez-sdk-spark';
import { logger, LogCategory } from '@/services/logger';
import {
  isMigrationInProgress,
  setMigrationInProgress,
  setPasskeyMigrated,
  clearMigrationRorCredentialId,
} from '@/services/passkeyService';
import { ROR_RP_ID } from '@/services/passkeyPrfProvider';
import {
  createMigrationSession,
  connectForSeed,
  sweepBalances,
  transferLightningAddress,
  migrateContacts,
  captureStableTicker,
  applyStableTicker,
  assertDifferentWallet,
  isNoCredentialError,
  type MigrationSession,
} from '@/services/passkeyMigrationService';
import { formatError } from '@/utils/formatError';
import type { MigrationEntry, MigrationOutcome, MigrationPhase } from '../types';

export interface UseMigrationFlowArgs {
  isOpen: boolean;
  entry: MigrationEntry;
  /** Active legacy SDK, required when `entry === 'banner'` (auto-reconnect already connected it). */
  activeLegacySdk?: BreezSdk | null;
  onClose: (outcome: MigrationOutcome) => void;
  onSwitchToNewWallet: (newSdk: BreezSdk, label: string) => Promise<void>;
}

export interface MigrationFlow {
  phase: MigrationPhase;
  error: string | null;
  unclaimedCount: number;
  confirmedLabels: string[];
  primaryLabel: string;
  isInFlight: boolean;
  spinnerText: string;
  /** At least one label's Lightning address could not be moved (funds are fine). */
  lnAddressTransferFailed: boolean;
  // actions
  startFromBanner: () => void;
  checkForOldPasskey: () => void;
  skipNoOldPasskey: () => void;
  confirmLabels: () => void;
  openUnclaimedDeposits: () => void;
  retry: () => void;
  cancel: () => void;
  done: () => void;
}

export function useMigrationFlow({
  isOpen,
  entry,
  activeLegacySdk,
  onClose,
  onSwitchToNewWallet,
}: UseMigrationFlowArgs): MigrationFlow {
  const [phase, setPhase] = useState<MigrationPhase>('explain');
  const [error, setError] = useState<string | null>(null);
  const [unclaimedCount, setUnclaimedCount] = useState(0);
  const [confirmedLabels, setConfirmedLabels] = useState<string[]>([]);
  // Sweep loop cursor; state so changes re-trigger the sweep-label effect.
  const [currentLabelIndex, setCurrentLabelIndex] = useState(0);
  // Primary label (from localStorage `passkeyLabel` at open time); state so the
  // confirm-labels UI can mark "(current)" without reading a ref during render.
  const [primaryLabel, setPrimaryLabel] = useState('Default');
  // Set if any label's Lightning-address transfer fails; surfaces a Done-screen
  // notice (funds still moved, but incoming LN may land in the old wallet).
  const [lnAddressTransferFailed, setLnAddressTransferFailed] = useState(false);

  // Ordered labels to migrate (primary last); populated in probe / enumerate-labels.
  const labelsToMigrateRef = useRef<string[]>([]);
  // Cached legacy seeds per label, populated by check-deposits-all and reused by
  // sweep-label so we do not re-prompt for the same label.
  const seedCacheRef = useRef<Map<string, Seed>>(new Map());
  // SDKs live during the current phase that may need cleanup.
  const oldSdkRef = useRef<BreezSdk | null>(null);
  const newSdkRef = useRef<BreezSdk | null>(null);
  // The primary new SDK stays alive after the last label so switch can hand it off.
  const primaryNewSdkRef = useRef<BreezSdk | null>(null);
  // Primary label (from localStorage `passkeyLabel` at open time).
  const primaryLabelRef = useRef<string>('Default');
  // Stable-balance ticker of the primary wallet, captured on the last sweep.
  const activeStableLabelRef = useRef<string | undefined>(undefined);
  // The rpId-scoped passkey credential session for this run.
  const sessionRef = useRef<MigrationSession | null>(null);
  // Init guard: run the init effect once per open transition.
  const hasInitializedRef = useRef(false);

  // Latest-ref pattern so the phase effects can call these without listing the
  // (identity-unstable) props in their deps, which would re-trigger async phases.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onSwitchRef = useRef(onSwitchToNewWallet);
  onSwitchRef.current = onSwitchToNewWallet;

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
    setLnAddressTransferFailed(false);
    labelsToMigrateRef.current = [];
    seedCacheRef.current = new Map();
    oldSdkRef.current = null;
    newSdkRef.current = null;
    primaryNewSdkRef.current = null;
    activeStableLabelRef.current = undefined;
    sessionRef.current = createMigrationSession();

    setMigrationInProgress(true);

    const storedLabel = localStorage.getItem('passkeyLabel') ?? 'Default';
    primaryLabelRef.current = storedLabel;
    setPrimaryLabel(storedLabel);

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
  // Phase: probe (login) / enumerate-labels (banner). Both list labels on
  // LEGACY and advance to confirm-labels. Only `probe` treats a deterministic
  // no-credential signal as "genuinely new user" (mark migrated + close); a
  // transient failure must NOT mark migrated, else a funded legacy wallet is
  // stranded.
  // ============================================
  useEffect(() => {
    if (!isOpen || (phase !== 'probe' && phase !== 'enumerate-labels')) return;
    const session = sessionRef.current;
    if (!session) return;
    let cancelled = false;

    (async () => {
      try {
        logger.info(LogCategory.AUTH, 'Migration: listing labels on legacy', { phase });
        const ordered = await session.enumerateLabels(primaryLabelRef.current);
        if (cancelled) return;
        logger.info(LogCategory.AUTH, 'Migration: legacy labels listed', { phase, labelCount: ordered.length });
        labelsToMigrateRef.current = ordered;
        setConfirmedLabels(ordered);
        setPhase('confirm-labels');
      } catch (e) {
        if (cancelled) return;
        if (phase === 'probe' && isNoCredentialError(e)) {
          logger.info(LogCategory.AUTH, 'Migration probe: no legacy credential, proceeding as new user', {
            error: formatError(e),
          });
          setPasskeyMigrated();
          onCloseRef.current('proceed');
          return;
        }
        logger.warn(LogCategory.AUTH, 'Migration: label listing failed, surfacing retry', { phase, error: formatError(e) });
        setError(
          phase === 'probe'
            ? 'Could not check for an existing passkey. Please try again.'
            : 'Could not read your passkey labels. Please try again.',
        );
        setPhase('error');
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, phase]);

  // ============================================
  // Phase: check-deposits-all. Per label: derive seed (cached), connect, sync,
  // count unclaimed deposits. Any deposits => blocked; else => derive-new-passkey.
  // ============================================
  useEffect(() => {
    if (!isOpen || phase !== 'check-deposits-all') return;
    const session = sessionRef.current;
    if (!session) return;
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

          // For banner + primary label, reuse the App-owned activeLegacySdk: it
          // already carries this seed, so skip the legacy derive entirely (it
          // would be one unused passkey ceremony). Other labels and the login
          // path derive + connect from the seed.
          let sdk: BreezSdk;
          let ownedByModal: boolean;
          if (entry === 'banner' && label === primaryLabelRef.current && activeLegacySdk) {
            sdk = activeLegacySdk;
            ownedByModal = false;
          } else {
            let seed = seedCacheRef.current.get(label);
            if (!seed) {
              seed = await session.deriveLegacySeed(label);
              if (cancelled) return;
              seedCacheRef.current.set(label, seed);
            }
            sdk = await connectForSeed(seed);
            if (cancelled) { sdk.disconnect().catch(() => {}); return; }
            ownedByModal = true;
          }

          try {
            const info = await sdk.getInfo({ ensureSynced: true });
            if (cancelled) return;
            const depositCount = (await sdk.listUnclaimedDeposits({})).deposits.length;
            if (cancelled) return;
            logger.info(LogCategory.AUTH, 'Migration check-deposits-all: label state', {
              label,
              identityPubkey: info.identityPubkey,
              balanceSats: info.balanceSats,
              depositCount,
            });
            totalDeposits += depositCount;
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
        logger.error(LogCategory.AUTH, 'Migration check-deposits-all: failed', { error: formatError(e) });
        setError('Could not check your wallets. Please try again.');
        setPhase('error');
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, phase, entry, activeLegacySdk]);

  // ============================================
  // Phase: derive-new-passkey (one-time). Create the single ROR passkey all
  // labels share. Per-label ROR derives happen inside sweep-label.
  // ============================================
  useEffect(() => {
    if (!isOpen || phase !== 'derive-new-passkey') return;
    const session = sessionRef.current;
    if (!session) return;
    let cancelled = false;

    (async () => {
      try {
        if (!ROR_RP_ID) throw new Error('ROR_RP_ID not configured');

        // Resume-safety: a persisted ROR credential id means a prior attempt
        // already created the passkey (possibly after moving some funds). We
        // MUST reuse that exact credential: creating a second one derives a
        // different wallet and would strand the already-swept funds in an
        // orphaned one. So probe pinned to it, and if the probe fails surface a
        // retryable error rather than falling through to create a duplicate. A
        // first attempt (nothing recorded) creates directly, skipping a
        // pointless "Use a saved passkey" prompt.
        if (session.hasPriorRorCredential()) {
          logger.info(LogCategory.AUTH, 'Migration derive-new-passkey: prior ROR credential recorded, reusing it');
          try {
            await session.probeRorCredential();
          } catch (e) {
            if (cancelled) return;
            logger.error(LogCategory.AUTH, 'Migration derive-new-passkey: recorded ROR credential unreachable', {
              error: formatError(e),
            });
            setError('We could not access the passkey from your previous attempt. Please try the passkey prompt again.');
            setPhase('error');
            return;
          }
          if (cancelled) return;
          logger.info(LogCategory.AUTH, 'Migration derive-new-passkey: existing ROR credential confirmed, skipping create');
        } else {
          logger.info(LogCategory.AUTH, 'Migration derive-new-passkey: no prior ROR credential, creating one');
          await session.createRorCredential(primaryLabelRef.current);
          if (cancelled) return;
          logger.info(LogCategory.AUTH, 'Migration derive-new-passkey: passkey created on ROR');
        }

        setCurrentLabelIndex(0);
        setPhase('sweep-label');
      } catch (e) {
        if (cancelled) return;
        logger.error(LogCategory.AUTH, 'Migration derive-new-passkey: failed', { error: formatError(e) });
        setError('Could not create the new passkey. Please try again.');
        setPhase('error');
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, phase]);

  // ============================================
  // Phase: sweep-label (loops via currentLabelIndex). Per label: connect old +
  // new, assert distinct, publish label, sweep funds, transfer LN address,
  // migrate contacts, retain/release SDKs, advance or finish.
  // ============================================
  useEffect(() => {
    if (!isOpen || phase !== 'sweep-label') return;
    const session = sessionRef.current;
    if (!session) return;
    let cancelled = false;

    (async () => {
      const labels = labelsToMigrateRef.current;
      const index = currentLabelIndex;
      if (index >= labels.length) {
        setPhase('switch');
        return;
      }
      const label = labels[index];
      const isLast = index === labels.length - 1;

      logger.info(LogCategory.AUTH, 'Migration sweep-label: starting', { label, index, total: labels.length, isLast });

      let oldSdk: BreezSdk | null = null;
      let oldSdkOwnedByModal = false;
      let newSdk: BreezSdk | null = null;

      try {
        if (!ROR_RP_ID) throw new Error('ROR_RP_ID not configured');

        // 1. Connect the old SDK for this label. The reused active legacy SDK
        // (banner + primary) never derived a seed, so only the connect path
        // needs a cached seed.
        if (entry === 'banner' && label === primaryLabelRef.current && activeLegacySdk) {
          oldSdk = activeLegacySdk;
          oldSdkOwnedByModal = false;
          logger.info(LogCategory.AUTH, 'Migration sweep-label: reusing active legacy SDK', { label });
        } else {
          const seed = seedCacheRef.current.get(label);
          if (!seed) throw new Error(`No cached seed for label "${label}"`);
          oldSdk = await connectForSeed(seed);
          if (cancelled) { oldSdk.disconnect().catch(() => {}); return; }
          oldSdkOwnedByModal = true;
        }
        oldSdkRef.current = oldSdk;

        // 2. Derive the new seed for this label on ROR, then connect the new SDK.
        logger.info(LogCategory.AUTH, 'Migration sweep-label: deriving new seed on ROR', { label });
        const newSeed = await session.deriveRorSeed(label);
        if (cancelled) return;

        newSdk = await connectForSeed(newSeed);
        if (cancelled) { newSdk.disconnect().catch(() => {}); return; }
        newSdkRef.current = newSdk;
        // Sync both wallets right before reading balances: a single fresh-sync
        // point covers every label (including the reused active legacy SDK).
        // Independent reads on separate SDKs, run in parallel to avoid a waterfall.
        const [newInfo, oldInfo] = await Promise.all([
          newSdk.getInfo({ ensureSynced: true }),
          oldSdk.getInfo({ ensureSynced: true }),
        ]);
        if (cancelled) return;
        logger.info(LogCategory.AUTH, 'Migration sweep-label: identities', {
          label,
          oldIdentity: oldInfo.identityPubkey,
          newIdentity: newInfo.identityPubkey,
          oldBalanceSats: oldInfo.balanceSats,
          oldTokenCount: oldInfo.tokenBalances.size,
        });

        // 3. Safety: never migrate a wallet onto itself.
        assertDifferentWallet(oldInfo, newInfo, label);

        // 4. Publish the label under the new passkey's Nostr identity.
        logger.info(LogCategory.AUTH, 'Migration sweep-label: saving label to new Nostr identity', { label });
        await session.storeRorLabel(label);
        if (cancelled) return;

        // 5. Sweep sats + tokens, transfer the Lightning address, migrate contacts.
        await sweepBalances(oldSdk, newSdk, oldInfo, label);
        if (cancelled) return;
        const lnTransferFailed = await transferLightningAddress(oldSdk, newSdk, newInfo.identityPubkey, label);
        if (cancelled) return;
        if (lnTransferFailed) setLnAddressTransferFailed(true);
        await migrateContacts(oldSdk, newSdk, label);
        if (cancelled) return;

        // 6. Retain the primary (last) new SDK for hand-off; release the rest.
        if (isLast) {
          activeStableLabelRef.current = await captureStableTicker(oldSdk, label);
          // Move ownership off newSdkRef so the cleanup effect does not disconnect it.
          primaryNewSdkRef.current = newSdk;
          newSdkRef.current = null;
        } else {
          try { await newSdk.disconnect(); } catch { /* best-effort */ }
          newSdkRef.current = null;
        }

        // 7. Disconnect the old SDK (unless App-owned).
        if (oldSdkOwnedByModal && oldSdk) {
          try { await oldSdk.disconnect(); } catch { /* best-effort */ }
        }
        oldSdkRef.current = null;

        // Drop this label's cached legacy seed now that it is fully swept, so the
        // seed material does not linger in memory for the rest of the migration.
        // A retry re-derives it (one prompt on that rare path).
        seedCacheRef.current.delete(label);

        logger.info(LogCategory.AUTH, 'Migration sweep-label: label complete', { label, isLast });

        // 8. Advance or finish.
        if (isLast) {
          setPhase('switch');
        } else {
          setCurrentLabelIndex(index + 1);
        }
      } catch (e) {
        if (cancelled) return;
        // Best-effort cleanup before surfacing the error.
        if (newSdk && newSdk !== primaryNewSdkRef.current) {
          newSdk.disconnect().catch(() => {});
        }
        if (oldSdk && oldSdkOwnedByModal) {
          oldSdk.disconnect().catch(() => {});
        }
        logger.error(LogCategory.AUTH, 'Migration sweep-label: failed', { label, error: formatError(e) });
        setError(`Could not migrate wallet "${label}". Please try again.`);
        setPhase('error');
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, phase, currentLabelIndex, entry, activeLegacySdk]);

  // ============================================
  // Phase: switch. Apply the stable ticker, pin the ROR credential as active
  // (success only), then hand the primary new SDK to useBreezSdk.
  // ============================================
  useEffect(() => {
    if (!isOpen || phase !== 'switch') return;
    const session = sessionRef.current;
    if (!session) return;
    let cancelled = false;

    (async () => {
      try {
        const primaryNew = primaryNewSdkRef.current;
        if (!primaryNew) throw new Error('No primary new SDK to switch to');

        if (activeStableLabelRef.current) {
          await applyStableTicker(primaryNew, activeStableLabelRef.current);
        }

        // Pin the new ROR credential as active now that migration succeeded
        // (deferred to here so a mid-migration failure never points the active
        // credential at an unusable ROR cred).
        session.commitRorCredential();
        setPasskeyMigrated();
        clearMigrationRorCredentialId();
        logger.info(LogCategory.AUTH, 'Migration switch: handing off primary new SDK to useBreezSdk', {
          label: primaryLabelRef.current,
        });

        // Ownership transfers: do NOT disconnect from here.
        await onSwitchRef.current(primaryNew, primaryLabelRef.current);
        if (cancelled) return;
        primaryNewSdkRef.current = null;
        logger.info(LogCategory.AUTH, 'Migration switch: complete');
        // Stay open on the success step. The adopt handler only swaps the SDK;
        // Done (handleMigrationClose) closes the modal and lands on the wallet.
        setPhase('done');
      } catch (e) {
        if (cancelled) return;
        logger.error(LogCategory.AUTH, 'Migration switch: failed', { error: formatError(e) });
        setError('Migration succeeded but we could not reconnect. Please refresh.');
        setPhase('error');
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, phase]);

  // ============================================
  // Actions
  // ============================================
  const checkForOldPasskey = useCallback(() => {
    logger.info(LogCategory.AUTH, 'Migration: user clicked Continue (login explain)');
    setPhase('probe');
  }, []);

  const skipNoOldPasskey = useCallback(() => {
    logger.info(LogCategory.AUTH, 'Migration: user clicked Skip (no old passkey)');
    setPasskeyMigrated();
    onCloseRef.current('proceed');
  }, []);

  const startFromBanner = useCallback(() => {
    logger.info(LogCategory.AUTH, 'Migration: user clicked Continue (banner explain)');
    setPhase('enumerate-labels');
  }, []);

  const confirmLabels = useCallback(() => {
    logger.info(LogCategory.AUTH, 'Migration: user confirmed labels', { labels: labelsToMigrateRef.current });
    setPhase('check-deposits-all');
  }, []);

  const openUnclaimedDeposits = useCallback(() => {
    logger.info(LogCategory.AUTH, 'Migration: user clicked Open unclaimed deposits');
    onCloseRef.current('handled');
  }, []);

  const done = useCallback(() => {
    logger.info(LogCategory.AUTH, 'Migration: user clicked Done');
    onCloseRef.current('handled');
  }, []);

  const cancel = useCallback(() => {
    logger.info(LogCategory.AUTH, 'Migration: user cancelled', { phase });
    onCloseRef.current('handled');
  }, [phase]);

  const retry = useCallback(() => {
    logger.info(LogCategory.AUTH, 'Migration: user clicked Retry', { entry, labels: labelsToMigrateRef.current.length });
    setError(null);
    setCurrentLabelIndex(0);
    // Re-validate state before sweeping if we already have a label list;
    // otherwise restart from enumeration / explain.
    if (labelsToMigrateRef.current.length > 0) {
      setPhase('check-deposits-all');
    } else if (entry === 'banner') {
      setPhase('enumerate-labels');
    } else {
      setPhase('explain');
    }
  }, [entry]);

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
        const label = confirmedLabels[currentLabelIndex] ?? '';
        if (confirmedLabels.length > 1) {
          return `Migrating "${label}" (${currentLabelIndex + 1} of ${confirmedLabels.length})...`;
        }
        return `Migrating "${label}"...`;
      }
      case 'switch': return 'Finishing up...';
      default: return '';
    }
  })();

  return {
    phase,
    error,
    unclaimedCount,
    confirmedLabels,
    primaryLabel,
    isInFlight,
    spinnerText,
    lnAddressTransferFailed,
    startFromBanner,
    checkForOldPasskey,
    skipNoOldPasskey,
    confirmLabels,
    openUnclaimedDeposits,
    retry,
    cancel,
    done,
  };
}
