import React from 'react';
import type { ProcessingPhase } from '../hooks/useSendPayment';

export interface ProcessingStepProps {
  /** Operation type to customize messaging (default: 'payment') */
  operationType?: 'payment' | 'withdraw';
  /** Processing phase for conversion payments */
  processingPhase?: ProcessingPhase;
}

const ProcessingStep: React.FC<ProcessingStepProps> = ({ operationType = 'payment', processingPhase = 'sending' }) => {
  const isWithdraw = operationType === 'withdraw';
  const isConverting = processingPhase === 'converting';

  const getTitle = () => {
    if (isWithdraw) return 'Waiting for payment...';
    if (isConverting) return 'Converting...';
    return 'Sending...';
  };
  const getDescription = () => {
    if (isWithdraw) return 'Completing the transfer. This can take a moment...';
    if (isConverting) return 'Please wait while we convert the amount...';
    return 'Please wait while we process your transaction...';
  };

  return (
    <div className="flex flex-col items-center justify-center py-12">
      {/* Animated Glow logo */}
      <div className="relative mb-8">
        {/* Logo container with spinning ring */}
        <div className="relative w-24 h-24 flex items-center justify-center">
          {/* Spinning ring */}
          <span className="absolute inset-0 w-full h-full animate-spin" style={{ animationDuration: '3s' }}>
            <svg className="w-full h-full" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="46"
                fill="none"
                stroke="url(#processing-gradient)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="80 200"
              />
              <defs>
                <linearGradient id="processing-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#d4a574" />
                  <stop offset="100%" stopColor="#d4a574" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </span>

          <img
            src="/assets/Glow_Logo.svg"
            alt="Processing"
            className="w-14 h-14 object-contain animate-pulse drop-shadow-[0_0_15px_rgba(212,165,116,0.4)]"
            style={{ animationDuration: '2s' }}
          />
        </div>
      </div>

      {/* Text */}
      <h3 className="font-display text-xl font-semibold text-spark-text-primary mb-2">
        {getTitle()}
      </h3>
      <p className="text-spark-text-secondary text-sm text-center max-w-xs">
        {getDescription()}
      </p>

      {/* Animated dots in brand color */}
      <div className="flex gap-1.5 mt-6">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-spark-primary"
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
