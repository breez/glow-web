/**
 * Lock Screen page (native only). No PIN set => a "Create PIN" row.
 * PIN set => the page opens behind an auth gate (biometrics first
 * when enabled, PIN pad as fallback) and offers: deactivate PIN,
 * auto-lock timeout, change PIN, enable <biometry>. Backup lives as
 * its own top-level Settings entry; BackupPage gates itself.
 */

import React, { useEffect, useRef, useState } from 'react';
import SlideInPage from '../components/layout/SlideInPage';
import { PinEntry, PinGate, PinScreenLayout } from '../components/PinEntry';
import { Switch, LoadingSpinner } from '../components/ui';
import { ChevronRightIcon, FaceIdIcon, FingerprintIcon, ShieldCheckIcon } from '../components/Icons';
import {
  AUTO_LOCK_OPTIONS_SECONDS,
  formatAutoLockOption,
  getAutoLockSeconds,
  setAutoLockSeconds,
  isBiometricGateEnabled,
  setBiometricGateEnabled,
  isPinEnabled,
  setPin,
  clearPin,
} from '@/services/appLock';
import {
  authenticateBiometric,
  authenticateDeviceOwner,
  getBiometryStatus,
  BiometryInfo,
} from '@/services/secureStorage';
import { logger, LogCategory } from '@/services/logger';

type View =
  | 'loading'
  | 'gate'        // PIN/biometric gate before the options are shown
  | 'no-pin'      // PIN not set: just the Create PIN row
  | 'options'     // PIN set + gate passed
  | 'create-pin'  // two-step create flow
  | 'change-pin'; // two-step change flow

interface SecurityPageProps {
  onBack: () => void;
}

