import React, { useState, useEffect } from 'react';
import { PrimaryButton } from '../../../components/ui';

// Star positions around the logo (smaller scale for in-dialog)
const STARS = [
  { x: -35, y: -28, size: 3 },
  { x: 38, y: -24, size: 2.5 },
  { x: -32, y: 32, size: 2.5 },
  { x: 35, y: 35, size: 2.5 },
  { x: -10, y: -42, size: 2.5 },
  { x: 14, y: 42, size: 3 },
  { x: -42, y: 6, size: 2.5 },
  { x: 44, y: -4, size: 2.5 },
];

export interface ResultStepProps {
  result: 'success' | 'failure';
  error: string | null;
  onClose: () => void;
}

const ResultStep: React.FC<ResultStepProps> = ({ result, error, onClose }) => {
  const isSuccess = result === 'success';
  const [starsAnimating, setStarsAnimating] = useState(false);

  useEffect(() => {
    if (isSuccess) {
      const timer = setTimeout(() => setStarsAnimating(true), 300);
      return () => clearTimeout(timer);
    }
  }, [isSuccess]);

  return (
    <div className="flex flex-col items-center justify-center py-4" data-testid={isSuccess ? 'payment-success' : 'payment-failure'}>
      {/* Result icon */}
      <div className="relative mb-6">
        {isSuccess ? (
          <>
            {/* Glow effect */}
            <div className="absolute -inset-3 rounded-full bg-spark-primary/20 blur-xl" />
            
            {/* Logo with sparkles */}
            <div className="relative w-20 h-20 flex items-center justify-center">
              <img
                src="/assets/Glow_Logo.png"
                alt="Glow"
                className="w-16 h-16 object-contain drop-shadow-[0_0_20px_rgba(212,165,116,0.5)]"
              />
              
              {/* Sparkle stars */}
              {STARS.map((star, i) => (
                <span
                  key={i}
                  className={`sidebar-star ${starsAnimating ? 'animate' : ''}`}
                  style={{
                    width: star.size,
                    height: star.size,
                    left: `calc(50% + ${star.x}px)`,
                    top: `calc(50% + ${star.y}px)`,
                    boxShadow: starsAnimating ? `0 0 ${star.size * 2}px var(--spark-primary)` : 'none',
                  }}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Error glow */}
            <div className="absolute inset-0 w-20 h-20 rounded-full blur-xl bg-spark-error/30" />
            
            {/* Error icon */}
            <div className="relative w-20 h-20 rounded-full flex items-center justify-center bg-spark-error/20 border-2 border-spark-error">
              <svg className="w-10 h-10 text-spark-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          </>
        )}
      </div>

      {/* Title */}
      <h3 className={`font-display text-2xl font-bold mb-2 ${
        isSuccess ? 'text-spark-primary' : 'text-spark-error'
      }`}>
        {isSuccess ? 'Payment Sent' : 'Payment Failed'}
      </h3>

      {/* Description */}
      <p className="text-spark-text-secondary text-center max-w-xs mb-8">
        {isSuccess 
          ? 'Your payment has been successfully sent.'
          : error || 'There was an error processing your payment. Please try again.'
        }
      </p>

      {/* Action button */}
      <PrimaryButton onClick={onClose} className="min-w-[200px]">
        {isSuccess ? 'Done' : 'Close'}
      </PrimaryButton>
    </div>
  );
};

export default ResultStep;
