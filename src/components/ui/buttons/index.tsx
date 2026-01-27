import React, { ReactNode } from 'react';

/**
 * Button components for consistent action styling across the app.
 */

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}

export const PrimaryButton: React.FC<ButtonProps> = ({
  onClick,
  disabled = false,
  children,
  className = "",
  ...props
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`button ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    {...props}
  >
    {children}
  </button>
);

export const SecondaryButton: React.FC<ButtonProps> = ({
  onClick,
  disabled = false,
  children,
  className = "",
  ...props
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`py-3 font-display font-semibold text-spark-text-secondary border border-spark-border rounded-xl hover:text-spark-text-primary hover:border-spark-border-light transition-colors disabled:opacity-50 ${className}`}
    {...props}
  >
    {children}
  </button>
);

export interface FloatingIconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  onClick?: () => void;
  icon: ReactNode;
  className?: string;
}

export const FloatingIconButton: React.FC<FloatingIconButtonProps> = ({
  onClick,
  icon,
  className = "",
  ...props
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`p-3 rounded-full bg-black/50 hover:bg-black/70 text-white backdrop-blur-sm transition-colors border border-white/10 ${className}`}
    {...props}
  >
    {icon}
  </button>
);

export const TextButton: React.FC<Omit<ButtonProps, 'disabled'>> = ({
  onClick,
  children,
  className = "",
  ...props
}) => (
  <button
    onClick={onClick}
    className={`text-spark-text-muted text-xs hover:text-spark-text-secondary transition-colors ${className}`}
    {...props}
  >
    {children}
  </button>
);
