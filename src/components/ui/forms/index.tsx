import React, { ReactNode } from 'react';
import { ErrorIcon } from '../../Icons';

/**
 * Form components for consistent input styling and validation feedback.
 */

export const FormGroup: React.FC<{
  children: ReactNode;
  className?: string;
}> = ({ children, className = "" }) => (
  <div className={`space-y-4 ${className}`}>
    {children}
  </div>
);

export const FormLabel: React.FC<{
  htmlFor: string;
  children: ReactNode;
}> = ({ htmlFor, children }) => (
  <label htmlFor={htmlFor} className="block text-sm font-medium text-spark-text-secondary mb-1">
    {children}
  </label>
);

export const FormDescription: React.FC<{
  children: ReactNode;
}> = ({ children }) => (
  <p className="text-sm text-spark-text-muted">
    {children}
  </p>
);

export interface FormInputProps {
  id: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  /**
   * Label shown on the soft keyboard's action (Enter) button.
   * Pass "next" for fields that advance focus within a form, "done"
   * or "go" / "send" / "search" for the last field that submits.
   */
  enterKeyHint?: React.InputHTMLAttributes<HTMLInputElement>['enterKeyHint'];
  /** Soft-keyboard type hint (email / numeric / decimal / search / tel / url / text). */
  inputMode?: React.InputHTMLAttributes<HTMLInputElement>['inputMode'];
  autoCapitalize?: string;
  autoCorrect?: 'on' | 'off';
  autoComplete?: string;
  spellCheck?: boolean;
  autoFocus?: boolean;
  name?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

export const FormInput: React.FC<FormInputProps> = ({
  id,
  type = "text",
  value,
  onChange,
  onKeyDown,
  placeholder,
  min,
  max,
  disabled = false,
  className = "",
  enterKeyHint,
  inputMode,
  autoCapitalize,
  autoCorrect,
  autoComplete,
  spellCheck,
  autoFocus,
  name,
  inputRef,
}) => (
  <input
    id={id}
    name={name}
    type={type}
    value={value}
    onChange={onChange}
    onKeyDown={onKeyDown}
    ref={inputRef}
    enterKeyHint={enterKeyHint}
    inputMode={inputMode}
    autoCapitalize={autoCapitalize}
    autoCorrect={autoCorrect}
    autoComplete={autoComplete}
    spellCheck={spellCheck}
    autoFocus={autoFocus}
    className={`w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 text-spark-text-primary placeholder-spark-text-muted focus:border-spark-primary focus:ring-0 transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    placeholder={placeholder}
    min={min}
    max={max}
    disabled={disabled}
  />
);

export interface FormTextareaProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  rows?: number;
}

export const FormTextarea: React.FC<FormTextareaProps> = ({
  value,
  onChange,
  placeholder,
  disabled = false,
  className = "",
  rows = 3,
}) => (
  <textarea
    value={value}
    onChange={onChange}
    className={`w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 text-spark-text-primary placeholder-spark-text-muted focus:border-spark-primary focus:ring-0 transition-all resize-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    placeholder={placeholder}
    disabled={disabled}
    rows={rows}
  />
);

export const FormError: React.FC<{
  error: string | null;
}> = ({ error }) => {
  if (!error) return null;
  return (
    <div className="flex items-center gap-2 text-spark-error text-sm mt-2">
      <ErrorIcon className="shrink-0" />
      <span>{error}</span>
    </div>
  );
};

export const FormHint: React.FC<{
  children: ReactNode;
}> = ({ children }) => (
  <p className="text-xs mt-1.5 text-spark-text-muted">
    {children}
  </p>
);
