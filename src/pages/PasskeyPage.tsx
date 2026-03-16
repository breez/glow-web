import React, { useEffect, useRef, useState } from 'react';
import { Seed } from '@breeztech/breez-sdk-spark';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import LoadingSpinner from '../components/LoadingSpinner';
import PageLayout from '../components/layout/PageLayout';
import { AlertCard } from '../components/AlertCard';
import { NostrKeyIcon, CheckIcon, PasskeyIcon } from '../components/Icons';
import {
  createPasskey,
  getWallet,
  listLabels,
  saveLabel,
  setPasskeyMode,
} from '@/services/passkeyService';
import { passkeyPrfProvider } from '@/services/passkeyPrfProvider';
import { logger, LogCategory } from '@/services/logger';
import StepperBar from '@/components/OnboardingStepper';

// ============================================
// Types
// ============================================

/**
 * Phase state machine.
 *
 * On mount: "Use Passkey" was clicked → try listLabels() immediately.
 *   Success → passkey exists → returning user flow (auth-pick or connect-ready)
 *   Failure → no passkey    → new user flow (review)
 *
 * New user flow:
 *   detecting → review → creating (prompt 1) → created
 *             → new-storing (prompt 2) → connecting (prompt 3) → initializing
 *
 * Returning user flow (existing label):
 *   detecting (prompt 1) → auth-pick → connecting (prompt 2) → initializing
 *
 * Returning user flow (new label):
 *   detecting (prompt 1) → auth-pick → new-storing (prompt 2) → connecting (prompt 3) → initializing
 */
type Phase =
  | 'detecting'       // On mount: listLabels() — WebAuthn prompt, doubles as detection
  // New user flow
  | 'review'          // Warning + I understand → triggers createPasskey()
  | 'creating'        // createPasskey() in progress (prompt)
  | 'created'         // Create Passkey step: success screen
  | 'new-storing'     // Connect to Nostr step: saveLabel() in progress (prompt)
  // Returning user flow
  | 'auth-pick'       // Authenticate step: label picker
  // Shared
  | 'connecting'      // Connect to Nostr step: getWallet() in progress (prompt)
  | 'initializing';   // Initialize step: SDK connecting

/** Step index for the new user inline stepper (2 steps). */
function newUserStepIndex(phase: Phase): number {
  // Step 1: Create Passkey
  if (phase === 'creating') return 0;
  // Step 2: Initialize Glow
  if (phase === 'created' || phase === 'new-storing') return 1;
  // All complete
  return 2; // connecting, initializing — all steps show checkmarks
}


// ============================================
// Props
// ============================================

interface PasskeyPageProps {
  onWalletRestored: (seed: Seed, label: string) => void;
  onBack: () => void;
  sdkConnected?: boolean;
  onFlowComplete?: () => void;
}

// ============================================
// Component
// ============================================

