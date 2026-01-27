import React from 'react';

interface LoadingSpinnerProps {
  text?: string;
  size?: 'small' | 'medium' | 'large';
  className?: string;
  subtext?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  text,
  subtext,
  size = 'large',
  className = ''
}) => {
  const sizeConfig = {
    small: { container: 'w-6 h-6', outer: 2, inner: 1.5 },
    medium: { container: 'w-10 h-10', outer: 2, inner: 1.5 },
    large: { container: 'w-12 h-12', outer: 2.5, inner: 2 }
  };

  const config = sizeConfig[size];

  return (
    <div
      className={`flex flex-col items-center justify-center ${className}`}
      data-testid="loading-indicator"
    >
      {/* Spinner container */}
      <div className={`relative ${config.container}`}>
        {/* Outer ring */}
        <svg className="w-full h-full" viewBox="0 0 40 40">
          <circle
            cx="20"
            cy="20"
            r="17"
            fill="none"
            stroke="rgba(212, 165, 116, 0.15)"
            strokeWidth={config.outer}
          />
          <circle
            cx="20"
            cy="20"
            r="17"
            fill="none"
            stroke="#d4a574"
            strokeWidth={config.outer}
            strokeLinecap="round"
            strokeDasharray="80 27"
            style={{
              animation: 'spin 1s cubic-bezier(0.5, 0.2, 0.5, 0.8) infinite',
              transformOrigin: 'center'
            }}
          />
        </svg>

        {/* Inner ring (counter-rotating) */}
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 40 40"
          style={{ padding: '15%' }}
        >
          <circle
            cx="20"
            cy="20"
            r="17"
            fill="none"
            stroke="rgba(212, 165, 116, 0.4)"
            strokeWidth={config.inner}
            strokeLinecap="round"
            strokeDasharray="40 67"
            style={{
              animation: 'spin 0.7s cubic-bezier(0.5, 0.2, 0.5, 0.8) infinite reverse',
              transformOrigin: 'center'
            }}
          />
        </svg>
      </div>

      {/* Text */}
      {text && (
        <p className="mt-4 font-display font-medium text-spark-text-primary text-sm">
          {text}
        </p>
      )}
      {subtext && (
        <p className="mt-1 text-spark-text-muted text-xs">
          {subtext}
        </p>
      )}

      {/* Keyframes for spin animation */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default LoadingSpinner;
