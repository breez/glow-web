/**
 * SecurityPage (native only): Misty Breez's Security settings minus the
 * backup options. No PIN set => a single "Create PIN" row. PIN set =>
 * the page opens behind an auth gate (biometrics first when enabled,
 * PIN pad as fallback) and offers: deactivate PIN, auto-lock timeout,
 * change PIN, enable <biometry>.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import SlideInPage from '../components/layout/SlideInPage';
import { PinEntry } from '../components/PinEntry';
import { Switch, LoadingSpinner } from '../components/ui';
import { ChevronRightIcon, FingerprintIcon, LockIcon, ShieldCheckIcon } from '../components/Icons';
import {
  AUTO_LOCK_OPTIONS_SECONDS,
  formatAutoLockOption,
  getAutoLockSeconds,
  setAutoLockSeconds,
  isBiometricGateEnabled,
  setBiometricGateEnabled,
  isPinEnabled,
  setPin,
  verifyPin,
  clearPin,
} from '@/services/appLock';
import { authenticateBiometric, getBiometryLabel } from '@/services/secureStorage';
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
  const [biometryLabel, setBiometryLabel] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  // Two-step PIN flow state (shared by create + change).
  const [pinStep, setPinStep] = useState<'enter' | 'verify'>('enter');
  const firstPinRef = useRef<string | null>(null);

  // Auto-fire the biometric gate only once per page entry; the pad's
  // fingerprint button re-fires it manually after a cancel.
  const bioFiredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [pin, gate, seconds, label] = await Promise.all([
        isPinEnabled(),
        isBiometricGateEnabled(),
        getAutoLockSeconds(),
        getBiometryLabel(),
      ]);
      if (cancelled) return;
      setBiometricGate(gate);
      setAutoLock(seconds);
      setBiometryLabel(label);
      setView(pin ? 'gate' : 'no-pin');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runBiometricGate = useCallback(async () => {
    try {
      await authenticateBiometric('Unlock Security settings');
      setView('options');
    } catch {
      // Cancelled or unavailable: the PIN pad stays as fallback.
    }
  }, []);

  useEffect(() => {
    if (view === 'gate' && biometricGate && !bioFiredRef.current) {
      bioFiredRef.current = true;
      void runBiometricGate();
    }
  }, [view, biometricGate, runBiometricGate]);

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
      await authenticateBiometric(`Enable ${biometryLabel ?? 'biometric'} unlock`);
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

  const renderBody = () => {
    switch (view) {
      case 'loading':
        return (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="small" />
          </div>
        );

      case 'gate':
        return (
          <div className="pt-8 space-y-8">
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
                <LockIcon size="xl" className="text-spark-primary" />
              </div>
              <p className="text-sm text-spark-text-secondary">Enter your PIN to continue</p>
            </div>
            <PinEntry
              onSubmit={async (pin) => {
                if (await verifyPin(pin)) {
                  setView('options');
                  return null;
                }
                return 'Incorrect PIN';
              }}
              onBiometric={biometricGate ? () => { void runBiometricGate(); } : undefined}
            />
          </div>
        );

      case 'no-pin':
        return (
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
        );

      case 'create-pin':
      case 'change-pin': {
        const isChange = view === 'change-pin';
        const title =
          pinStep === 'enter'
            ? isChange ? 'Enter your new PIN' : 'Choose a PIN'
            : isChange ? 'Confirm your new PIN' : 'Confirm your PIN';
        return (
          <div className="pt-8 space-y-8">
            <p className="text-center text-sm text-spark-text-secondary">{title}</p>
            {flowError && (
              <p className="text-center text-sm text-spark-error">{flowError}</p>
            )}
            <PinEntry key={pinStep} onSubmit={handlePinFlowSubmit} />
          </div>
        );
      }

      case 'options':
        return (
          <div className="bg-spark-dark border border-spark-border rounded-2xl p-4 space-y-2">
            {/* Deactivate PIN */}
            <div className="flex items-center justify-between px-4 py-3 border border-spark-border rounded-xl">
              <div className="flex items-center gap-3">
                <ShieldCheckIcon size="md" className="text-spark-text-secondary" />
                <span className="text-sm font-medium text-spark-text-primary">PIN enabled</span>
              </div>
              <Switch checked={true} onChange={() => { void handleDeactivatePin(); }} />
            </div>

            {/* Lock automatically */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border border-spark-border rounded-xl">
              <span className="text-sm font-medium text-spark-text-primary">Lock automatically</span>
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

            {/* Enable biometrics (only when the device has them) */}
            {biometryLabel != null && (
              <div className="flex items-center justify-between px-4 py-3 border border-spark-border rounded-xl">
                <div className="flex items-center gap-3">
                  <FingerprintIcon size="md" className="text-spark-text-secondary" />
                  <span className="text-sm font-medium text-spark-text-primary">
                    {`Enable ${biometryLabel}`}
                  </span>
                </div>
                <Switch checked={biometricGate} onChange={() => { void handleToggleBiometric(); }} />
              </div>
            )}

            {optionsError && (
              <p className="text-spark-error text-xs px-1 pt-1">{optionsError}</p>
            )}
          </div>
        );
    }
  };

  return (
    <SlideInPage title="Security" onClose={onBack} slideFrom="left">
      <div className="p-4">
        <div className="max-w-xl mx-auto w-full">{renderBody()}</div>
      </div>
    </SlideInPage>
  );
};

export default SecurityPage;
