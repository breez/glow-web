import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Seed, Wallet } from '@breeztech/breez-sdk-spark';
import { PrimaryButton, SecondaryButton, Checkbox } from '../components/ui';
import LoadingSpinner from '../components/LoadingSpinner';
import PageLayout from '../components/layout/PageLayout';
import { AlertCard } from '../components/AlertCard';
import { NostrKeyIcon, CheckIcon, PasskeyIcon } from '../components/Icons';
import {
  getPasskey,
  getKnownCredentialIdsBase64,
  hasPasskeyHistory,
  clearPasskeyHistory,
  listLabels,
  saveLabel,
  setPasskeyMode,
  consumePendingSwitchFromCredentialId,
  recordRegisteredCredential,
  recordSignedInCredential,
  removeStaleCredential,
} from '@/services/passkeyService';
import {
  PasskeyAlreadyExistsError,
  PasskeyCredentialNotFoundError,
  PasskeyTimedOutError,
  createPasskeyTimestampLabel,
  supportsImmediateGet,
} from '@/services/passkeyPrfProvider';

import { logger, LogCategory } from '@/services/logger';
import { shareOrDownloadLogs } from '@/services/logExport';
import { useLatest } from '../hooks/useLatest';

/**
 * Phase state machine. AASA gates both paths; detecting drives the
 * returning-vs-new branch.
 *
 *   New user:     detecting → review → creating → connecting → new-storing → initializing
 *   Returning:    detecting → auth-pick → connecting → initializing
 *                 (an `auth-pick` of a new label inserts new-storing before connecting)
 */
type Phase =
  | 'aasa-checking'
  | 'aasa-error'
  | 'detecting'
  | 'review'
  | 'creating'
  | 'new-storing'
  | 'auth-pick'
  | 'connecting'
  | 'initializing';

interface PasskeyPageProps {
  onWalletRestored: (seed: Seed, label: string) => void;
  onBack: () => void;
  sdkConnected?: boolean;
  /**
   * True while `secureStorage.storeSeed` is in flight during
   * onboarding so the `initializing` phase can swap "Starting Glow…"
   * for "Setting up biometric unlock…". iOS effectively never sees
   * this (SecAccessControl gates retrieval only); Android's
   * CryptoObject path blocks at the sensor and surfaces it.
   */
  isSecuringSeed?: boolean;
  onFlowComplete?: () => void;
  /** Skip discovery; start the create flow directly. */
  skipDetection?: boolean;
  /**
   * Returns true once on a fresh install / device restore (set by
   * `useBreezSdk`'s iCloud-keychain probe). Allows one silent retry
   * of `detecting` while the synced credential records propagate.
   */
  consumeFreshInstallSignal?: () => boolean;
}

// 5s under the OS's ~60s WebAuthn inactivity ceiling: anything past
// this is overwhelmingly an OS-timeout teardown rather than a real
// user dismiss, and we surface that via timeout-specific copy.
const LIKELY_TIMEOUT_MS = 55_000;

function isLikelyTimeout(elapsedMs: number): boolean {
  return elapsedMs >= LIKELY_TIMEOUT_MS;
}

