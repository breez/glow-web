import React, { useState } from 'react';
import { FormError } from './ui/forms';
import { EyeIcon } from './Icons';

interface PasswordFormProps {
  mode: 'setup' | 'unlock';
  onSubmit: (password: string) => void;
  isLoading?: boolean;
  error?: string | null;
}

function getStrength(password: string): { level: 'weak' | 'medium' | 'strong'; label: string } {
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const mixCount = [hasUpper, hasLower, hasNumber, hasSymbol].filter(Boolean).length;

  if (password.length >= 16 || (password.length >= 10 && mixCount >= 3)) {
    return { level: 'strong', label: 'Strong' };
  }
  if (password.length >= 10 || (password.length >= 8 && mixCount >= 2)) {
    return { level: 'medium', label: 'Medium' };
  }
  return { level: 'weak', label: 'Weak' };
}

const strengthColors = {
  weak: 'bg-spark-error',
  medium: 'bg-spark-warning',
  strong: 'bg-spark-success',
};

const strengthWidths = {
  weak: 'w-1/3',
  medium: 'w-2/3',
  strong: 'w-full',
};

const PasswordForm: React.FC<PasswordFormProps> = ({
  mode,
  onSubmit,
  isLoading = false,
  error = null,
}) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const isSetup = mode === 'setup';
  const strength = isSetup && password.length > 0 ? getStrength(password) : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (password.length === 0) {
      setValidationError('Password is required');
      return;
    }

    if (isSetup) {
      if (password.length < 8) {
        setValidationError('Password must be at least 8 characters');
        return;
      }
      if (password !== confirmPassword) {
        setValidationError('Passwords do not match');
        return;
      }
    }

    onSubmit(password);
  };

  const displayError = validationError || error;

  const inputClasses = 'w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 text-spark-text-primary placeholder-spark-text-muted focus:border-spark-primary focus:ring-2 focus:ring-spark-primary/20 transition-all';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Hidden username field for password manager autofill */}
      <input
        type="text"
        name="username"
        value="glow-wallet"
        autoComplete="username"
        aria-hidden="true"
        tabIndex={-1}
        readOnly
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
      />

      {/* Password field */}
      <div>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            name="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setValidationError(null);
            }}
            autoComplete={isSetup ? 'new-password' : 'current-password'}
            placeholder={isSetup ? 'Create a password' : 'Enter password'}
            minLength={isSetup ? 8 : undefined}
            className={`${inputClasses} pr-12`}
            disabled={isLoading}
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-spark-text-muted hover:text-spark-text-primary transition-colors"
            tabIndex={-1}
          >
            <EyeIcon size="md" />
          </button>
        </div>

        {/* Strength indicator (setup only) */}
        {isSetup && strength && (
          <div className="mt-2 space-y-1">
            <div className="h-1 w-full bg-spark-border rounded-full overflow-hidden">
              <div className={`h-full ${strengthColors[strength.level]} ${strengthWidths[strength.level]} rounded-full transition-all duration-300`} />
            </div>
            <p className="text-xs text-spark-text-muted">{strength.label}</p>
          </div>
        )}
      </div>

      {/* Confirm password (setup only) */}
      {isSetup && (
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            name="confirm-password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setValidationError(null);
            }}
            autoComplete="new-password"
            placeholder="Confirm password"
            className={inputClasses}
            disabled={isLoading}
          />
        </div>
      )}

      {/* Error */}
      <FormError error={displayError} />

      {/* Submit */}
      <button
        type="submit"
        disabled={isLoading}
        className={`button w-full ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {isLoading
          ? (isSetup ? 'Encrypting...' : 'Unlocking...')
          : (isSetup ? 'Set Password' : 'Unlock')
        }
      </button>

      {/* Password manager tip (setup only) */}
      {isSetup && (
        <p className="text-xs text-spark-text-muted text-center">
          Use your password manager to generate a strong password
        </p>
      )}
    </form>
  );
};

export default PasswordForm;
