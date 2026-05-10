import React from 'react';
import { EyeIcon } from './Icons';
import { sanitizePasswordInput, PASSWORD_MAX_LENGTH } from '../utils/password';

const baseClasses = 'w-full bg-spark-dark border rounded-xl px-4 py-3 text-spark-text-primary placeholder-spark-text-muted focus:border-spark-primary focus:ring-2 focus:ring-spark-primary/20 transition-all';

// Distinguishes paste / autofill from ordinary typing so cross-syncing
// the confirm field can't corrupt state on fast typing or multi-char delete.
function isPasteOrAutofill(e: Event): boolean {
  const t = (e as InputEvent).inputType;
  return t === 'insertFromPaste' || t === 'insertReplacementText';
}

interface PasswordInputProps {
  name: string;
  value: string;
  onChange: (val: string) => void;
  /** Fires on paste / password-manager autofill. The recipient typically mirrors the value into the sibling field. */
  onAutofill?: (val: string) => void;
  placeholder: string;
  autoComplete: 'new-password' | 'current-password';
  minLength?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  hasError?: boolean;
  show: boolean;
  /** Renders the eye toggle when provided. */
  onToggleShow?: () => void;
}

const PasswordInput: React.FC<PasswordInputProps> = ({
  name,
  value,
  onChange,
  onAutofill,
  placeholder,
  autoComplete,
  minLength,
  disabled,
  autoFocus,
  hasError,
  show,
  onToggleShow,
}) => (
  <div className="relative">
    <input
      type={show ? 'text' : 'password'}
      name={name}
      value={value}
      onChange={(e) => {
        const val = sanitizePasswordInput(e.target.value);
        onChange(val);
        if (onAutofill && val.length > 0 && isPasteOrAutofill(e.nativeEvent)) onAutofill(val);
      }}
      autoComplete={autoComplete}
      placeholder={placeholder}
      minLength={minLength}
      maxLength={PASSWORD_MAX_LENGTH}
      disabled={disabled}
      autoFocus={autoFocus}
      className={`${baseClasses} ${hasError ? 'border-spark-error' : 'border-spark-border'} ${onToggleShow ? 'pr-12' : ''}`}
    />
    {onToggleShow && (
      <button
        type="button"
        onClick={onToggleShow}
        aria-label={show ? 'Hide password' : 'Show password'}
        tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-spark-text-muted hover:text-spark-text-primary transition-colors"
      >
        <EyeIcon size="md" />
      </button>
    )}
  </div>
);

export default PasswordInput;
