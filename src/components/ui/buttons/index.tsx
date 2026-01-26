import React, { ReactNode } from 'react';

/**
 * Button components for consistent action styling across the app.
 */

export interface ButtonProps {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}

export const PrimaryButton: React.FC<ButtonProps> = ({
  onClick,
  disabled = false,
  children,
  className = "",
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`button ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
  >
    {children}
  </button>
);

export const SecondaryButton: React.FC<ButtonProps> = ({
  onClick,
  disabled = false,
  children,
  className = "",
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`py-3 font-display font-semibold text-spark-text-secondary border border-spark-border rounded-xl hover:text-spark-text-primary hover:border-spark-border-light transition-colors disabled:opacity-50 ${className}`}
  >
    {children}
  </button>
);

export const TextButton: React.FC<Omit<ButtonProps, 'disabled'>> = ({
  onClick,
  children,
  className = "",
}) => (
  <button
    onClick={onClick}
    className={`text-spark-text-muted text-xs hover:text-spark-text-secondary transition-colors ${className}`}
  >
    {children}
  </button>
);
