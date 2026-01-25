import React from 'react';

export interface ProcessingStepProps {
  /** Operation type to customize messaging (default: 'payment') */
  operationType?: 'payment' | 'auth';
}

const ProcessingStep: React.FC<ProcessingStepProps> = ({ operationType = 'payment' }) => {
  const isAuth = operationType === 'auth';

  const getTitle = () => isAuth ? 'Authenticating...' : 'Sending...';
  const getDescription = () => isAuth
    ? 'Please wait while we verify your identity...'
    : 'Please wait while we process your transaction...';

  // Key icon for auth, lightning bolt for payment
  const renderIcon = () => {
    if (isAuth) {
      return (
        <svg
          className="w-10 h-10 text-spark-electric"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
        </svg>
      );
    }
    return (
      <svg
        className="w-10 h-10 text-spark-electric"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
      </svg>
    );
  };

  return (
    <div className="flex flex-col items-center justify-center py-12">
      {/* Animated icon */}
      <div className="relative mb-8">
        {/* Outer glow */}
        <div className="absolute inset-0 w-24 h-24 rounded-full bg-spark-electric/20 blur-xl animate-pulse" />

        {/* Main circle */}
        <div className="relative w-24 h-24 rounded-full bg-spark-surface border-2 border-spark-electric flex items-center justify-center">
          {/* Spinning ring */}
          <span className="absolute inset-0 w-full h-full animate-spin" style={{ animationDuration: '2s' }}>
            <svg className="w-full h-full" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="46"
                fill="none"
                stroke="url(#processing-gradient)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray="100 200"
              />
              <defs>
                <linearGradient id="processing-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#00d4ff" />
                  <stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </span>

          {/* Icon */}
          {renderIcon()}
        </div>
      </div>

      {/* Text */}
      <h3 className="font-display text-xl font-semibold text-spark-text-primary mb-2">
        {getTitle()}
      </h3>
      <p className="text-spark-text-secondary text-sm text-center max-w-xs">
        {getDescription()}
      </p>

      {/* Animated dots */}
      <div className="flex gap-1 mt-6">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-spark-electric"
            style={{
              animation: 'bounce 1s ease-in-out infinite',
              animationDelay: `${i * 0.15}s`
            }}
          />
        ))}
      </div>
    </div>
  );
};

export default ProcessingStep;
