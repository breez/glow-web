/**
 * PIN entry UI (native app lock): Misty Breez's lock-screen pattern in
 * Glow's visual language, a row of masked digit dots above a 3x4
 * numeric pad. One component file for the dots, the pad, the
 * self-contained entry flow, and the in-page auth gate so every
 * consumer (create, change, gate, lock screen) renders identically.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PIN_LENGTH, isBiometricGateEnabled, isBiometricGateEnabledSync, verifyPin } from '@/services/appLock';
import { authenticateBiometric, getBiometryInfo, BiometryKind } from '@/services/secureStorage';
import { useBackButton } from '@/hooks/useBackButton';
import { BackspaceIcon, FaceIdIcon, FingerprintIcon, TrashIcon } from './Icons';

export const PinDots: React.FC<{ filled: number; error?: boolean }> = ({ filled, error = false }) => (
  <div
    className={`flex justify-center gap-4 ${error ? 'animate-pin-shake' : ''}`}
    role="status"
    aria-label={`${filled} of ${PIN_LENGTH} digits entered`}
  >
    {Array.from({ length: PIN_LENGTH }, (_, i) => (
      <div
        key={i}
        className={`w-5 h-5 rounded-full border-2 transition-colors ${
          i < filled
            ? error
              ? 'border-spark-primary bg-spark-primary/60'
              : 'border-spark-primary bg-spark-primary'
            : 'border-spark-border-light bg-transparent'
        }`}
      />
    ))}
  </div>
);

/**
 * Shared frame for every PIN surface (lock screen, gates, create /
 * change flows): logo + prompt + dots + error + pad as one group,
 * centered in the lower two thirds with the top third left as
 * breathing room. The logo rides 40dp above the prompt, one size on
 * every surface. Needs a flexed parent chain to stretch against; the
 * hosting page provides uniform padding.
 */
export const PinScreenLayout: React.FC<{
  prompt?: React.ReactNode;
  /** Extra classes on the root, e.g. `pt-8` on app-bar pages so the
   *  composition lands at the same screen position as the lock screen
   *  (measured: flex reabsorbs ~2/3 of the padding, 32px => 11px). */
  className?: string;
  children?: React.ReactNode;
}> = ({ prompt, className = '', children }) => (
  <div className={`flex-1 flex flex-col ${className}`}>
    <div className="flex-1" />
    <div className="flex-[2] flex flex-col justify-center">
      {/* w-36 = 144px, matching the HomePage / UnlockPage logo. mb-10 =
          40dp logo-to-label; mb-6 matches PinEntry's internal space-y-6
          rhythm so the prompt reads as part of the group. */}
      <img src="/assets/Glow_Logo.svg" alt="Glow" className="w-36 h-36 object-contain mx-auto mb-10" />
      {prompt && <div className="mb-6 text-center">{prompt}</div>}
      {children}
    </div>
  </div>
);

const PadButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  'aria-label'?: string;
  children: React.ReactNode;
}> = ({ onClick, disabled, children, 'aria-label': ariaLabel }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={ariaLabel}
    className="h-16 rounded-2xl font-display text-2xl text-spark-text-primary flex items-center justify-center hover:bg-white/5 active:bg-white/10 transition-colors disabled:opacity-40"
  >
    {children}
  </button>
);

export const PinPad: React.FC<{
  onDigit: (d: string) => void;
  onBackspace: () => void;
  /** Clears the whole PIN; shown in the bottom-left slot when no
   *  biometric button occupies it. */
  onClear: () => void;
  disabled?: boolean;
  /** Renders a biometric button in the bottom-left pad slot. */
  onBiometric?: () => void;
  /** Icon for the biometric button; fingerprint when unknown. */
  biometryKind?: BiometryKind;
}> = ({ onDigit, onBackspace, onClear, disabled = false, onBiometric, biometryKind = 'fingerprint' }) => (
  <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto w-full">
    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
      <PadButton key={d} onClick={() => onDigit(d)} disabled={disabled}>
        {d}
      </PadButton>
    ))}
    {onBiometric ? (
      <PadButton onClick={onBiometric} disabled={disabled} aria-label="Use biometrics">
        {biometryKind === 'face'
          ? <FaceIdIcon size="lg" className="text-spark-primary" />
          : <FingerprintIcon size="lg" className="text-spark-primary" />}
      </PadButton>
    ) : (
      <PadButton onClick={onClear} disabled={disabled} aria-label="Clear PIN">
        <TrashIcon size="lg" />
      </PadButton>
    )}
    <PadButton onClick={() => onDigit('0')} disabled={disabled}>
      0
    </PadButton>
    <PadButton onClick={onBackspace} disabled={disabled} aria-label="Delete digit">
      <BackspaceIcon size="lg" />
    </PadButton>
  </div>
);

/**
 * Self-contained PIN collection: dots + pad + error line. Calls
 * `onSubmit` once PIN_LENGTH digits are in; a returned error string is
 * shown and the input clears for another attempt. To clear the input
 * from outside (e.g. moving from "enter" to "verify"), remount with a
 * new React `key`.
 */