const PasskeyPage: React.FC<PasskeyPageProps> = ({
  onWalletRestored,
  onBack,
  sdkConnected,
  isSecuringSeed,
  onFlowComplete,
  skipDetection = false,
  consumeFreshInstallSignal,
}) => {
  // Post-AASA transition branches on `skipDetection`: straight to
  // 'creating' for the Create CTA, 'detecting' for Use Passkey.
  const [phase, setPhase] = useState<Phase>('aasa-checking');
  const [isNewUser, setIsNewUser] = useState(skipDetection);
  const [labels, setLabels] = useState<string[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Drives a short generic AlertCard title plus kind-specific footer
  // recovery actions (e.g. "Sign in with passkey" for already-exists).
  const [errorKind, setErrorKind] = useState<
    null | 'generic' | 'already-exists' | 'sign-in-failed' | 'sign-in-cancelled' | 'switch-recovery'
  >(null);
  // The cred the user tried to switch to. When the switch fails on
  // web (where dismissed-picker is indistinguishable from deleted-cred),
  // the recovery UI offers an "I deleted this passkey" checkbox that
  // routes to removeStaleCredential on Continue. Native sees a typed
  // deletion signal and auto-removes upstream, so this stays null there.
  const [failingSwitchCredId, setFailingSwitchCredId] = useState<string | null>(null);
  const [confirmedStaleRemoval, setConfirmedStaleRemoval] = useState(false);
  const [manualLabel, setManualLabel] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  // Mirrors HomePage's two-CTA gate. On browsers without
  // immediateGet the user got separate Use Existing / Create CTAs on
  // HomePage; surfacing inline-Create on a sign-in failure here
  // contradicts their explicit choice, so we send them back to home.
  const [immediateGetSupported, setImmediateGetSupported] = useState<boolean | null>(null);
  // Drives the spinner-label swap from "Detecting passkey…" to
  // "Discovering labels…" once the WebAuthn assertion completes.
  const [isDiscoveringLabels, setIsDiscoveringLabels] = useState(false);
  // Verbatim NotAssociated details surfaced on the AASA error screen
  // so maintainers see which CDN failed and why.
  const [aasaFailure, setAasaFailure] = useState<
    { source: string; reason: string } | null
  >(null);

  const onWalletRestoredRef = useLatest(onWalletRestored);
  const onFlowCompleteRef = useLatest(onFlowComplete);

  const connectLabelRef = useRef<string | undefined>(undefined);
  /**
   * What 'connecting' should do:
   *   'setup'           PasskeyClient.register (create + derive + publish)
   *   'derive-only'     PasskeyClient.signIn for an already-published label
   *   'use-speculative' reuse the wallet pre-derived during detecting
   */
  const connectActionRef = useRef<'setup' | 'derive-only' | 'use-speculative'>('derive-only');
  const speculativeWalletRef = useRef<Wallet | null>(null);

  // First-failure-only silent retry budget. Only fires when this
  // PasskeyPage opened during the post-fresh-install window where
  // iCloud Keychain might still be syncing the actual passkey records.
  const detectingFailCountRef = useRef(0);
  const isFreshInstallRef = useRef<boolean>(false);
  useEffect(() => {
    isFreshInstallRef.current = consumeFreshInstallSignal?.() ?? false;
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SDK finished connecting → complete flow.
  useEffect(() => {
    if (sdkConnected && phase === 'initializing') {
      onFlowCompleteRef.current?.();
    }
  }, [sdkConnected, phase, onFlowCompleteRef]);

  useEffect(() => {
    let cancelled = false;
    supportsImmediateGet().then((supported) => {
      if (!cancelled) setImmediateGetSupported(supported);
    });
    return () => { cancelled = true; };
  }, []);

  // checkAvailability collapses PRF support + domain-association
  // verification into one tagged value. Only NotAssociated blocks
  // (with the concrete reason surfaced on aasa-error); Available
  // and Skipped both proceed.
  useEffect(() => {
    if (phase !== 'aasa-checking') return;
    let cancelled = false;

    const run = async () => {
      let availability;
      try {
        availability = await getPasskey().checkAvailability();
      } catch (e) {
        // Documented to never throw; defensive fallback treats it as
        // a pass so the app doesn't hard-stop on a diagnostic check.
        if (cancelled) return;
        logger.warn(LogCategory.AUTH, 'checkAvailability threw (unexpected)', {
          error: e instanceof Error ? e.message : String(e),
        });
        setPhase(skipDetection ? 'creating' : 'detecting');
        return;
      }

      if (cancelled) return;

      if (availability.type === 'notAssociated') {
        setAasaFailure({ source: availability.source, reason: availability.reason });
        setPhase('aasa-error');
        return;
      }

      setAasaFailure(null);
      setPhase(skipDetection ? 'creating' : 'detecting');
    };

    run();
    return () => { cancelled = true; };
  }, [phase, skipDetection]);

  // Discovery: speculative signIn('Default') doubles as the passkey
  // detection probe. Branches: empty labels => publish 'Default' +
  // connect; one label => derive (if not Default) + connect; many =>
  // label picker. On failure, returning users stay on detecting with
  // a retry; first-timers route to the create flow.
  useEffect(() => {
    if (phase !== 'detecting') return;
    let cancelled = false;

    // A missing credential surfaces as CredentialNotFound from the
    // SDK; the discovery flow below catches it and routes to create.
    // Pending WebAuthn ceremonies outlive route changes (no
    // AbortSignal slot), so a back-pressed prompt is the user's to
    // dismiss from the OS UI.

    // Wall-clock the assertion so a cancel-shaped error can be
    // disambiguated against the no-creds case on platforms that
    // collapse both into the same code (web NotAllowedError; iOS
    // sub-300ms fast-fail). A sub-threshold elapsed time means no
    // UI rendered, so we route silently to create.
    const detectStartMs = Date.now();
    const run = async () => {
      try {
        // Dual-salt assert 'Default' BEFORE listLabels so a user
        // whose label IS 'Default' completes restore in one prompt.
        // signIn (not register) avoids a stray label publish for
        // returning users on non-default labels.
        const speculativeResponse = await getPasskey().signIn({
          label: 'Default',
          allowCredentials: [],
        });
        const speculative = speculativeResponse.wallet;
        recordSignedInCredential(speculativeResponse.credential?.credentialId);
        if (cancelled) return;
        // PRF succeeded: clear any in-flight switch-from slot so a
        // later unrelated sign-in failure can't misfire recovery.
        consumePendingSwitchFromCredentialId();
        speculativeWalletRef.current = speculative;

        setIsDiscoveringLabels(true);
        const found = await listLabels();
        if (cancelled) return;

        if (found.length === 0) {
          connectLabelRef.current = 'Default';
          await saveLabel('Default');
          if (cancelled) return;
          connectActionRef.current = 'use-speculative';
          setPhase('connecting');
        } else if (found.length === 1) {
          setLabels(found);
          connectLabelRef.current = found[0];
          if (found[0] === 'Default') {
            connectActionRef.current = 'use-speculative';
          } else {
            connectActionRef.current = 'derive-only';
            speculativeWalletRef.current = null;
          }
          setPhase('connecting');
        } else {
          // Display oldest → newest. Speculative stays cached for the
          // case the user picks 'Default' from the picker.
          const sorted = [...found].reverse();
          setLabels(sorted);
          const defaultIdx = sorted.indexOf('Default');
          setSelectedLabel(defaultIdx !== -1 ? sorted[defaultIdx] : sorted[0]);
          setPhase('auth-pick');
        }
      } catch (e) {
        if (cancelled) return;
        // SDK preserves typed PasskeyCredentialNotFoundError /
        // PasskeyTimedOutError / PasskeyAlreadyExistsError; cancel
        // has no typed class (WebAuthn collapses cancel / lockout /
        // no-cred / timeout into one NotAllowedError on web), so we
        // fall back to .code (native bridge) and .name / .message.
        const errorName = e instanceof Error ? e.name : '';
        const errorMessage = e instanceof Error ? e.message : '';
        const errorCode = (e as { code?: string })?.code;
        const messageLooksCancelled = /cancel{1,2}ed|cancellation/i.test(errorMessage);
        const isCancelled = errorName === 'NotAllowedError' || errorName === 'AbortError'
          || errorCode === 'USER_CANCELLED'
          || messageLooksCancelled;
        const isCredentialNotFound = e instanceof PasskeyCredentialNotFoundError
          || errorCode === 'CREDENTIAL_NOT_FOUND'
          || errorMessage.includes('Credential not found')
          || errorMessage.includes('no credentials')
          || errorMessage.includes('No credentials')
          || errorMessage.includes('empty allowCredentials');
        const elapsedMs = Date.now() - detectStartMs;
        const FAST_FAIL_MAX_MS = 300;
        // Per-platform fast-fail dispatch (no UI rendered = OS
        // deterministically has no matching cred). Android raises
        // NoCredentialException (reliable on its own). iOS conflates
        // no-cred and cancel into USER_CANCELLED so elapsed time is
        // the only disambiguator. Web's NotAllowedError has no fast
        // silent path; the slow-path branches below handle it.
        const platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web';
        let isFastFailNoCred = false;
        if (elapsedMs < FAST_FAIL_MAX_MS) {
          if (platform === 'android') isFastFailNoCred = isCredentialNotFound;
          else if (platform === 'ios') isFastFailNoCred = isCancelled;
        }
        if (hasPasskeyHistory()) {
          if (isFastFailNoCred) {
            if (detectingFailCountRef.current === 0 && isFreshInstallRef.current) {
              // Fresh-install sync gap: 3s retry budget covers
              // iCloud Keychain stage-2 / Block Store sync before
              // we assume deletion.
              detectingFailCountRef.current = 1;
              logger.info(LogCategory.AUTH, 'Fast no-cred on fresh install, silent retry', {
                errorCode,
                isCredentialNotFound,
                isCancelled,
                elapsedMs,
              });
              setTimeout(() => {
                if (cancelled) return;
                setPhase('aasa-checking');
              }, 3000);
              return;
            }
            // Switch-recovery: only the failing cred's metadata is
            // dropped, the previous active cred is restored. Without
            // this we'd wipe the entire known list and lose every
            // other cred's AAGUID / user.name on a single deletion.
            const restoreCredId = consumePendingSwitchFromCredentialId();
            if (restoreCredId) {
              const failingCredId = localStorage.getItem('passkeyActiveCredentialId');
              logger.warn(LogCategory.AUTH, 'Switch target not found, restoring previous active cred', {
                failingCredId,
                restoredCredId: restoreCredId,
                errorCode,
                elapsedMs,
              });
              if (failingCredId) {
                await removeStaleCredential(failingCredId);
              }
              localStorage.setItem('passkeyActiveCredentialId', restoreCredId);
              if (cancelled) return;
              setError("That passkey is no longer on this device.");
              setErrorKind('switch-recovery');
              return;
            }
            logger.warn(LogCategory.AUTH, 'Fast no-cred on returning user, treating as Settings deletion', {
              errorCode,
              isCredentialNotFound,
              isCancelled,
              elapsedMs,
            });
            await clearPasskeyHistory();
            if (cancelled) return;
            setError(
              'Your Glow passkey is no longer on this device. You can create a new one.',
            );
            setErrorKind('sign-in-failed');
            setPhase('review');
            return;
          }
          if (isCredentialNotFound) {
            // Slow CREDENTIAL_NOT_FOUND = user saw a UI and dismissed.
            // The cred is still on the device; auto-clearing would
            // lure a duplicate. Stay on detecting with a retryable error.
            logger.warn(LogCategory.AUTH, 'Slow CREDENTIAL_NOT_FOUND on returning user, surfacing retryable error');
            setError(
              'Could not find your Glow passkey on this device. Try again, or check Settings → Passwords.',
            );
            setErrorKind('sign-in-failed');
            return;
          }
          // Fresh-install first-failure silent retry: 3s heuristic
          // pause bridging the iCloud Keychain stage-2 sync gap. Keep
          // the spinner label as "Detecting passkey…" through it.
          if (detectingFailCountRef.current === 0 && isFreshInstallRef.current) {
            detectingFailCountRef.current = 1;
            logger.info(LogCategory.AUTH, 'Sign-in failed on first attempt, retrying silently', {
              errorName,
              errorCode,
            });
            setTimeout(() => {
              if (cancelled) return;
              setPhase('aasa-checking');
            }, 3000);
            return;
          }
          // Web switch-recovery: NotAllowedError can't distinguish a
          // dismissed picker from a deleted cred. Revert the active
          // pin to the previously-signed-in cred and ask the user to
          // confirm deletion before dropping the failing metadata.
          if (!Capacitor.isNativePlatform()) {
            const restoreCredId = consumePendingSwitchFromCredentialId();
            if (restoreCredId) {
              const failingCredId = localStorage.getItem('passkeyActiveCredentialId');
              logger.warn(LogCategory.AUTH, 'Web switch ceremony failed, reverting active pin', {
                failingCredId,
                restoredCredId: restoreCredId,
                errorCode,
                elapsedMs,
              });
              localStorage.setItem('passkeyActiveCredentialId', restoreCredId);
              if (cancelled) return;
              setFailingSwitchCredId(failingCredId);
              setConfirmedStaleRemoval(false);
              setError("Could not sign in with that passkey. It may have been removed, or the prompt was cancelled.");
              setErrorKind('switch-recovery');
              return;
            }
          }
          // Returning user, second failure: surface a retryable
          // error rather than silently falling to creation.
          const underlying = e instanceof Error ? e.message : String(e);
          console.error('[Glow] Sign-in failed', { errorName, errorCode, error: underlying, raw: e });
          logger.warn(LogCategory.AUTH, 'Sign-in failed for returning user, NOT auto-registering', {
            errorName,
            errorCode,
            error: underlying,
            elapsedMs,
          });
          setError(
            isCancelled
              ? (isLikelyTimeout(elapsedMs)
                ? 'Sign-in timed out. Please try again.'
                : 'Sign-in cancelled. Please try again.')
              : `Could not sign in with your passkey. ${underlying ? `[${underlying}]` : ''} Please try again.`,
          );
          setErrorKind('sign-in-failed');
          return;
        }
        // First-time user routing precedence:
        //   1. CredentialNotFound → silent fall-through to create.
        //   2. iOS sub-300ms cancel → conflated no-cred; same path.
        //   3. Slow cancel → user dismissed a sheet (they have creds);
        //      retryable error, no Create offer.
        //   4. Anything else → generic error with retry + Create
        //      escape hatch.
        if (isCredentialNotFound) {
          logger.info(LogCategory.AUTH, 'No existing passkey (deterministic), starting new user flow', { errorCode });
          setIsNewUser(true);
          setPhase('creating');
          return;
        }
        if (isCancelled && elapsedMs < FAST_FAIL_MAX_MS) {
          logger.info(LogCategory.AUTH, 'Fast cancel implies no creds, starting new user flow', {
            errorName,
            errorCode,
            elapsedMs,
          });
          setIsNewUser(true);
          setPhase('creating');
          return;
        }
        if (isCancelled) {
          // Native fast-fail no-creds was already routed silently.
          // A slow cancel means the user has a passkey and dismissed
          // the picker, so we refuse to offer Create. Web can't
          // distinguish no-creds from a hybrid-sheet dismiss (Chrome's
          // `uiMode: 'immediate'` surfaces the QR sheet whenever a
          // hybrid-paired device exists), so the web branch lets the
          // render decide via the two-CTA gate.
          if (Capacitor.isNativePlatform()) {
            logger.info(LogCategory.AUTH, 'User dismissed passkey sheet (native); refusing to offer Create', {
              errorCode,
              elapsedMs,
            });
            setError(
              isLikelyTimeout(elapsedMs)
                ? 'Sign-in timed out. Please try again.'
                : 'Sign-in cancelled. Please pick your passkey to continue.',
            );
            setErrorKind('sign-in-cancelled');
          } else {
            logger.info(LogCategory.AUTH, 'Web cancel-shaped failure; surfacing error with retry + escape', {
              errorCode,
              elapsedMs,
            });
            setError(
              isLikelyTimeout(elapsedMs)
                ? 'Sign-in timed out. Please try again.'
                : 'Could not sign in. Please try again.',
            );
            setErrorKind(null);
          }
          return;
        }
        logger.info(LogCategory.AUTH, 'Sign-in failed; surfacing retryable error', {
          errorName,
          errorCode,
          elapsedMs,
        });
        setError('Could not sign in with your passkey. Please try again.');
        setErrorKind(null);
      }
    };

    run();
    return () => {
      cancelled = true;
      // Re-entry into detecting starts at "Detecting passkey…" rather
      // than the prior attempt's "Discovering labels…".
      setIsDiscoveringLabels(false);
    };
  }, [phase]);

  // New user: transition phase that anchors the `renderCreating`
  // spinner. The SDK's `register` collapses create + derive +
  // label-publish into one ceremony in 'connecting' with
  // `connectActionRef.current = 'setup'`; PasskeyAlreadyExistsError
  // and cancel handling live there.
  useEffect(() => {
    if (phase !== 'creating' || error) return;
    connectLabelRef.current = 'Default';
    connectActionRef.current = 'setup';
    setPhase('connecting');
  }, [phase, error]);

  // Save label to Nostr relays (prompt)
  useEffect(() => {
    if (phase !== 'new-storing' || error) return;
    let cancelled = false;

    const run = async () => {
      try {
        const labelToSave = connectLabelRef.current ?? 'Default';
        await saveLabel(labelToSave);
        if (cancelled) return;
        logger.info(LogCategory.AUTH, 'Label saved to relays');
        // Defer setPasskeyMode until connecting succeeds; otherwise a
        // refresh before onboarding completes would auto-reconnect.
        // Mirror the new label into auth-pick so Go Back is consistent.
        setLabels(prev => prev.includes(labelToSave) ? prev : [...prev, labelToSave]);
        setSelectedLabel(labelToSave);
        setShowManualInput(false);
        setManualLabel('');
        setPhase('connecting');
      } catch (e) {
        if (cancelled) return;
        setError('Failed to save label to Nostr');
        setErrorKind('generic');
        logger.error(LogCategory.AUTH, 'Failed to save label', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    };

    run();
    return () => { cancelled = true; };
  }, [phase, error]);

  // Connect: produce the wallet, dispatched on `connectActionRef`.
  useEffect(() => {
    if (phase !== 'connecting' || error) return;
    let cancelled = false;

    const run = async () => {
      const connectStartMs = Date.now();
      try {
        const action = connectActionRef.current;
        const label = connectLabelRef.current;
        let w: Wallet;
        if (action === 'use-speculative') {
          const cached = speculativeWalletRef.current;
          if (!cached) {
            throw new Error('use-speculative selected but no cached wallet');
          }
          w = cached;
        } else if (action === 'setup') {
          // register() collapses create + derive + label-publish into
          // one ceremony. userId is provider-minted (fresh random 16
          // bytes per call) and never host-supplied. Rotate user.name
          // per call so Apple Passwords doesn't dedupe siblings by
          // `(rpId, user.name)`.
          const userName = `Glow · ${createPasskeyTimestampLabel()}`;
          // Exclude creds already on this device so the authenticator
          // refuses a second Glow passkey (one per device per RP). A
          // match raises PasskeyAlreadyExistsError, handled in the catch.
          const excludeCredentials = await getPasskey().credentials().get();
          const response = await getPasskey().register({
            label,
            excludeCredentials,
            userName,
            userDisplayName: userName,
          });
          recordRegisteredCredential(response.credential, userName);
          w = response.wallet;
        } else {
          const response = await getPasskey().signIn({
            label,
            allowCredentials: [],
          });
          recordSignedInCredential(response.credential?.credentialId);
          w = response.wallet;
        }
        if (cancelled) return;
        logger.info(LogCategory.AUTH, 'Passkey wallet derived', { action });

        // Mirror the just-published label into the picker so Go Back
        // doesn't show a stale list.
        if (action === 'setup') {
          const labelToSave = label ?? 'Default';
          setLabels(prev => prev.includes(labelToSave) ? prev : [...prev, labelToSave]);
          setSelectedLabel(labelToSave);
          setShowManualInput(false);
          setManualLabel('');
        }

        if (label) {
          setPasskeyMode(label);
        }

        setPhase('initializing');
        onWalletRestoredRef.current(w.seed, w.label);
      } catch (e) {
        if (cancelled) return;
        const action = connectActionRef.current;
        const underlying = e instanceof Error ? e.message : String(e);
        const elapsedMs = Date.now() - connectStartMs;
        // Setup-path 'already exists' anchors back to 'creating' to
        // hit the already-exists render branch. Android Chrome's
        // Credential Manager swallows InvalidStateError into a generic
        // string, so we heuristic-recover when the device has
        // registered creds.
        if (action === 'setup') {
          const errMsg = underlying;
          const known = await getKnownCredentialIdsBase64();
          const hasKnownCreds = known.length > 0;
          const looksLikeAndroidDupRefusal = !Capacitor.isNativePlatform()
            && /credential manager/i.test(errMsg)
            && hasKnownCreds;
          if (e instanceof PasskeyAlreadyExistsError || looksLikeAndroidDupRefusal) {
            logger.info(LogCategory.AUTH, 'Register flow detected existing passkey, surfacing already-exists state', {
              heuristic: !(e instanceof PasskeyAlreadyExistsError),
            });
            localStorage.setItem('passkeyRegistered', '1');
            setIsNewUser(false);
            detectingFailCountRef.current = 0;
            setPhase('creating');
            setError('You already have a Glow passkey on this device. Use it to sign in.');
            setErrorKind('already-exists');
            return;
          }
        }
        // PasskeyTimedOutError covers the OS inactivity timeout
        // (~60s); cancel falls back to .code / .name / message
        // heuristics (no typed class).
        const errorName = e instanceof Error ? e.name : '';
        const errorMessage = e instanceof Error ? e.message : '';
        const errorCode = (e as { code?: string })?.code;
        const messageLooksCancelled = /cancel{1,2}ed|cancellation/i.test(errorMessage);
        const isTimedOut = e instanceof PasskeyTimedOutError;
        const isCancelled = !isTimedOut && (
          errorCode === 'USER_CANCELLED'
          || errorName === 'NotAllowedError'
          || errorName === 'AbortError'
          || messageLooksCancelled
        );
        console.error('[Glow] Connect failed', { error: underlying, errorCode, elapsedMs, raw: e });
        if (isTimedOut || (isCancelled && isLikelyTimeout(elapsedMs))) {
          setError('Sign-in timed out. Please try again.');
        } else if (isCancelled) {
          setError('Sign-in cancelled. Please try again.');
        } else {
          setError(`Failed to connect. ${underlying ? `[${underlying}]` : ''}`);
        }
        setErrorKind('generic');
        logger.error(LogCategory.AUTH, 'Passkey wallet restore failed', {
          error: underlying,
          errorCode,
          elapsedMs,
        });
      }
    };

    run();
    return () => { cancelled = true; };
  }, [phase, error, onWalletRestoredRef]);

  /** Clear error to re-trigger the current phase's effect. */
  const handleRetry = () => {
    setError(null);
    setErrorKind(null);
  };

  /** Navigate back from an error state to the previous interactive phase. */
  const handleErrorBack = () => {
    setError(null);
    setErrorKind(null);
    switch (phase) {
      case 'creating':
        onBack();
        break;
      case 'new-storing':
      case 'connecting':
        // Returning users go back to the label picker; new users
        // have nothing interactive past the create ceremony.
        if (isNewUser) onBack();
        else setPhase('auth-pick');
        break;
      default:
        onBack();
    }
  };

  const renderReview = () => (
    <>
      <div className="flex justify-center mb-4">
        <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
          <PasskeyIcon size="xl" className="text-spark-primary" />
        </div>
      </div>

      <div className="text-center mb-4">
        <h2 className="text-xl font-display font-bold text-spark-text-primary mb-2">
          Create your passkey
        </h2>
        <p className="text-spark-text-secondary">
          A passkey will be created on your device to secure your funds.
        </p>
      </div>

      <AlertCard variant="warning" title="Your passkey is how you access your funds">
        <p className="text-spark-text-secondary text-sm">
          Deleting your passkey from your device, browser, or password manager may make your funds permanently inaccessible.
        </p>
      </AlertCard>

      <div className="flex-1" />
    </>
  );


  const renderAuthPick = () => {
    const trimmedManual = manualLabel.trim();
    const isDuplicate = trimmedManual
      ? labels.some((l) => l.toLowerCase() === trimmedManual.toLowerCase())
      : false;

    return (
      <>
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
            <NostrKeyIcon size="xl" className="text-spark-primary" />
          </div>
        </div>

        <div className="text-center mb-4">
          <h2 className="text-xl font-display font-bold text-spark-text-primary mb-2">
            Select a label
          </h2>
          <p className="text-spark-text-secondary text-sm">
            Select an existing label or create a new one to connect with.
          </p>
        </div>

        <div className="space-y-2">
          {labels.map((label) => (
            <button
              key={label}
              onClick={() => {
                setSelectedLabel(label);
                setManualLabel('');
                setShowManualInput(false);
              }}
              className={`
                w-full p-4 rounded-2xl border text-left transition-all
                ${selectedLabel === label && !showManualInput
                  ? 'bg-spark-primary/10 border-spark-primary'
                  : 'bg-spark-dark border-spark-border hover:border-spark-border-light'
                }
              `}
            >
              <div className="flex items-center justify-between">
                <span className="font-display font-medium text-spark-text-primary">
                  {label}
                </span>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${selectedLabel === label && !showManualInput ? 'bg-spark-primary' : 'bg-transparent'}`}>
                  {selectedLabel === label && !showManualInput && (
                    <CheckIcon size="sm" className="text-white" />
                  )}
                </div>
              </div>
            </button>
          ))}

          {/* Create new label */}
          {!showManualInput ? (
            <button
              type="button"
              onClick={() => setShowManualInput(true)}
              className="w-full p-4 rounded-2xl border bg-spark-dark border-spark-border hover:border-spark-border-light text-left transition-all"
            >
              <span className="text-sm font-medium text-spark-text-secondary">
                Create a new label...
              </span>
            </button>
          ) : (
            <div className="w-full p-4 rounded-2xl border transition-all bg-spark-primary/10 border-spark-primary">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-spark-text-secondary">
                  Create a new label
                </span>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${trimmedManual && !isDuplicate ? 'bg-spark-primary' : 'bg-transparent'}`}>
                  {trimmedManual && !isDuplicate && (
                    <CheckIcon size="sm" className="text-white" />
                  )}
                </div>
              </div>
              <input
                type="text"
                value={manualLabel}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/^[a-zA-Z0-9 ]*$/.test(val) && val.length <= 24) {
                    setManualLabel(val);
                  }
                }}
                placeholder="Label name"
                maxLength={24}
                className="w-full bg-spark-surface rounded-xl px-3 py-2 text-spark-text-primary placeholder:text-spark-text-muted focus:outline-hidden focus:ring-2 focus:ring-spark-primary/50 text-sm"
                autoFocus
              />
              {isDuplicate && (
                <p className="text-red-400 text-xs mt-1">
                  A label with this name already exists
                </p>
              )}
            </div>
          )}
        </div>
      </>
    );
  };

  const renderSpinner = (text?: string) => (
    <div className="flex flex-col items-center justify-center py-16">
      <LoadingSpinner text={text} />
    </div>
  );

  // Surfaces NotAssociated source + reason verbatim so users can
  // report the diagnostic and maintainers can fix the right side
  // (CDN propagation, assetlinks.json, bundle-ID entry).
  const renderAasaError = () => (
    // w-full + min-w-0 keep long unbroken diagnostic tokens (URLs,
    // delegate_permission/common.get_login_creds) from widening the
    // flex parent and making the page horizontally scrollable on mobile.
    <div className="w-full min-w-0 max-w-xl mx-auto space-y-4 py-8">
      <div className="flex justify-center mb-6">
        <div className="p-4 rounded-full bg-red-500/10">
          <PasskeyIcon size="lg" className="text-red-500" />
        </div>
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold text-spark-text-primary">
          Passkey verification failed
        </h2>
        <p className="text-spark-text-secondary">
          This device can't complete a passkey ceremony until the app's
          domain configuration is recognized.
        </p>
      </div>
      {aasaFailure && (
        <AlertCard variant="warning" title="Diagnostic details">
          {/* break-all is required here: wrap-break-word only splits at
              word boundaries and can't break tokens like
              `delegate_permission/common.get_login_creds`. */}
          <div className="space-y-2 text-sm break-all min-w-0">
            <p>
              <span className="font-semibold">Source:</span>{' '}
              {aasaFailure.source}
            </p>
            <p>
              <span className="font-semibold">Reason:</span>{' '}
              {aasaFailure.reason}
            </p>
          </div>
        </AlertCard>
      )}
      <p className="text-xs text-spark-text-secondary text-center px-2">
        This typically happens when the app's domain configuration was
        recently deployed and the platform's verification cache hasn't
        refreshed, or when the configuration is missing entirely. There's
        no guaranteed refresh time. Retry periodically, or share logs so
        the team can check server-side state.
      </p>
    </div>
  );

  const content = (() => {
    switch (phase) {
      case 'aasa-checking': return renderSpinner('Verifying app domain...');
      case 'aasa-error': return renderAasaError();
      case 'detecting': return error
        ? null
        : renderSpinner(isDiscoveringLabels ? 'Discovering labels...' : 'Detecting passkey...');
      case 'review': return error ? null : renderReview();
      case 'creating': return error ? null : renderSpinner('Initializing passkey...');
      case 'new-storing':
        if (error) return null;
        return renderSpinner('Saving label...');
      case 'auth-pick': return renderAuthPick();
      case 'connecting':
        if (error) return null;
        return renderSpinner('Starting Glow...');
      case 'initializing':
        // `secureStorage.storeSeed` triggers a second biometric prompt
        // to bind the seed; swap the label so it has visible context.
        return renderSpinner(
          isSecuringSeed ? 'Setting up biometric unlock...' : 'Starting Glow...',
        );
    }
  })();

  const footer = (() => {
    // AASA NotAssociated: retry the check + Share Diagnostic Logs.
    // No "Continue anyway": WebAuthn would just fail the same way.
    if (phase === 'aasa-error') {
      return (
        <div className="max-w-xl mx-auto space-y-3">
          <PrimaryButton
            className="w-full"
            onClick={() => {
              setAasaFailure(null);
              setPhase('aasa-checking');
            }}
          >
            Retry Check
          </PrimaryButton>
          <SecondaryButton
            className="w-full"
            onClick={() => {
              shareOrDownloadLogs().catch((e) => {
                logger.warn(LogCategory.UI, 'Log share/download failed from AASA error', {
                  error: e instanceof Error ? e.message : String(e),
                });
              });
            }}
          >
            Share Diagnostic Logs
          </SecondaryButton>
          <SecondaryButton className="w-full" onClick={onBack}>
            Go Back
          </SecondaryButton>
        </div>
      );
    }

    // Slow cancel on detecting: user dismissed a sheet (they have a
    // passkey). Offering Create would lure a duplicate, so retry only.
    // Bouncing through aasa-checking re-fires the detecting effect
    // (which only depends on [phase]).
    if (error && phase === 'detecting' && errorKind === 'sign-in-cancelled') {
      return (
        <div className="max-w-xl mx-auto space-y-3">
          <PrimaryButton className="w-full" onClick={() => {
            setError(null);
            setErrorKind(null);
            setPhase('aasa-checking');
          }}>
            Try Again
          </PrimaryButton>
        </div>
      );
    }

    // Switch-recovery footer: "Continue" (not "Try Again") because
    // the previous active-cred pin was already restored. The optional
    // "I deleted this passkey" checkbox (web only) routes the failing
    // cred through removeStaleCredential. Native auto-removed
    // upstream and never sets failingSwitchCredId.
    if (error && phase === 'detecting' && errorKind === 'switch-recovery') {
      const showRemovalConfirm = !Capacitor.isNativePlatform() && failingSwitchCredId !== null;
      return (
        <div className="max-w-xl mx-auto space-y-3">
          <PrimaryButton className="w-full" onClick={async () => {
            if (showRemovalConfirm && confirmedStaleRemoval && failingSwitchCredId) {
              try {
                await removeStaleCredential(failingSwitchCredId);
              } catch (e) {
                logger.warn(LogCategory.AUTH, 'Failed to remove confirmed stale cred', {
                  error: e instanceof Error ? e.message : String(e),
                });
              }
            }
            setFailingSwitchCredId(null);
            setConfirmedStaleRemoval(false);
            setError(null);
            setErrorKind(null);
            setPhase('aasa-checking');
          }}>
            Continue
          </PrimaryButton>
        </div>
      );
    }

    // Returning-user sign-in failures (cancel, transient
    // CredentialNotFound, relay error). Native: retry only. Web: also
    // offer Use Another Passkey (drops the active pin so the picker
    // can surface siblings), with Create gated by `retryOnly`.
    if (error && phase === 'detecting' && errorKind === 'sign-in-failed') {
      const isWeb = !Capacitor.isNativePlatform();
      const retryOnly = isWeb && immediateGetSupported !== true;
      return (
        <div className="max-w-xl mx-auto space-y-3">
          <PrimaryButton className="w-full" onClick={() => {
            setError(null);
            setErrorKind(null);
            setPhase('aasa-checking');
          }}>
            Try Again
          </PrimaryButton>
          {isWeb && (
            <SecondaryButton className="w-full" onClick={() => {
              // Drop the active-cred pin so the next detect runs
              // with empty allowCredentials; the OS picker
              // surfaces sibling creds and the assertion re-pins.
              localStorage.removeItem('passkeyActiveCredentialId');
              setError(null);
              setErrorKind(null);
              setPhase('aasa-checking');
            }}>
              Use Another Passkey
            </SecondaryButton>
          )}
          {isWeb && !retryOnly && (
            <SecondaryButton className="w-full" onClick={() => {
              setError(null);
              setErrorKind(null);
              setIsNewUser(true);
              setPhase('creating');
            }}>
              Create New Passkey
            </SecondaryButton>
          )}
        </div>
      );
    }

    // Generic detecting failure. Two-CTA web (no immediateGet) hides
    // Create because the user explicitly chose Use Existing Passkey
    // on HomePage; single-CTA paths keep it as a legitimate
    // continuation (Get Started was ambiguous about intent).
    if (error && phase === 'detecting') {
      const retryOnly = !Capacitor.isNativePlatform() && immediateGetSupported !== true;
      return (
        <div className="max-w-xl mx-auto space-y-3">
          <PrimaryButton className="w-full" onClick={() => {
            setError(null);
            setPhase('aasa-checking');
          }}>
            Try Again
          </PrimaryButton>
          {!retryOnly && (
            <SecondaryButton className="w-full" onClick={() => {
              setError(null);
              setIsNewUser(true);
              setPhase('creating');
            }}>
              Create Passkey
            </SecondaryButton>
          )}
        </div>
      );
    }

    // Already-exists recovery: register hit a duplicate. Pivot to
    // sign-in (no retry: excludeCredentials would refuse again). Skip
    // aasa-checking on the way to detecting; under skipDetection it
    // would bounce right back to 'creating'.
    if (error && phase === 'creating' && errorKind === 'already-exists') {
      return (
        <div className="max-w-xl mx-auto space-y-3">
          <PrimaryButton className="w-full" onClick={() => {
            setError(null);
            setErrorKind(null);
            setIsNewUser(false);
            detectingFailCountRef.current = 0;
            setPhase('detecting');
          }}>
            Use Passkey
          </PrimaryButton>
          <SecondaryButton className="w-full" onClick={handleErrorBack}>
            Go Back
          </SecondaryButton>
        </div>
      );
    }

    // Error state on any auto-triggered phase: Retry + Back
    if (error && ['creating', 'new-storing', 'connecting'].includes(phase)) {
      return (
        <div className="max-w-xl mx-auto space-y-3">
          <PrimaryButton className="w-full" onClick={handleRetry}>
            Retry
          </PrimaryButton>
          <SecondaryButton className="w-full" onClick={handleErrorBack}>
            Go Back
          </SecondaryButton>
        </div>
      );
    }

    if (phase === 'review') {
      // Only reachable via the deletion-recovery path in the
      // detection effect; the error AlertCard above explains why.
      return (
        <div className="max-w-xl mx-auto space-y-3">
          <PrimaryButton className="w-full" onClick={() => {
            setIsNewUser(true);
            setError(null);
            setPhase('creating');
          }}>
            Create Passkey
          </PrimaryButton>
          <SecondaryButton className="w-full" onClick={onBack}>
            Go Back
          </SecondaryButton>
        </div>
      );
    }


    if (phase === 'auth-pick') {
      const trimmedManual = manualLabel.trim();
      const isDuplicate = trimmedManual
        ? labels.some((l) => l.toLowerCase() === trimmedManual.toLowerCase())
        : false;
      const canConnect = showManualInput
        ? !!(trimmedManual && !isDuplicate)
        : !!selectedLabel;
      return (
        <div className="max-w-xl mx-auto space-y-3">
          <PrimaryButton
            className="w-full"
            disabled={!canConnect}
            onClick={() => {
              setError(null);
              if (showManualInput) {
                // New label on a device that already has a passkey:
                // publish the label (new-storing), then derive its seed
                // by reusing the existing credential (derive-only). A
                // returning user already has a passkey for this RP, so
                // registering a second one would be refused by the
                // authenticator. new-storing handles the publish + mirror
                // before connecting derives the wallet.
                connectLabelRef.current = trimmedManual;
                connectActionRef.current = 'derive-only';
                speculativeWalletRef.current = null;
                setPhase('new-storing');
              } else if (selectedLabel === 'Default' && speculativeWalletRef.current) {
                // Default: reuse the wallet pre-derived during detect.
                connectLabelRef.current = selectedLabel;
                connectActionRef.current = 'use-speculative';
                setPhase('connecting');
              } else {
                // Non-Default existing label: derive only.
                connectLabelRef.current = selectedLabel || undefined;
                connectActionRef.current = 'derive-only';
                speculativeWalletRef.current = null;
                setPhase('connecting');
              }
            }}
          >
            Continue
          </PrimaryButton>
          <SecondaryButton className="w-full" onClick={onBack}>
            Go Back
          </SecondaryButton>
        </div>
      );
    }

    return null;
  })();

  return (
    <PageLayout onBack={onBack} footer={footer} title="Get Started">
      <div className="max-w-xl mx-auto w-full flex flex-col min-h-full">
        <div className="mt-6 space-y-4 flex flex-col flex-1">
          {content}
          {error && (
            <AlertCard
              variant="error"
              title={
                errorKind === 'already-exists'
                  ? 'Passkey already exists'
                  : errorKind === 'sign-in-cancelled'
                    ? 'Sign-in cancelled'
                    : errorKind === 'switch-recovery'
                      ? 'Passkey unavailable'
                      : errorKind === 'sign-in-failed'
                        ? 'Sign-in failed'
                      : phase === 'new-storing'
                        ? "Couldn't save label"
                        : phase === 'connecting'
                          ? "Couldn't connect"
                          : phase === 'creating'
                            ? "Couldn't create passkey"
                            : 'Something went wrong'
              }
            >
              <p className="text-spark-text-secondary text-sm wrap-break-word">
                {error}
              </p>
            </AlertCard>
          )}
          {/* Web-only switch-recovery removal confirmation; ticked
              before Continue routes through removeStaleCredential. */}
          {error
            && phase === 'detecting'
            && errorKind === 'switch-recovery'
            && !Capacitor.isNativePlatform()
            && failingSwitchCredId !== null && (
            <div className="flex items-start gap-3 p-3 rounded-xl border border-spark-border">
              <Checkbox
                checked={confirmedStaleRemoval}
                onChange={() => setConfirmedStaleRemoval(prev => !prev)}
              />
              <div className="flex-1 space-y-1">
                <p className="text-sm text-spark-text-secondary">
                  I confirm that this passkey was deleted.
                </p>
                <p className="text-xs text-spark-text-muted">
                  Optional. Continue without ticking if unsure.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
};

export default PasskeyPage;
