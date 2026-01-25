import React from 'react';
import { PrimaryButton } from '../../../components/ui';

export interface ResultStepProps {
  result: 'success' | 'failure';
  error: string | null;
  onClose: () => void;
}

const ResultStep: React.FC<ResultStepProps> = ({ result, error, onClose }) => {
  const isSuccess = result === 'success';

  return (
    <div className="flex flex-col items-center justify-center">
      {/* Result icon */}
      <div className="relative mb-6">
        {/* Glow effect */}
        <div 
          className={`absolute inset-0 w-24 h-24 rounded-full blur-xl ${
            isSuccess ? 'bg-spark-success/30' : 'bg-spark-error/30'
          }`}
        />
        
        {/* Icon circle */}
        <div 
          className={`relative w-24 h-24 rounded-full flex items-center justify-center ${
            isSuccess 
              ? 'bg-spark-success/20 border-2 border-spark-success' 
              : 'bg-spark-error/20 border-2 border-spark-error'
          }`}
        >
          {isSuccess ? (
            <svg className="w-12 h-12 text-spark-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-12 h-12 text-spark-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </div>
      </div>

      {/* Title */}
      <h3 className={`font-display text-2xl font-bold mb-2 ${
        isSuccess ? 'text-spark-success' : 'text-spark-error'
      }`}>
        {isSuccess ? 'Payment Sent!' : 'Payment Failed'}
      </h3>

      {/* Description */}
      <p className="text-spark-text-secondary text-center max-w-xs mb-8">
        {isSuccess 
          ? 'Your payment has been successfully sent to the recipient.'
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