const SecurityPage: React.FC<SecurityPageProps> = ({ onBack }) => {
  const [view, setView] = useState<View>('loading');
  const [autoLock, setAutoLock] = useState<number>(120);
  const [biometricGate, setBiometricGate] = useState(false);
  const [biometry, setBiometry] = useState<BiometryInfo | null>(null);
  // iOS biometry lockout: recoverable via passcode, so the options view
  // shows a recovery row instead of silently dropping the biometric one.
  const [biometryLockedOut, setBiometryLockedOut] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  // Two-step PIN flow state (shared by create + change).
  const [pinStep, setPinStep] = useState<'enter' | 'verify'>('enter');
  const firstPinRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [pin, gate, seconds, biometryStatus] = await Promise.all([
        isPinEnabled(),
        isBiometricGateEnabled(),
        getAutoLockSeconds(),
        getBiometryStatus(),
      ]);
      if (cancelled) return;
      setBiometricGate(gate);
      setAutoLock(seconds);
      setBiometry(biometryStatus.info);
      setBiometryLockedOut(biometryStatus.lockedOut);
      setView(pin ? 'gate' : 'no-pin');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Mismatch feedback lives here, not in PinEntry: the step flip back
  // to 'enter' remounts PinEntry (key={pinStep}) and would eat it.
  const [flowError, setFlowError] = useState<string | null>(null);

  const startPinFlow = (target: 'create-pin' | 'change-pin') => {
    firstPinRef.current = null;
    setFlowError(null);
    setPinStep('enter');
    setView(target);
  };

  const handlePinFlowSubmit = async (pin: string): Promise<string | null> => {
    if (pinStep === 'enter') {
      firstPinRef.current = pin;
      setFlowError(null);
      setPinStep('verify');
      return null;
    }
    if (pin !== firstPinRef.current) {
      firstPinRef.current = null;
      setFlowError('PINs do not match. Try again.');
      setPinStep('enter');
      return null;
    }
    await setPin(pin);
    setView('options');
    return null;
  };

  const handleDeactivatePin = async () => {
    await clearPin();
    setBiometricGate(false);
    setView('no-pin');
  };

  const handleToggleBiometric = async () => {
    setOptionsError(null);
    if (biometricGate) {
      await setBiometricGateEnabled(false);
      setBiometricGate(false);
      return;
    }
    try {
      // Confirm the user can actually pass the prompt before enabling,
      // mirroring Misty's enable flow.
      await authenticateBiometric(`Enable ${biometry?.label ?? 'biometric'} unlock`);
      await setBiometricGateEnabled(true);
      setBiometricGate(true);
    } catch (e) {
      const code = (e as { code?: string }).code;
      logger.warn(LogCategory.AUTH, 'Enable biometric gate failed', { code });
      if (code !== 'USER_CANCELLED') {
        setOptionsError('Biometric authentication is not available. Check your device settings.');
      }
    }
  };

  const handleRecoverBiometry = async () => {
    setOptionsError(null);
    try {
      // Passcode-allowed prompt: succeeding clears the OS lockout.
      await authenticateDeviceOwner('Re-enable biometric unlock');
      const status = await getBiometryStatus();
      setBiometry(status.info);
      setBiometryLockedOut(status.lockedOut);
    } catch (e) {
      const code = (e as { code?: string }).code;
      logger.warn(LogCategory.AUTH, 'Biometry lockout recovery failed', { code });
      if (code !== 'USER_CANCELLED') {
        setOptionsError('Could not unlock biometrics. Check your device settings.');
      }
    }
  };

  const renderBody = () => {
    switch (view) {
      case 'loading':
        return (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="small" />
          </div>
        );

      case 'gate':
        return <PinGate reason="Unlock Lock Screen settings" onUnlocked={() => setView('options')} />;

      case 'no-pin':
        return (
          <div className="space-y-4">
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
              <button
                className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors"
                type="button"
                onClick={() => startPinFlow('create-pin')}
              >
                <div className="flex items-center gap-3">
                  <ShieldCheckIcon size="md" />
                  <span>Create PIN</span>
                </div>
                <ChevronRightIcon size="md" />
              </button>
            </div>
          </div>
        );

      case 'create-pin':
      case 'change-pin': {
        const isChange = view === 'change-pin';
        const title =
          pinStep === 'enter'
            ? isChange ? 'Enter your new PIN' : 'Choose a PIN'
            : isChange ? 'Confirm your new PIN' : 'Confirm your PIN';
        return (
          <PinScreenLayout
            className="pt-8 pb-14"
            prompt={<p className="text-center text-sm text-spark-text-secondary">{title}</p>}
          >
            {/* Mismatch feedback rides in PinEntry's own reserved error
                line (persistentError) so this screen keeps the exact
                shape of the gate / lock screens. */}
            <PinEntry key={pinStep} onSubmit={handlePinFlowSubmit} persistentError={flowError} />
          </PinScreenLayout>
        );
      }

      case 'options':
        return (
          <div className="space-y-4">
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-4 space-y-2">
            {/* Deactivate PIN (Misty pattern: an always-on switch whose
                only action is turning protection off) */}
            <div className="flex items-center justify-between px-4 py-3 border border-spark-border rounded-xl">
              <div className="flex items-center gap-3">
                <ShieldCheckIcon size="md" className="text-spark-text-secondary" />
                <span className="text-sm font-medium text-spark-text-primary">Deactivate PIN</span>
              </div>
              <Switch checked={true} onChange={() => { void handleDeactivatePin(); }} />
            </div>

            {/* Lock automatically */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border border-spark-border rounded-xl">
              <span className="text-sm font-medium text-spark-text-primary">Lock Automatically</span>
              <select
                value={autoLock}
                onChange={(e) => {
                  const seconds = parseInt(e.currentTarget.value, 10);
                  setAutoLock(seconds);
                  void setAutoLockSeconds(seconds);
                }}
                className="bg-spark-surface border border-spark-border rounded-xl px-3 py-2 text-spark-text-primary text-sm focus:border-spark-primary focus:ring-2 focus:ring-spark-primary/20"
                aria-label="Lock automatically"
              >
                {AUTO_LOCK_OPTIONS_SECONDS.map((seconds) => (
                  <option className="bg-spark-surface" key={seconds} value={seconds}>
                    {formatAutoLockOption(seconds)}
                  </option>
                ))}
              </select>
            </div>

            {/* Change PIN */}
            <button
              className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors"
              type="button"
              onClick={() => startPinFlow('change-pin')}
            >
              <span>Change PIN</span>
              <ChevronRightIcon size="md" />
            </button>

            {/* Biometry locked out (iOS: too many failed matches).
                Shown in place of the enable row so the feature doesn't
                silently vanish; passing the passcode prompt clears the
                OS lockout and restores the normal toggle. */}
            {biometry == null && biometryLockedOut && (
              <button
                className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors"
                type="button"
                onClick={() => { void handleRecoverBiometry(); }}
              >
                <div className="flex items-center gap-3 text-left">
                  <FingerprintIcon size="md" />
                  <div>
                    <span className="block text-spark-text-primary">Biometric Unlock Locked</span>
                    <span className="block text-xs text-spark-text-muted">
                      Too many failed attempts. Tap to unlock with your passcode.
                    </span>
                  </div>
                </div>
                <ChevronRightIcon size="md" />
              </button>
            )}

            {/* Enable biometrics (only when the device has them) */}
            {biometry != null && (
              <div className="flex items-center justify-between px-4 py-3 border border-spark-border rounded-xl">
                <div className="flex items-center gap-3">
                  {biometry.kind === 'face'
                    ? <FaceIdIcon size="md" className="text-spark-text-secondary" />
                    : <FingerprintIcon size="md" className="text-spark-text-secondary" />}
                  <span className="text-sm font-medium text-spark-text-primary">
                    {`Enable ${biometry.label.replace(/\b\w/g, (c) => c.toUpperCase())}`}
                  </span>
                </div>
                <Switch checked={biometricGate} onChange={() => { void handleToggleBiometric(); }} />
              </div>
            )}

            {optionsError && (
              <p className="text-spark-primary text-xs px-1 pt-1">{optionsError}</p>
            )}
            </div>
          </div>
        );
    }
  };

  return (
    <SlideInPage title="Lock Screen" onClose={onBack} slideFrom="left">
      {/* min-h-full + flexed chain so the PIN views (gate, create,
          change) can split the viewport 1/3 header / 2/3 input; the
          list views just flow from the top as before. p-4 keeps the
          padding uniform on all sides. */}
      <div className="p-4 min-h-full flex flex-col">
        <div className="max-w-xl mx-auto w-full flex-1 flex flex-col">{renderBody()}</div>
      </div>
    </SlideInPage>
  );
};

export default SecurityPage;
