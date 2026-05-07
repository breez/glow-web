import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Seed, Wallet } from '@breeztech/breez-sdk-spark';
import { PrimaryButton, SecondaryButton, Checkbox } from '../components/ui';
import LoadingSpinner from '../components/LoadingSpinner';
import PageLayout from '../components/layout/PageLayout';
import { AlertCard } from '../components/AlertCard';
import { NostrKeyIcon, CheckIcon, PasskeyIcon } from '../components/Icons';
import {
  createPasskey,
  getWallet,
  setupWallet,
  hasPasskeyHistory,
  clearPasskeyHistory,
  listLabels,
  saveLabel,
  setPasskeyMode,
  consumePendingSwitchFromCredentialId,
  removeStaleCredential,
} from '@/services/passkeyService';
import {
  passkeyPrfProvider,
  PasskeyAlreadyExistsError,
} from '@/services/passkeyPrfProvider';
import { isNativePlatform } from '@/services/nativePasskeyPrfProvider';
import type { DomainAssociation } from '@/services/passkeyPrfProvider';
import { logger, LogCategory } from '@/services/logger';
import { shareOrDownloadLogs } from '@/services/logExport';
import { useLatest } from '../hooks/useLatest';

// ============================================
// Types
// ============================================

/**
 * Phase state machine.
 *
 * On mount: "Use Passkey" was clicked → first run the platform's
 * out-of-band domain verification check, then try listLabels().
 *
 *   aasa-checking → aasa-error       (domain verification missing/stale)
 *                 → detecting → …    (verification OK or verification-skipped)
 *
 * Why the pre-check: on iOS/Android, AASA/assetlinks misconfiguration
 * (or CDN propagation lag after a bundle-ID change) causes WebAuthn
 * ceremonies to fail with opaque errors that are indistinguishable from
 * "no credential found" — routing users silently into a broken
 * create-passkey path. The pre-check surfaces this as a dedicated,
 * actionable error state BEFORE any biometric prompt fires.
 *
 * On `Skipped` (provider has no verification source, or check couldn't
 * complete due to offline/timeout), we proceed to `detecting` as normal
 * so offline-first UX isn't broken.
 *
 * From `detecting`:
 *   Success → passkey exists → returning user flow (auth-pick or connect-ready)
 *   Failure → no passkey    → new user flow (review)
 *
 * New user flow:
 *   detecting → review → creating (prompt 1) → new-storing (prompt 2)
 *             → connecting (prompt 3) → initializing
 *
 * Returning user flow (existing label):
 *   detecting (prompt 1) → auth-pick → connecting (prompt 2) → initializing
 *
 * Returning user flow (new label):
 *   detecting (prompt 1) → auth-pick → new-storing (prompt 2) → connecting (prompt 3) → initializing
 */
type Phase =
  | 'aasa-checking'   // On mount: checkDomainAssociation() — no user prompt
  | 'aasa-error'      // Domain verification confirmed NOT associated
  | 'detecting'       // listLabels() — WebAuthn prompt, doubles as detection
  // New user flow
  | 'review'          // Warning + I understand → triggers createPasskey()
  | 'creating'        // createPasskey() in progress (prompt)
  | 'new-storing'     // saveLabel() in progress (prompt)
  // Returning user flow
  | 'auth-pick'       // Authenticate step: label picker
  // Shared
  | 'connecting'      // Connect to Nostr step: getWallet() in progress (prompt)
  | 'initializing';   // Initialize step: SDK connecting


// ============================================
// Props
// ============================================

interface PasskeyPageProps {
  onWalletRestored: (seed: Seed, label: string) => void;
  onBack: () => void;
  sdkConnected?: boolean;
  /**
   * True while `secureStorage.storeSeed` is in flight during the
   * onboarding flow. When true, the `initializing` phase swaps its
   * loading label from "Starting Glow…" to "Setting up biometric
   * unlock…" so the second biometric prompt (F3 biometric-bound
   * store) has visual context instead of appearing on top of an
   * unrelated spinner.
   *
   * Note: on iOS the label flashes for <200ms because
   * SecAccessControl gates RETRIEVAL only, not SecItemAdd — users
   * effectively never see this state there. Android fingerprint-
   * backed BiometricPrompt.CryptoObject genuinely blocks at the
   * sensor, so Android is where the label actually communicates.
   */
  isSecuringSeed?: boolean;
  onFlowComplete?: () => void;
  /** Skip the listLabels() detection step and start the create-passkey flow directly. */
  skipDetection?: boolean;
  /**
   * Read-and-clear function for the "first sign-in after fresh install"
   * signal from useBreezSdk. Returns true once when the startup probe
   * had to restore `passkeyRegistered` from the iCloud-synced keychain
   * (meaning the device was just reinstalled or restored from another
   * Apple-ID device). PasskeyPage uses this to enable a one-shot
   * silent retry of the detecting phase, bridging the gap between
   * iCloud syncing the credential-IDs metadata and syncing the actual
   * passkey records. Returns false on every subsequent call.
   */
  consumeFreshInstallSignal?: () => boolean;
}

