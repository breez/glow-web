import React, { useEffect, useRef, useState } from 'react';
import { Seed } from '@breeztech/breez-sdk-spark';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import LoadingSpinner from '../components/LoadingSpinner';
import PageLayout from '../components/layout/PageLayout';
import { AlertCard } from '../components/AlertCard';
import { NostrKeyIcon, CheckIcon, PasskeyIcon } from '../components/Icons';
import {
  clearPasskeyHistory,
  createPasskey,
  getWallet,
  hasPasskeyHistory,
  listLabels,
  saveLabel,
  setPasskeyMode,
} from '@/services/passkeyService';
import {
  passkeyPrfProvider,
  PasskeyAlreadyExistsError,
} from '@/services/passkeyPrfProvider';
import type { DomainAssociation } from '@/services/passkeyPrfProvider';
import { logger, LogCategory } from '@/services/logger';
import { shareOrDownloadLogs } from '@/services/logExport';
import StepperBar from '@/components/OnboardingStepper';

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

/** Step index for the new user inline stepper (3 steps). */
function newUserStepIndex(phase: Phase): number {
  // review/aasa-checking/detecting are pre-flight phases where step 1
  // hasn't started yet. Returning 0 surfaces step 1 as "next up"
  // rather than the bare-default 3 which the stepper renders as
  // "all done" — visually wrong for a screen that's literally
  // titled "Create your passkey".
  if (phase === 'review' || phase === 'aasa-checking' || phase === 'detecting') return 0;
  if (phase === 'creating') return 0;
  if (phase === 'new-storing') return 1;
  if (phase === 'connecting' || phase === 'initializing') return 2;
  return 3; // all complete (post-flow)
}


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
  /** Skip the listLabels() detection step and start directly at the create-passkey review screen. */
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
  // branches on `skipDetection` to either jump straight to 'review' (new
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
    null | 'generic' | 'already-exists' | 'sign-in-failed'
  >(null);
  const [manualLabel, setManualLabel] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [detectingText, setDetectingText] = useState('Detecting passkey...');
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
  const onWalletRestoredRef = useRef(onWalletRestored);
  onWalletRestoredRef.current = onWalletRestored;
  const onFlowCompleteRef = useRef(onFlowComplete);
  onFlowCompleteRef.current = onFlowComplete;

  // Label to use when entering the connecting phase
  const connectLabelRef = useRef<string | undefined>(undefined);

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
  }, [sdkConnected, phase]);

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
        setPhase(skipDetection ? 'review' : 'detecting');
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
      setPhase(skipDetection ? 'review' : 'detecting');
    };

    run();
    return () => { cancelled = true; };
  }, [phase]);

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

    // Reset spinner text on every detecting entry. Without this, a
    // previous attempt that progressed past the assertion (so the
    // onAuthComplete callback fired and flipped the spinner to
    // "Discovering labels...") leaves the stale label in place when
    // the retry comes back through this effect — the user sees
    // "Discovering labels..." while the new attempt is still on the
    // assertion step, which reads as a stuck state.
    setDetectingText('Detecting passkey...');

    // Sign-in path: tell the provider not to auto-register if discovery
    // can't find a credential. On native this maps to autoRegister=false
    // on the SDK PasskeyProvider, which surfaces CredentialNotFound
    // instead of silently registering. No-op on browser.
    passkeyPrfProvider.mode = 'sign-in';

    // Update spinner text once WebAuthn prompt completes
    passkeyPrfProvider.onAuthComplete = () => {
      if (!cancelled) setDetectingText('Discovering labels...');
    };

    const run = async () => {
      try {
        const found = await listLabels();
        if (cancelled) return;

        // Passkey exists → returning user
        if (found.length === 0) {
          // Passkey exists but no labels on relays → auto-create "Default"
          // and skip the picker. Mirrors the new-passkey path.
          connectLabelRef.current = 'Default';
          setPhase('new-storing');
        } else if (found.length === 1) {
          // Single label: skip the picker and connect directly.
          setLabels(found);
          connectLabelRef.current = found[0];
          setPhase('connecting');
        } else {
          // Display oldest → newest
          const sorted = [...found].reverse();
          setLabels(sorted);
          const defaultIdx = sorted.indexOf('Default');
          setSelectedLabel(defaultIdx !== -1 ? sorted[defaultIdx] : sorted[0]);
          setPhase('auth-pick');
        }
      } catch (e) {
        if (cancelled) return;
        const errorName = e instanceof Error ? e.name : '';
        const errorCode = (e as { code?: string })?.code;
        const isCancelled = errorName === 'NotAllowedError' || errorName === 'AbortError'
          || errorCode === 'USER_CANCELLED';
        // Definitive "no credential on this device" signal. On native this
        // comes from the SDK provider with autoRegister=false (we set
        // mode='sign-in' above). It distinguishes a deleted-from-Settings
        // case from a cancelled prompt, which is what lets us recover.
        const isCredentialNotFound = errorCode === 'CREDENTIAL_NOT_FOUND';
        if (hasPasskeyHistory()) {
          if (isCredentialNotFound) {
            // The OS no longer has this user's passkey, but our local
            // hasPasskeyHistory flag says we registered one before.
            // Most likely cause: user deleted the passkey via
            // Settings → Passwords. Stale local state. Reset and route
            // them to the new-user create flow with an explanation.
            logger.warn(LogCategory.AUTH, 'Sign-in returned CredentialNotFound for returning user, clearing stale state');
            await clearPasskeyHistory();
            if (cancelled) return;
            setError(
              'Your Glow passkey is no longer on this device. You can create a new one.',
            );
            setPhase('review');
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
          // Returning user, second failure (cancelled prompt, relay
          // error, transient network, or stage-2 sync still pending).
          // Never silently fall to creation: surface a retryable error
          // and stay on detecting.
          logger.warn(LogCategory.AUTH, 'Sign-in failed for returning user, NOT auto-registering', {
            errorName,
            errorCode,
            error: e instanceof Error ? e.message : String(e),
          });
          setError(
            isCancelled
              ? 'Sign-in cancelled. Please try again.'
              : 'Could not sign in with your passkey. Please try again.',
          );
          setErrorKind('sign-in-failed');
          return;
        }
        logger.info(LogCategory.AUTH, 'No existing passkey, starting new user flow');
        setPhase('review');
      }
    };

    run();
    return () => {
      cancelled = true;
      passkeyPrfProvider.onAuthComplete = undefined;
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
        setPhase('new-storing');
      } catch (e) {
        if (cancelled) return;
        // Platform refused because excludeCredentials matched an
        // already-registered passkey. Don't surface this as an error:
        // since we know the user has a usable passkey, just route
        // them straight into the sign-in flow. They get the right
        // outcome (signed into their existing wallet) without seeing
        // a confusing "passkey already exists" error.
        if (e instanceof PasskeyAlreadyExistsError) {
          logger.info(LogCategory.AUTH, 'Create flow detected existing passkey, auto-routing to sign-in');
          // Restore the persistent flag so HomePage and the rest of
          // the app treat this as a returning-user session.
          localStorage.setItem('passkeyRegistered', '1');
          setIsNewUser(false);
          // Reset detect-fail counter so the upcoming sign-in attempt
          // gets the fresh-install retry budget if applicable.
          detectingFailCountRef.current = 0;
          // Skip aasa-checking: it was already verified earlier in
          // this session and re-running it would bounce through the
          // skipDetection -> review path, putting the user right back
          // on the create flow they just came from.
          setPhase('detecting');
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

  // Connect: derive wallet (final prompt)
  useEffect(() => {
    if (phase !== 'connecting' || error) return;
    let cancelled = false;

    const run = async () => {
      try {
        const w = await getWallet(connectLabelRef.current);
        if (cancelled) return;
        logger.info(LogCategory.AUTH, 'Passkey wallet derived');

        // Remember label locally
        if (connectLabelRef.current) {
          setPasskeyMode(connectLabelRef.current);
        }

        setPhase('initializing');
        onWalletRestoredRef.current(w.seed, w.label);
      } catch (e) {
        if (cancelled) return;
        setError('Failed to connect');
        setErrorKind('generic');
        logger.error(LogCategory.AUTH, 'Passkey wallet restore failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    };

    run();
    return () => { cancelled = true; };
  }, [phase, error]);

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
                className="w-full bg-spark-surface rounded-xl px-3 py-2 text-spark-text-primary placeholder:text-spark-text-muted focus:outline-none focus:ring-2 focus:ring-spark-primary/50 text-sm"
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
              `break-words` (overflow-wrap: break-word) only splits at
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
      case 'detecting': return error ? null : renderSpinner(detectingText);
      case 'review': return renderReview();
      // When the create flow fails the AlertCard alone is the page;
      // re-rendering renderReview() (icon, heading, warning card)
      // alongside it crowds the layout and competes with the error
      // for the user's attention. The footer carries the recovery
      // actions.
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
            Retry check
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
            Share diagnostic logs
          </SecondaryButton>
          <SecondaryButton className="w-full" onClick={onBack}>
            Go Back
          </SecondaryButton>
        </div>
      );
    }

    // Detecting failure for a returning user: iOS may surface this as
    // either a CredentialNotFound error (which we auto-recover from) or
    // a USER_CANCELLED (which we can't distinguish from a "no passkey"
    // dismissal of the system sheet). For the latter case, we leave the
    // user on the error screen and offer two paths:
    //   1. Try Again — re-runs detecting (auto-recovers if iOS now
    //      reports CredentialNotFound clearly).
    //   2. Forget passkey & create new — explicit recovery: clears the
    //      keychain + localStorage flag and routes to the create flow.
    //      For users whose passkey really is gone (deleted via
    //      Settings) but iOS reports the dismissal as a cancel.
    if (error && phase === 'detecting' && hasPasskeyHistory()) {
      return (
        <div className="max-w-xl mx-auto space-y-3">
          <PrimaryButton className="w-full" onClick={() => {
            setError(null);
            // Bounce through aasa-checking to force the detecting effect
            // to re-run. Just clearing `error` while staying on detecting
            // doesn't re-trigger the effect (its deps are [phase] only),
            // and the AASA precheck is cheap (no biometric prompt).
            setPhase('aasa-checking');
          }}>
            Try Again
          </PrimaryButton>
          <SecondaryButton className="w-full" onClick={async () => {
            await clearPasskeyHistory();
            setError(null);
            setIsNewUser(true);
            setPhase('review');
          }}>
            Create Passkey
          </SecondaryButton>
        </div>
      );
    }

    // "Already exists" recovery: a passkey is on the device but the
    // user landed on the create flow (post-uninstall race, dev wipe,
    // etc.). Offer the right action — sign in with the existing
    // passkey — as the primary, with Try Again as a secondary safety
    // net for users who'd rather poke the create flow again.
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
            // Route DIRECTLY to detecting, skipping aasa-checking.
            // We're entering this branch from a `passkeyCreate` route
            // (skipDetection=true), and the aasa-checking effect's
            // post-success transition reads skipDetection and routes
            // back to 'review' — bouncing the user right back to the
            // create flow. AASA was already verified earlier in this
            // session, so re-running it is redundant anyway.
            setPhase('detecting');
          }}>
            Use Passkey
          </PrimaryButton>
          <SecondaryButton className="w-full" onClick={handleRetry}>
            Try Again
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
      return (
        <div className="max-w-xl mx-auto space-y-3">
          <PrimaryButton className="w-full" onClick={() => {
            setIsNewUser(true);
            setError(null);
            setPhase('creating');
          }}>
            I understand
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
                // New label → save to relays first, then connect
                connectLabelRef.current = trimmedManual;
                setError(null);
                setPhase('new-storing');
              } else {
                // Existing label → connect directly
                connectLabelRef.current = selectedLabel || undefined;
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
        {/* Hide the stepper while an error is showing: the user isn't
            actively progressing through a step, and a half-filled bar
            below an "already exists" / "couldn't create" AlertCard
            reads as visual clutter rather than progress feedback. */}
        {isNewUser && !error && (
          <StepperBar stepCount={3} activeIndex={newUserStepIndex(phase)} />
        )}
        <div className="mt-6 space-y-4 flex flex-col flex-1">
          {content}
          {error && (
            <AlertCard
              variant="error"
              title={
                errorKind === 'already-exists'
                  ? 'Passkey already exists'
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
              <p className="text-spark-text-secondary text-sm break-words">
                {error}
              </p>
            </AlertCard>
          )}
        </div>
      </div>
    </PageLayout>
  );
};

export default PasskeyPage;