export const PinEntry: React.FC<{
  onSubmit: (pin: string) => Promise<string | null> | string | null;
  disabled?: boolean;
  onBiometric?: () => void;
  biometryKind?: BiometryKind;
  /** Parent-owned error shown in the same reserved line as internal
   *  errors (which take precedence). Lets multi-step flows surface
   *  mismatch feedback across a remount without adding a second error
   *  row that would change the screen's shape. */
  persistentError?: string | null;
}> = ({ onSubmit, disabled = false, onBiometric, biometryKind, persistentError = null }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleDigit = async (d: string) => {
    if (busy || pin.length >= PIN_LENGTH) return;
    setError(null);
    const next = pin + d;
    setPin(next);
    if (next.length === PIN_LENGTH) {
      setBusy(true);
      try {
        const result = await onSubmit(next);
        if (result != null) {
          setError(result);
          // Dots stay filled (red, shaking) through the hold, then
          // clear: one deliberate animation instead of an abrupt
          // wipe. The hold also stops a stray tap from eating the
          // error message or leaking into the next attempt.
          await new Promise((resolve) => setTimeout(resolve, 500));
          setPin('');
        }
      } finally {
        setBusy(false);
      }
    }
  };

  const shownError = error ?? persistentError;

  return (
    <div className="space-y-6">
      <PinDots filled={pin.length} error={error != null} />
      {/* NBSP placeholder, not a plain space: whitespace-only text
          collapses to a zero-height line box and the row grows 4px
          when real text lands (measured), shifting everything above. */}
      <p className={`text-center text-sm ${shownError ? 'text-spark-primary' : 'text-transparent'}`}>
        {shownError ?? '\u00A0'}
      </p>
      <PinPad
        onDigit={(d) => { void handleDigit(d); }}
        onBackspace={() => { setError(null); setPin((p) => p.slice(0, -1)); }}
        onClear={() => { setError(null); setPin(''); }}
        disabled={disabled || busy}
        onBiometric={onBiometric}
        biometryKind={biometryKind}
      />
    </div>
  );
};

/**
 * In-page app-lock gate: lock icon + PIN pad, with the OS biometric
 * prompt auto-fired once when the biometric gate is enabled in
 * Security settings (retriable from the pad's fingerprint button; PIN
 * always works as fallback). Renders inside a page body, unlike the
 * full-screen LockScreen overlay. Only meaningful when a PIN is set:
 * the caller checks `isPinEnabled()` before mounting.
 */
export const PinGate: React.FC<{
  /** Shown in the OS biometric prompt, e.g. "Unlock Security settings". */
  reason: string;
  onUnlocked: () => void;
}> = ({ reason, onUnlocked }) => {
  // Sync mirror seed so the first paint already knows whether to hold
  // the pad back for the biometric prompt; the async read reconciles
  // (a lost mirror degrades to showing the pad).
  const [biometricGate, setBiometricGate] = useState(() => isBiometricGateEnabledSync());
  // With the biometric gate on, the pad stays hidden until the OS
  // prompt settles: it only appears when the user cancels or biometrics
  // are unavailable.
  const [padVisible, setPadVisible] = useState(() => !isBiometricGateEnabledSync());
  // Auto-fire the biometric only once per mount; the pad's fingerprint
  // button re-fires it manually after a cancel.
  const bioFiredRef = useRef(false);

  // Face vs fingerprint icon for the pad's biometric slot.
  const [biometryKind, setBiometryKind] = useState<BiometryKind | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void getBiometryInfo().then((info) => {
      if (!cancelled && info) setBiometryKind(info.kind);
    });
    return () => { cancelled = true; };
  }, []);

  // Hardware back is absorbed while the gate is up, matching the
  // LockScreen. The page header's close button stays as the way out.
  useBackButton(useCallback(() => true, []), true);

  const runBiometric = useCallback(async () => {
    try {
      await authenticateBiometric(reason);
      onUnlocked();
    } catch {
      // Cancelled or unavailable: fall back to the PIN pad.
      setPadVisible(true);
    }
  }, [reason, onUnlocked]);

  useEffect(() => {
    let cancelled = false;
    void isBiometricGateEnabled().then((enabled) => {
      if (cancelled) return;
      setBiometricGate(enabled);
      if (!enabled) setPadVisible(true);
      else if (!bioFiredRef.current) {
        bioFiredRef.current = true;
        void runBiometric();
      }
    });
    return () => { cancelled = true; };
  }, [runBiometric]);

  // Biometric pending: keep the page body empty under the OS prompt.
  // The logo-and-pad composition only appears once the user cancels
  // into the PIN fallback.
  if (!padVisible) return null;

  return (
    // pt-8 aligns the composition with the (app-bar-less) lock screen.
    <PinScreenLayout
      className="pt-8 pb-14"
      prompt={
        <p className="text-sm text-spark-text-secondary">Enter your PIN to continue</p>
      }
    >
      <PinEntry
        onSubmit={async (pin) => {
          if (await verifyPin(pin)) {
            onUnlocked();
            return null;
          }
          return 'Incorrect PIN';
        }}
        // Gate flag AND live availability: with Face ID denied /
        // locked out / not enrolled, a biometric button would be a
        // dead control, so the slot stays empty and the pad's
        // delete button carries the row.
        onBiometric={biometricGate && biometryKind ? () => { void runBiometric(); } : undefined}
        biometryKind={biometryKind}
      />
    </PinScreenLayout>
  );
};