// WebAuthn ceremonies have an OS-level inactivity timer (60s on iOS,
// similar on Android Credential Manager) that surfaces as the same
// NotAllowedError / USER_CANCELLED-shaped error a user dismiss does.
// We can't read the underlying reason, but elapsed time is reliable
// enough to discriminate: a real human dismiss takes < ~30s in practice;
// anything above the timeout floor is overwhelmingly the OS giving up.
// Pinned to 5s under the platform's 60s ceiling so the heuristic
// triggers before the system actually tears the prompt down.
const LIKELY_TIMEOUT_MS = 55_000;

function isLikelyTimeout(elapsedMs: number): boolean {
  return elapsedMs >= LIKELY_TIMEOUT_MS;
}

// ============================================
// Component
// ============================================

const PasskeyPage: React.FC<PasskeyPageProps> = ({
  onWalletRestored,
  onBack,
  sdkConnected,
  isSecuringSeed,
  onFlowComplete,
  skipDetection = false,
  consumeFreshInstallSignal,
}) => {
  // AASA verification runs first for both paths; the post-AASA transition
  // branches on `skipDetection` to either jump straight to 'creating' (new
  // user via Create Passkey CTA) or 'detecting' (existing user via Use
  // Passkey CTA).
  const [phase, setPhase] = useState<Phase>('aasa-checking');
  const [isNewUser, setIsNewUser] = useState(skipDetection);
  const [labels, setLabels] = useState<string[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Discriminates the error state so the AlertCard can show a short
  // generic title (avoiding the overflow that long messages caused
  // when the error string itself was the title), and so the footer
  // can offer kind-specific recovery actions (e.g. "Sign in with
  // passkey" when the create flow refused because a passkey already
  // exists, instead of just generic Retry).
  const [errorKind, setErrorKind] = useState<
    null | 'generic' | 'already-exists' | 'sign-in-failed' | 'sign-in-cancelled' | 'switch-recovery'
  >(null);
  // Tracks the credential ID the user attempted to switch to. When the
  // switch fails on web (where we can't distinguish dismissed-picker
  // from deleted-cred), the switch-recovery UI surfaces a confirmation
  // checkbox: if the user confirms removal, we drop the cred from
  // metadata via removeStaleCredential on Continue. Native switch-
  // recovery auto-removes upstream (typed deletion signal makes this
  // unambiguous) and never sets this state.
  const [failingSwitchCredId, setFailingSwitchCredId] = useState<string | null>(null);
  const [confirmedStaleRemoval, setConfirmedStaleRemoval] = useState(false);
  const [manualLabel, setManualLabel] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  // Mirrors HomePage's two-CTA gate. When the user reached this page from
  // a two-CTA HomePage (i.e., they explicitly chose "Use Existing Passkey"
  // over "Create Passkey"), inline-Create on a sign-in failure contradicts
  // their explicit intent. Send them back to home instead, where they can
  // pick Create on its own. The provider caches the capability after
  // HomePage's mount-time probe, so this resolves synchronously in
  // practice.
  const [immediateGetSupported, setImmediateGetSupported] = useState<boolean | null>(null);
  // True once the WebAuthn assertion completes; drives the spinner
  // label switch from "Detecting passkey..." to "Discovering labels...".
  const [isDiscoveringLabels, setIsDiscoveringLabels] = useState(false);
  /**
   * Details of a `NotAssociated` verification result, surfaced verbatim
   * on the AASA error screen so users/maintainers see what went wrong
   * (which CDN reported the bundle missing, what bundle ID it expected,
   * etc.). Null outside the `aasa-error` phase.
   */
  const [aasaFailure, setAasaFailure] = useState<
    { source: string; reason: string } | null
  >(null);

  // Stable refs for callbacks (avoid stale closures in effects)
  const onWalletRestoredRef = useLatest(onWalletRestored);
  const onFlowCompleteRef = useLatest(onFlowComplete);

  // Label to use when entering the connecting phase
  const connectLabelRef = useRef<string | undefined>(undefined);
  /**
   * What `connecting` should do:
   * - `'setup'`: dual-salt setupWallet with publish (derives Nostr +
   *   wallet, publishes label).
   * - `'derive-only'`: single-salt getWallet for an already-published
   *   label.
   * - `'use-speculative'`: reuse `speculativeWalletRef`, no PRF.
   */
  const connectActionRef = useRef<'setup' | 'derive-only' | 'use-speculative'>('derive-only');
  /** Wallet pre-derived for 'Default' during detection's dual-salt assertion. */
  const speculativeWalletRef = useRef<Wallet | null>(null);

  // Counts how many times the detecting phase has failed during this
  // session of the page. The silent retry fires only on the FIRST
  // failure AND only when this PasskeyPage instance was opened in
  // the post-fresh-install window (see `isFreshInstallRef` below).
  const detectingFailCountRef = useRef(0);

  // Captures whether this PasskeyPage instance opened during the
  // window after a fresh install / iCloud restore — i.e., the
  // startup probe just put `passkeyRegistered=1` into localStorage
  // because it found credential IDs in the iCloud-synced keychain
  // that hadn't replicated to localStorage yet.
  //
  // Read once on mount and then permanently captured so subsequent
  // re-renders don't change behavior. Only this state enables the
  // silent retry, because only here is iCloud Keychain plausibly
  // mid-sync. Regular sign-in failures (cancelled prompt, etc.) on
  // a long-running install go straight to the error UI.
  const isFreshInstallRef = useRef<boolean>(false);
  useEffect(() => {
    isFreshInstallRef.current = consumeFreshInstallSignal?.() ?? false;
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================
  // Effects — auto-triggered phases
  // ============================================

  // SDK finished connecting → complete flow
  useEffect(() => {
    if (sdkConnected && phase === 'initializing') {
      onFlowCompleteRef.current?.();
    }
  }, [sdkConnected, phase, onFlowCompleteRef]);

  useEffect(() => {
    let cancelled = false;
    passkeyPrfProvider.supportsImmediateGet().then((supported) => {
      if (!cancelled) setImmediateGetSupported(supported);
    });
    return () => { cancelled = true; };
  }, []);

  // On mount (and on Retry after aasa-error): verify the app's bundle ID
  // is listed by the platform's out-of-band domain verification source
  // (Apple AASA CDN on iOS, Google Digital Asset Links on Android,
  // registrable-suffix check in the browser).
  //
  // No user prompt fires during this check — it's a background HTTP
  // fetch on native / synchronous local check in the browser. On
  // `Associated` or `Skipped` we proceed to the normal detecting flow;
  // only `NotAssociated` blocks, and only with a concrete reason
  // surfaced in the UI.
  useEffect(() => {
    if (phase !== 'aasa-checking') return;
    let cancelled = false;

    const run = async () => {
      let result: DomainAssociation;
      try {
        result = await passkeyPrfProvider.checkDomainAssociation();
      } catch (e) {
        // The provider is documented to never throw (verification-level
        // failures surface as `Skipped`). Defensive fallback — if the
        // contract changes, treat as Skipped so the app doesn't hard-stop
        // on a diagnostic pre-check.
        if (cancelled) return;
        logger.warn(LogCategory.AUTH, 'Domain association check threw (unexpected)', {
          error: e instanceof Error ? e.message : String(e),
        });
        setPhase(skipDetection ? 'creating' : 'detecting');
        return;
      }

      if (cancelled) return;

      if (result.kind === 'NotAssociated') {
        setAasaFailure({ source: result.source, reason: result.reason });
        setPhase('aasa-error');
        return;
      }

      // Associated or Skipped: either way, proceed with the next phase.
      // Skipped is explicitly NOT a negative signal: it means the
      // provider couldn't verify (offline / no verification source),
      // not that verification failed.
      setAasaFailure(null);
      setPhase(skipDetection ? 'creating' : 'detecting');
    };

    run();
    return () => { cancelled = true; };
  }, [phase, skipDetection]);

  // On mount: detect passkey by trying listLabels() (WebAuthn get).
  // The "Sign in with passkey" button click on HomePage is the user
  // interaction. Success → passkey exists → returning user. Failure
  // depends on whether the device has a registered passkey:
  //  - hasPasskeyHistory=true: a returning user whose discovery just
  //    failed (cancelled prompt, missing credential, relay error).
  //    Refuse to silently register a parallel passkey: surface a
  //    retry-able error and stay on the detecting phase.
  //  - hasPasskeyHistory=false: a genuine first-time user; route to
  //    the new-user create flow.
  useEffect(() => {
    if (phase !== 'detecting') return;
    let cancelled = false;

    // Sign-in path: tell the provider not to auto-register if discovery
    // can't find a credential. On native this maps to autoRegister=false
    // on the SDK PasskeyProvider, which surfaces CredentialNotFound
    // instead of silently registering. No-op on browser.
    passkeyPrfProvider.mode = 'sign-in';

    // Tie the in-flight assertion to component-unmount via AbortController
    // so a route-away mid-prompt frees the JS-side Promise. On iOS Safari
    // the OS modal does not visually close on abort (Apple-side limitation),
    // but the JS Promise rejects with AbortError so the page-state machine
    // can clean up. Web only — native uses its own plugin lifecycle.
    const controller = new AbortController();
    passkeyPrfProvider.currentSignal = controller.signal;

    // Update spinner state once WebAuthn prompt completes
    passkeyPrfProvider.onAuthComplete = () => {
      if (!cancelled) setIsDiscoveringLabels(true);
    };

    // Wall-clock the assertion so a cancel-shaped error can be
    // disambiguated against the no-creds case on platforms that
    // collapse both into the same code. iOS's
    // preferImmediatelyAvailableCredentials and web's
    // mediation: 'immediate' both return synchronously when no
    // credential is available (no UI rendered) but report the
    // failure indistinguishably from a user dismissing a sheet.
    // A sub-threshold elapsed time means no UI rendered, so we
    // route silently to create. Android stays deterministic via
    // `NoCredentialException` and never reaches this branch.
    const detectStartMs = Date.now();
    const run = async () => {
      try {
        // Dual-salt assert 'Default' BEFORE listLabels so a user whose
        // label is 'Default' completes restore in one prompt. Must
        // pass publishLabel=false: users whose actual label is not
        // 'Default' would otherwise get a stray Nostr publish.
        const speculative = await setupWallet('Default', false);
        if (cancelled) return;
        // PRF succeeded: a switch attempt that started with
        // setPendingSwitchFromCredentialId() has now resolved
        // successfully. Clear the slot so a later unrelated sign-in
        // failure can't trigger an inappropriate switch-recovery.
        consumePendingSwitchFromCredentialId();
        speculativeWalletRef.current = speculative;

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
        // Rust's setupWallet wraps the underlying PrfProvider error in
        // a generic `Error("PRF error: Passkey error: …")`, dropping the
        // platform code and name. The provider stashes the raw
        // pre-wrap shape on `lastDeriveError` so we can recover the
        // original `USER_CANCELLED` / `CREDENTIAL_NOT_FOUND` here.
        const raw = passkeyPrfProvider.lastDeriveError;
        const errorName = raw?.name ?? (e instanceof Error ? e.name : '');
        const errorMessage = raw?.message ?? (e instanceof Error ? e.message : '');
        const errorCode = raw?.code ?? (e as { code?: string })?.code;
        // Cancellation can surface as:
        //   - native: error.code === 'USER_CANCELLED' (Capacitor bridge)
        //   - browser (raw): error.name === 'NotAllowedError' / 'AbortError'
        //   - browser (SDK-wrapped): the SDK's _mapError replaces a cancel
        //     NotAllowedError with `new Error('User cancelled authentication')`,
        //     dropping the name. Match the message pattern as a fallback.
        const messageLooksCancelled = /cancel{1,2}ed|cancellation/i.test(errorMessage);
        const isCancelled = errorName === 'NotAllowedError' || errorName === 'AbortError'
          || errorCode === 'USER_CANCELLED'
          || messageLooksCancelled;
        // Definitive "no credential on this device" signal. On native this
        // comes from the SDK provider with autoRegister=false (we set
        // mode='sign-in' above). It distinguishes a deleted-from-Settings
        // case from a cancelled prompt, which is what lets us recover.
        //
        // On web there is no equivalent typed code: WebAuthn intentionally
        // collapses cancel / lockout / no-credential / timeout into a
        // single `NotAllowedError`. Best we can do is heuristic-match on
        // the SDK's lower-level error message, which mirrors the
        // string-pattern set in the SDK's own `_isNoCredentialError`. The
        // heuristic may misclassify a true cancel as "no credential" on
        // some browser builds; the worst case is an extra "Create a new
        // passkey" prompt the user can dismiss with Try Again.
        const looksLikeNoCredentialMessage =
          errorMessage.includes('Credential not found') ||
          errorMessage.includes('no credentials') ||
          errorMessage.includes('No credentials') ||
          errorMessage.includes('empty allowCredentials');
        const isCredentialNotFound = errorCode === 'CREDENTIAL_NOT_FOUND'
          || looksLikeNoCredentialMessage;
        const elapsedMs = Date.now() - detectStartMs;
        const FAST_FAIL_MAX_MS = 300;
        // Fast fail with no UI rendered → OS deterministically has no
        // matching cred. The shape differs per platform, so dispatch
        // explicitly:
        //
        //   Android: NoCredentialException → typed CREDENTIAL_NOT_FOUND.
        //     Reliable on its own; the time check just confirms it
        //     fired pre-UI rather than after a slow internal path.
        //
        //   iOS: preferImmediatelyAvailableCredentials silent fail
        //     conflates "no cred" and "user cancel" into the same
        //     USER_CANCELLED-shaped error. Only the elapsed time
        //     distinguishes deletion from a real user dismiss.
        //
        //   Web: WebAuthn collapses every failure mode into NotAllowedError
        //     and there's no fast silent path. Skip — the slow-path
        //     branches below handle web's hybrid sheet.
        const platform = isNativePlatform() ? Capacitor.getPlatform() : 'web';
        let isFastFailNoCred = false;
        if (elapsedMs < FAST_FAIL_MAX_MS) {
          if (platform === 'android') isFastFailNoCred = isCredentialNotFound;
          else if (platform === 'ios') isFastFailNoCred = isCancelled;
        }
        if (hasPasskeyHistory()) {
          if (isFastFailNoCred) {
            if (detectingFailCountRef.current === 0 && isFreshInstallRef.current) {
              // Fresh-install sync gap: retry budget covers iCloud
              // Keychain stage-2 / Block Store sync before we assume
              // deletion. 3s pause before re-firing detecting.
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
            // Switch-recovery: when the user picked a credential to
            // switch to via PasskeyManagementPage and that cred turns
            // out to be deleted, restore the cred we switched FROM
            // and remove only the failing cred's metadata. Without
            // this, we'd treat it like a single-cred deletion, wipe
            // the entire known list, and route the user into the
            // new-user create flow — losing all their other valid
            // creds' AAGUID / user.name records along the way.
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
            // Cred is still on the device; auto-clearing would lure a
            // duplicate. Surface retryable error.
            logger.warn(LogCategory.AUTH, 'Slow CREDENTIAL_NOT_FOUND on returning user (likely user dismissal), surfacing retryable error');
            setError(
              'Could not find your Glow passkey on this device. Try again, or check Settings → Passwords.',
            );
            setErrorKind('sign-in-failed');
            return;
          }
          // First failure for a returning user, AND the page was
          // opened during the fresh-install window: silently retry
          // once before showing the error UI. Bridges the iCloud
          // Keychain stage-2 sync gap that only exists right after
          // a fresh install. On a stable install, a failure here is
          // a real signal (cancelled prompt, deleted credential,
          // relay error) and we go straight to the error UI.
          if (detectingFailCountRef.current === 0 && isFreshInstallRef.current) {
            detectingFailCountRef.current = 1;
            logger.info(LogCategory.AUTH, 'Sign-in failed on first attempt, retrying silently', {
              errorName,
              errorCode,
            });
            // Keep the spinner label as "Detecting passkey..." through
            // the retry: too many text changes during a single sign-in
            // attempt reads as flicker. The retry itself is just a
            // 3s heuristic pause -- iOS doesn't expose iCloud Keychain
            // sync state, so we can't promise any specific work is
            // happening, and labelling it "Retrying..." or "Syncing..."
            // would imply visibility we don't have.
            setTimeout(() => {
              if (cancelled) return;
              setPhase('aasa-checking');
            }, 3000);
            return;
          }
          // Web switch-recovery (gentle): native handles this case in
          // the fast-fail branch above with a typed deletion signal,
          // which lets it both revert the active pin AND remove the
          // failing cred from the registry. Web has no equivalent
          // signal (NotAllowedError covers cancelled-picker and
          // deleted-cred identically), so we run the gentler version:
          // revert the active pin to the previously-signed-in cred
          // and keep the failing cred in metadata. The user can
          // confirm the cred is gone and remove it from
          // PasskeyManagementPage if so. Without this branch, every
          // subsequent detect on web would re-pin to the failing cred
          // via allowCredentialIds and fail the same way, locking the
          // user into an infinite Try Again loop.
          if (!isNativePlatform()) {
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
              // Stash the failing cred ID + reset the confirmation
              // checkbox so the switch-recovery UI can offer to drop
              // its metadata when the user confirms removal.
              setFailingSwitchCredId(failingCredId);
              setConfirmedStaleRemoval(false);
              setError("Could not sign in with that passkey. It may have been removed, or the prompt was cancelled.");
              setErrorKind('switch-recovery');
              return;
            }
          }
          // Returning user, second failure (cancelled prompt, relay
          // error, transient network, or stage-2 sync still pending).
          // Never silently fall to creation: surface a retryable error
          // and stay on detecting.
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
                ? 'Sign-in timed out. The system stopped waiting for biometrics. Please try again.'
                : 'Sign-in cancelled. Please try again.')
              : `Could not sign in with your passkey. ${underlying ? `[${underlying}]` : ''} Please try again.`,
          );
          setErrorKind('sign-in-failed');
          return;
        }
        // Routing precedence:
        //   1. CREDENTIAL_NOT_FOUND (Android NoCredentialException, or
        //      iOS .notHandled / "no credential" message) → deterministic
        //      no-creds → silent fall-through to create.
        //   2. USER_CANCELLED with a fast elapsed time → iOS conflates
        //      no-creds and user-dismiss into the same code, so a sub-
        //      threshold elapsed reliably means no UI was rendered.
        //      Treat as no-creds. Threshold is conservative: iOS fast-
        //      fail returns in < 100ms, real user dismiss takes seconds.
        //   3. USER_CANCELLED with a slow elapsed time → user actually
        //      dismissed a passkey sheet, so they have creds. Surface
        //      a cancel-specific error that does NOT offer Create
        //      (would lure them into duplicating a passkey they already
        //      have).
        //   4. Anything else (unknown failure) → generic error with
        //      both retry and explicit-create as escape hatches.
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
          // Native (iOS/Android) reaches here only after a slow
          // dismiss — the fast-fail no-creds case was already routed
          // silently to create above. So a slow cancel on native
          // means the user definitively has a passkey and dismissed
          // the picker; offering Create would lure a duplicate.
          //
          // Web can't make that distinction: the browser renders the
          // hybrid (QR/cross-device) sheet for both no-creds and
          // has-creds, both elapse past the threshold, and both
          // surface as the same NotAllowedError. Show the generic
          // failure with both Try Again and Create as escape hatches
          // so genuine new users aren't stuck.
          //
          // (Chrome 148's `uiMode: 'immediate'` doesn't fix this:
          // when a hybrid-paired device exists in the user's
          // account, Chrome surfaces the QR / Security Key sheet
          // even on no-cred immediate-mediation calls, so we still
          // can't distinguish slow cancels on web.)
          if (isNativePlatform()) {
            logger.info(LogCategory.AUTH, 'User dismissed passkey sheet (native); refusing to offer Create', {
              errorCode,
              elapsedMs,
            });
            setError(
              isLikelyTimeout(elapsedMs)
                ? 'Sign-in timed out. The system stopped waiting for biometrics. Please try again.'
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
            // Leave errorKind unset so the generic detecting branch
            // renders the right escape (Create vs. Go Back) based on
            // the two-CTA gate. The 'sign-in-failed' kind is reserved
            // for returning users where offering Create would lure a
            // duplicate.
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
        // Same reasoning as the web cancel branch above: defer the
        // escape-hatch choice to the render branch.
        setErrorKind(null);
      }
    };

    run();
    return () => {
      cancelled = true;
      // Abort any in-flight WebAuthn ceremony so a route-away during
      // the prompt frees the Promise. The provider's try/finally clears
      // currentSignal after the call returns, so this only fires when
      // the call is still pending.
      controller.abort();
      passkeyPrfProvider.currentSignal = undefined;
      passkeyPrfProvider.onAuthComplete = undefined;
      // Reset the spinner-label flag so a re-entry into the detecting
      // phase starts back at "Detecting passkey..." rather than
      // inheriting the previous attempt's "Discovering labels..." state.
      setIsDiscoveringLabels(false);
      // Do NOT reset mode here. The downstream phases of the sign-in
      // flow (auth-pick → connecting) all call derivePrfSeed via the
      // SDK's getWallet/saveLabel/listLabels paths, and they MUST
      // continue to use autoRegister=false. Otherwise a credential
      // that's been deleted between detecting and connecting (e.g. via
      // Settings → Passwords) would be silently re-registered with a
      // brand-new private key, producing a brand-new seed and
      // surfacing the user into an empty parallel wallet. The
      // creating effect re-sets mode='create' explicitly when it's
      // time to genuinely register a new passkey.
    };
  }, [phase]);

  // New user: create passkey (prompt)
  useEffect(() => {
    if (phase !== 'creating' || error) return;
    let cancelled = false;

    const run = async () => {
      try {
        await createPasskey();
        if (cancelled) return;
        logger.info(LogCategory.AUTH, 'Passkey created successfully');
        connectLabelRef.current = 'Default';
        // Use bulk-PRF setup: a single ceremony derives the Nostr
        // identity + wallet seed and publishes the label. Replaces the
        // legacy new-storing → connecting two-prompt sequence.
        connectActionRef.current = 'setup';
        setPhase('connecting');
      } catch (e) {
        if (cancelled) return;
        // Platform refused because excludeCredentials matched an
        // already-registered passkey. The user just consented to a
        // CREATE and biometric-verified — silently pivoting them into
        // a sign-in flow they didn't ask for is jarring (they think
        // they're creating, get prompted again, and end up signed in
        // to the existing cred without explanation). Surface a
        // dedicated "passkey already exists" state with a clear
        // "Use Passkey" CTA so the next biometric prompt is one the
        // user explicitly opted into.
        if (e instanceof PasskeyAlreadyExistsError) {
          logger.info(LogCategory.AUTH, 'Create flow detected existing passkey, surfacing already-exists state');
          // Restore the persistent flag so HomePage and the rest of
          // the app treat this as a returning-user session.
          localStorage.setItem('passkeyRegistered', '1');
          setIsNewUser(false);
          // Reset detect-fail counter so the upcoming sign-in attempt
          // (when the user taps "Use Passkey") gets the fresh-install
          // retry budget if applicable.
          detectingFailCountRef.current = 0;
          setError('You already have a Glow passkey on this device. Use it to sign in.');
          setErrorKind('already-exists');
          return;
        }
        // Surface the underlying error message and Capacitor error code
        // (when present) directly in the UI. Generic "Failed to create
        // passkey" is unhelpful for diagnosis: the user can't tell
        // whether they cancelled, the entitlement is wrong, the AASA
        // CDN is stale, the existing keychain blocked them, etc.
        const code = (e as { code?: string })?.code;
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          code
            ? `Failed to create passkey [${code}]: ${msg}`
            : `Failed to create passkey: ${msg}`,
        );
        setErrorKind('generic');
        logger.error(LogCategory.AUTH, 'Passkey creation failed', {
          errorCode: code,
          error: msg,
        });
      }
    };

    run();
    return () => { cancelled = true; };
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
        // Don't setPasskeyMode here — wait until connecting succeeds to avoid
        // auto-reconnect on refresh before onboarding completes
        // Add newly saved label to the list so auth-pick is up-to-date on Go Back
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
          w = await setupWallet(label);
        } else {
          w = await getWallet(label);
        }
        if (cancelled) return;
        logger.info(LogCategory.AUTH, 'Passkey wallet derived', { action });

        // Reflect the just-published label in the picker state so
        // navigating back doesn't show a stale list.
        if (action === 'setup') {
          const labelToSave = label ?? 'Default';
          setLabels(prev => prev.includes(labelToSave) ? prev : [...prev, labelToSave]);
          setSelectedLabel(labelToSave);
          setShowManualInput(false);
          setManualLabel('');
        }

        // Remember label locally
        if (label) {
          setPasskeyMode(label);
        }

        setPhase('initializing');
        onWalletRestoredRef.current(w.seed, w.label);
      } catch (e) {
        if (cancelled) return;
        const underlying = e instanceof Error ? e.message : String(e);
        const elapsedMs = Date.now() - connectStartMs;
        // The PRF derive inside setupWallet / getWallet hits the same
        // OS timer as the detecting-phase ceremony (60s on iOS, similar
        // on Android Credential Manager). Recover the raw error code
        // through lastDeriveError since Rust's setupWallet wraps it.
        const raw = passkeyPrfProvider.lastDeriveError;
        const errorCode = raw?.code ?? (e as { code?: string })?.code;
        const messageLooksCancelled = /cancel{1,2}ed|cancellation/i.test(raw?.message ?? underlying);
        const isCancelled = errorCode === 'USER_CANCELLED'
          || raw?.name === 'NotAllowedError'
          || raw?.name === 'AbortError'
          || messageLooksCancelled;
        console.error('[Glow] Connect failed', { error: underlying, errorCode, elapsedMs, raw: e });
        if (isCancelled && isLikelyTimeout(elapsedMs)) {
          setError('Sign-in timed out. The system stopped waiting for biometrics. Please try again.');
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

  // ============================================
  // Handlers
  // ============================================

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
        if (isNewUser) {
          onBack();              // New user: passkey created, nothing interactive to go back to
        } else {
          setPhase('auth-pick');  // Returning user: back to label picker
        }
        break;
      case 'connecting':
        if (isNewUser) {
          onBack();  // New user: passkey + label saved, nothing to go back to
        } else {
          setPhase('auth-pick');  // Returning user: back to label picker (label list is up-to-date)
        }
        break;
      default:
        onBack();
    }
  };

  // ============================================
  // Render helpers
  // ============================================

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

  /**
   * Dedicated error state for NotAssociated domain verification. Surfaces
   * the failure source + reason verbatim so users can report the exact
   * diagnostic and maintainers can fix the right side (CDN propagation,
   * assetlinks.json, bundle-ID entry, etc.). No timeline promises — we
   * can't predict when a stale CDN will refresh.
   */
  const renderAasaError = () => (
    // w-full + min-w-0 prevent the AlertCard's long diagnostic tokens
    // (URLs, `delegate_permission/common.get_login_creds` etc.) from
    // widening the flex/grid parent and making the whole page
    // horizontally scrollable on mobile. max-w-xl remains the desktop
    // cap.
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
          {/* break-all (word-break: break-all) is intentional here —
              `wrap-break-word` (overflow-wrap: break-word) only splits at
              word boundaries and doesn't help with long unbroken tokens
              like `delegate_permission/common.get_login_creds` or URLs,
              which were pushing the AlertCard past the viewport on
              narrow screens and making the whole page scrollable. */}
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
        no guaranteed refresh time — retry periodically, or share logs so
        the team can check server-side state.
      </p>
    </div>
  );


  // ============================================
  // Content & footer routing
  // ============================================

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
        // F3: while `secureStorage.storeSeed` is in flight, the user is
        // being shown a biometric prompt to bind the seed to a
        // biometric-gated Keychain / Keystore key. Swap the label so
        // the prompt has visible context and doesn't look like a bug.
        return renderSpinner(
          isSecuringSeed ? 'Setting up biometric unlock...' : 'Starting Glow...',
        );
    }
  })();

  const footer = (() => {
    // AASA pre-check failed with NotAssociated. Offer the user two
    // actions: retry the check (in case server-side state has updated),
    // or share diagnostic logs so the team can check CDN / origin state.
    // No "Continue anyway" escape — WebAuthn will fail for the same
    // reason, so routing users into that broken path only produces
    // follow-on opaque errors.
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

    // Detecting failure where the user explicitly dismissed a sheet
    // (cancel-shaped error with elapsed time past the no-creds
    // fast-fail threshold). They have a passkey; offering Create
    // here would lure a duplicate, so only retry is shown.
    if (error && phase === 'detecting' && errorKind === 'sign-in-cancelled') {
      return (
        <div className="max-w-xl mx-auto space-y-3">
          <PrimaryButton className="w-full" onClick={() => {
            setError(null);
            setErrorKind(null);
            // Bounce through aasa-checking to force the detecting effect
            // to re-run. Just clearing `error` while staying on detecting
            // doesn't re-trigger the effect (its deps are [phase] only),
            // and the AASA precheck is cheap (no biometric prompt).
            setPhase('aasa-checking');
          }}>
            Try Again
          </PrimaryButton>
        </div>
      );
    }

    // Switch-recovery: the user picked a credential to switch to, it
    // didn't authenticate, and the recovery branch in the detect
    // effect restored the active-cred pin to the previously-signed-in
    // cred. The next sign-in attempt will pin to that cred
    // (allowCredentialIds is single-element), so the OS picker auto-
    // resolves and the user sees only the biometric prompt for the
    // cred they were using before the switch attempt. "Continue"
    // reads more honestly than "Try Again" here — we're not retrying
    // the failed sign-in, we're moving forward with the previous cred.
    //
    // On web, the recovery branch leaves the failing cred in metadata
    // (it can't tell dismissed-picker from deleted-cred apart). The
    // confirmation checkbox lives in the main content area, directly
    // below the AlertCard (rendered down in the JSX), so the user
    // sees the prompt next to the explanation rather than down in
    // the footer next to the action button. The footer here is just
    // Continue: ticked checkbox + Continue removes the failing cred
    // from per-cred metadata + the canonical store via
    // removeStaleCredential; unticked Continue keeps the cred and
    // just moves on (correct for the dismiss case where the cred is
    // alive). Native never reaches this branch with
    // failingSwitchCredId set; its upstream switch-recovery already
    // auto-removed.
    if (error && phase === 'detecting' && errorKind === 'switch-recovery') {
      const showRemovalConfirm = !isNativePlatform() && failingSwitchCredId !== null;
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

    // Returning-user sign-in failures (cancelled, transient
    // CREDENTIAL_NOT_FOUND, relay error).
    //
    // Native: Try Again only. The fast-fail branch upstream already
    // auto-routes genuinely-deleted-cred cases to setPhase('review'),
    // so reaching this branch on native means slow-cancel — user
    // dismissed the picker, cred is still alive, and retry is the
    // right action. Offering Create here would lure a duplicate.
    //
    // Web: Try Again + Use Another Passkey, with Create only on the
    // single-CTA path. Web has no fast-fail signal, so reaching this
    // branch can mean either a dismiss or a dead pinned cred. Try
    // Again handles dismiss; Use Another Passkey drops the active
    // pin so the OS picker can surface sibling creds (it's still a
    // sign-in pivot, so consistent with the user's earlier choice on
    // both two-CTA and single-CTA paths). Create is gated by the
    // same `retryOnly` rule the generic-failure branch below uses:
    // two-CTA users explicitly chose Use Existing Passkey on HomePage
    // and the system back button is the route home for Create;
    // single-CTA users took an ambiguous Get Started entry, so Create
    // is a legitimate continuation. excludeCredentialIds is populated
    // from the local registry, so Create can't produce a platform-
    // level duplicate when the registry is intact.
    if (error && phase === 'detecting' && errorKind === 'sign-in-failed') {
      const isWeb = !isNativePlatform();
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
              // Drop the active-cred pin so the next detect runs with
              // empty allowCredentialIds. The OS picker surfaces any
              // sibling cred valid for this RP; captureAssertion
              // re-pins to whichever the user picks. Escapes the
              // same-pin retry loop for users whose active cred is
              // gone but who still have other creds synced via
              // iCloud Keychain or Google Password Manager.
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

    // Detecting failure for other reasons (unknown errors).
    //
    // Two-CTA web (immediateGet not supported) reaches this branch
    // after the user explicitly chose "Use Existing Passkey" on
    // HomePage. Inline-Create here would contradict that choice and
    // lure a duplicate, so just offer Try Again — the system back
    // button is the route to home if they want Create instead.
    // Single-CTA paths (native, web with immediateGet) keep the
    // inline Create — the user took an ambiguous "Get Started"
    // entry, so Create is a legitimate continuation.
    if (error && phase === 'detecting') {
      const retryOnly = !isNativePlatform() && immediateGetSupported !== true;
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

    // "Already exists" recovery: the user opted into Create (either
    // via the explicit Create CTA or the "Don't have your passkey?"
    // recovery link), the OS verified them, and the platform refused
    // because excludeCredentials matched a cred already on this
    // authenticator. The AlertCard above explains the situation;
    // primary action is to sign in with the existing cred, secondary
    // backs out to home. Try Again is intentionally NOT offered:
    // excludeCredentials is still populated, so retrying create would
    // fail with the same InvalidStateError in a loop.
    if (error && phase === 'creating' && errorKind === 'already-exists') {
      return (
        <div className="max-w-xl mx-auto space-y-3">
          <PrimaryButton className="w-full" onClick={() => {
            setError(null);
            setErrorKind(null);
            setIsNewUser(false);
            // Reset detect-fail counter so this entry into detecting
            // gets the fresh-install retry budget if applicable.
            detectingFailCountRef.current = 0;
            // Skip aasa-checking. Under skipDetection=true it would
            // route to 'creating' and re-fire createPasskey(), bouncing
            // the user back to the flow they just came from.
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
              if (showManualInput) {
                // New label → use bulk-PRF setup so we publish the label
                // AND derive the wallet seed in a single ceremony.
                connectLabelRef.current = trimmedManual;
                connectActionRef.current = 'setup';
                speculativeWalletRef.current = null;
                setError(null);
                setPhase('connecting');
              } else if (selectedLabel === 'Default' && speculativeWalletRef.current) {
                // Speculative fast path: the user picked 'Default',
                // which we already pre-derived during detection. No
                // new PRF ceremony needed.
                connectLabelRef.current = selectedLabel;
                connectActionRef.current = 'use-speculative';
                setError(null);
                setPhase('connecting');
              } else {
                // Existing non-Default label → derive only. Discard
                // any speculative wallet (it was for 'Default').
                connectLabelRef.current = selectedLabel || undefined;
                connectActionRef.current = 'derive-only';
                speculativeWalletRef.current = null;
                setError(null);
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

  // ============================================
  // Layout
  // ============================================

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
          {/* Web switch-recovery removal-confirmation checkbox.
              Sits directly under the AlertCard so the prompt reads
              alongside the error explanation rather than next to the
              footer's Continue button. The footer's switch-recovery
              branch reads `confirmedStaleRemoval` to decide whether
              to call removeStaleCredential. Native switch-recovery
              auto-removes upstream and never sets failingSwitchCredId,
              so this block is web-only by construction. */}
          {error
            && phase === 'detecting'
            && errorKind === 'switch-recovery'
            && !isNativePlatform()
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
