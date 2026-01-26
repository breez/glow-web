import React from 'react';

/**
 * Loading spinner component with optional text label.
 */

export type SpinnerSize = 'small' | 'medium' | 'large';

const sizeClasses: Record<SpinnerSize, string> = {
  small: 'w-5 h-5',
  medium: 'w-8 h-8',
  large: 'w-12 h-12',
};

export interface LoadingSpinnerProps {
  text?: string;
  size?: SpinnerSize;
  className?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  text,
  size = 'medium',
  className = "",
}) => (
  <div className={`flex flex-col items-center justify-center ${className}`}>
    <div className="relative">
      <div className={`${sizeClasses[size]} border-2 border-spark-border border-t-spark-primary rounded-full animate-spin`} />
    </div>
    {text && (
      <p className="mt-3 text-sm text-spark-text-secondary">{text}</p>
    )}
  </div>
);

export default LoadingSpinner;