const PasskeyPage: React.FC<PasskeyPageProps> = ({
  onWalletRestored,
  onBack,
  sdkConnected,
  onFlowComplete,
}) => {
  const [phase, setPhase] = useState<Phase>('detecting');
  const [isNewUser, setIsNewUser] = useState(false);
  const [labels, setLabels] = useState<string[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualLabel, setManualLabel] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [detectingText, setDetectingText] = useState('Detecting passkey...');

  // Stable refs for callbacks (avoid stale closures in effects)
  const onWalletRestoredRef = useRef(onWalletRestored);
  onWalletRestoredRef.current = onWalletRestored;
  const onFlowCompleteRef = useRef(onFlowComplete);
  onFlowCompleteRef.current = onFlowComplete;

  // Label to use when entering the connecting phase
  const connectLabelRef = useRef<string | undefined>(undefined);

  // ============================================
  // Effects — auto-triggered phases
  // ============================================

  // SDK finished connecting → complete flow
  useEffect(() => {
    if (sdkConnected && phase === 'initializing') {
      onFlowCompleteRef.current?.();
    }
  }, [sdkConnected, phase]);

  // On mount: detect passkey by trying listLabels() (WebAuthn get).
  // The "Use Passkey" button click on HomePage is the user interaction.
  // Success → passkey exists → returning user.
  // Failure → no passkey / cancelled → new user flow.
  useEffect(() => {
    if (phase !== 'detecting') return;
    let cancelled = false;

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
          // Passkey exists but no labels on relays — show picker with default pre-filled
          setShowManualInput(true);
          setManualLabel('Default');
          setPhase('auth-pick');
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
        // No passkey or user cancelled → new user flow
        logger.info(LogCategory.AUTH, 'No existing passkey, starting new user flow');
        setPhase('review');
      }
    };

    run();
    return () => {
      cancelled = true;
      passkeyPrfProvider.onAuthComplete = undefined;
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
        setPhase('created');
      } catch (e) {
        if (cancelled) return;
        setError('Failed to create passkey');
        logger.error(LogCategory.AUTH, 'Passkey creation failed', {
          error: e instanceof Error ? e.message : String(e),
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
  const handleRetry = () => setError(null);

  /** Navigate back from an error state to the previous interactive phase. */
  const handleErrorBack = () => {
    setError(null);
    switch (phase) {
      case 'creating':
        onBack();
        break;
      case 'new-storing':
        if (isNewUser) {
          setPhase('created');    // New user: back to Passkey Created
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


  const renderCreated = () => (
    <>
      <div className="flex justify-center mb-4">
        <div className="w-16 h-16 rounded-2xl bg-green-500/20 flex items-center justify-center">
          <CheckIcon size="xl" className="text-green-400" />
        </div>
      </div>

      <div className="text-center mb-4">
        <h2 className="text-xl font-display font-bold text-spark-text-primary mb-2">
          Your passkey was created successfully
        </h2>
        <p className="text-spark-text-secondary">
          Next, we'll save your label to Nostr and initialize Glow.
        </p>
      </div>
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
                className="w-full bg-spark-surface border border-spark-border rounded-xl px-3 py-2 text-spark-text-primary placeholder:text-spark-text-muted focus:outline-none focus:ring-2 focus:ring-spark-primary/50 focus:border-spark-primary text-sm"
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


  // ============================================
  // Content & footer routing
  // ============================================

  const content = (() => {
    switch (phase) {
      case 'detecting': return renderSpinner(detectingText);
      case 'review': return renderReview();
      case 'creating': return error ? renderReview() : renderSpinner('Creating passkey...');
      case 'created': return renderCreated();
      case 'new-storing':
        if (error) return null;
        return renderSpinner('Saving label...');
      case 'auth-pick': return renderAuthPick();
      case 'connecting':
        if (error) return null;
        return renderSpinner('Connecting...');
      case 'initializing':
        return renderSpinner('');
    }
  })();

  const footer = (() => {
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


    if (phase === 'created') {
      return (
        <div className="max-w-xl mx-auto space-y-3">
          <PrimaryButton className="w-full" onClick={() => {
            connectLabelRef.current = 'Default';
            setError(null);
            setPhase('new-storing');
          }}>
            Create & Connect
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
            {showManualInput ? 'Create & Connect' : 'Connect'}
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
        {isNewUser && (
          <StepperBar stepCount={2} activeIndex={newUserStepIndex(phase)} />
        )}
        <div className="mt-6 space-y-4 flex flex-col flex-1">
          {content}
          {error && (
            <AlertCard variant="error" title={error}>
              <p className="text-spark-text-secondary text-sm">
                {phase === 'new-storing' || phase === 'connecting'
                  ? 'Please check your internet connection and try again.'
                  : 'Please ensure your device supports passkeys and is the correct device.'}
              </p>
            </AlertCard>
          )}
        </div>
      </div>
    </PageLayout>
  );
};

export default PasskeyPage;
