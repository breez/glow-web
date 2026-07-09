/**
 * PIN entry UI (native app lock): Misty Breez's lock-screen pattern in
 * Glow's visual language, a row of masked digit dots above a 3x4
 * numeric pad. One component file for the dots, the pad, and the
 * self-contained entry flow so every consumer (create, change, gate,
 * lock screen) renders identically.
 */

import React, { useState } from 'react';
import { PIN_LENGTH } from '@/services/appLock';
import { BackspaceIcon, FingerprintIcon } from './Icons';

export const PinDots: React.FC<{ filled: number; error?: boolean }> = ({ filled, error = false }) => (
  <div className="flex justify-center gap-4" role="status" aria-label={`${filled} of ${PIN_LENGTH} digits entered`}>
    {Array.from({ length: PIN_LENGTH }, (_, i) => (
      <div
        key={i}
        className={`w-4 h-4 rounded-full border transition-colors ${
          error
            ? 'border-spark-error bg-spark-error/60'
            : i < filled
              ? 'border-spark-primary bg-spark-primary'
              : 'border-spark-border bg-transparent'
        }`}
      />
    ))}
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
  disabled?: boolean;
  /** Renders a biometric button in the bottom-left pad slot. */
  onBiometric?: () => void;
}> = ({ onDigit, onBackspace, disabled = false, onBiometric }) => (
  <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto w-full">
    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
      <PadButton key={d} onClick={() => onDigit(d)} disabled={disabled}>
        {d}
      </PadButton>
    ))}
    {onBiometric ? (
      <PadButton onClick={onBiometric} disabled={disabled} aria-label="Use biometrics">
        <FingerprintIcon size="lg" className="text-spark-primary" />
      </PadButton>
    ) : (
      <div />
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
}> = ({ onSubmit, disabled = false, onBiometric }) => {
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
          setPin('');
        }
      } finally {
        setBusy(false);
      }
    }
  };

  return (
    <div className="space-y-6">
      <PinDots filled={pin.length} error={error != null} />
      <p className={`text-center text-sm min-h-5 ${error ? 'text-spark-error' : 'text-transparent'}`}>
        {error ?? ' '}
      </p>
      <PinPad
        onDigit={(d) => { void handleDigit(d); }}
        onBackspace={() => { setError(null); setPin((p) => p.slice(0, -1)); }}
        disabled={disabled || busy}
        onBiometric={onBiometric}
      />
    </div>
  );
};
