import React, { useEffect, useRef, useState } from 'react';
import { FormError } from './ui/forms';
import PasswordInput from './PasswordInput';
import PasswordStrengthMeter from './PasswordStrengthMeter';
import {
  PASSWORD_MIN_LENGTH,
  validatePasswordSetup,
  validatePasswordUnlock,
} from '../utils/password';

interface PasswordFormProps {
  mode: 'setup' | 'unlock';
  onSubmit: (password: string) => void;
  isLoading?: boolean;
  error?: string | null;
  /** Set an id on the <form> so an external button can submit via form="id". */
  formId?: string;
  /** Hide the inline submit button (use with formId for external submit). */
  hideSubmit?: boolean;
}

function useShakeOnNewError(error: string | null): boolean {
  const [shaking, setShaking] = useState(false);
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (error && error !== prev.current) {
      setShaking(true);
      const t = setTimeout(() => setShaking(false), 400);
      return () => clearTimeout(t);
    }
    prev.current = error;
  }, [error]);
  return shaking;
}

const PasswordForm: React.FC<PasswordFormProps> = ({
  mode,
  onSubmit,
  isLoading = false,
  error = null,
  formId,
  hideSubmit = false,
}) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const isSetup = mode === 'setup';
  const displayError = validationError || error;
  const shaking = useShakeOnNewError(displayError);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = isSetup
      ? validatePasswordSetup(password, confirm)
      : validatePasswordUnlock(password);
    setValidationError(err);
    if (!err) onSubmit(password);
  };

  const onPasswordChange = (val: string) => {
    setPassword(val);
    setValidationError(null);
  };
  const onConfirmChange = (val: string) => {
    setConfirm(val);
    setValidationError(null);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" id={formId}>
      {/* Hidden username field anchors password-manager autofill. */}
      <input
        type="text"
        name="username"
        value="glow-label-username"
        autoComplete="username"
        aria-hidden="true"
        tabIndex={-1}
        readOnly
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
      />

      <div className={shaking ? 'animate-shake' : ''}>
        <PasswordInput
          name="password"
          value={password}
          onChange={onPasswordChange}
          onAutofill={isSetup ? setConfirm : undefined}
          placeholder={isSetup ? 'Create a password' : 'Enter password'}
          autoComplete={isSetup ? 'new-password' : 'current-password'}
          minLength={isSetup ? PASSWORD_MIN_LENGTH : undefined}
          disabled={isLoading}
          autoFocus
          hasError={!!displayError}
          show={show}
          onToggleShow={() => setShow(!show)}
        />
        {isSetup && <PasswordStrengthMeter password={password} />}
      </div>

      {isSetup && (
        <PasswordInput
          name="confirm-password"
          value={confirm}
          onChange={onConfirmChange}
          onAutofill={setPassword}
          placeholder="Confirm password"
          autoComplete="new-password"
          disabled={isLoading}
          hasError={!!displayError}
          show={show}
        />
      )}

      <FormError error={displayError} />

      {!hideSubmit && (
        <>
          <button
            type="submit"
            disabled={isLoading}
            className={`button w-full ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isLoading
              ? (isSetup ? 'Encrypting...' : 'Unlocking...')
              : (isSetup ? 'Set Password' : 'Unlock')}
          </button>
          {isSetup && (
            <p className="text-xs text-spark-text-muted text-center">
              Use your password manager to generate a strong password
            </p>
          )}
        </>
      )}
    </form>
  );
};

export default PasswordForm;
