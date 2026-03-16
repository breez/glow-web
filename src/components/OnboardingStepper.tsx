import React from 'react';
import { CheckIcon } from './Icons';

// ============================================
// Types
// ============================================

interface StepperBarProps {
  stepCount: number;
  activeIndex: number;
}

// ============================================
// StepperBar — horizontal numbered progress indicator
// ============================================

const StepperBar: React.FC<StepperBarProps> = ({ stepCount, activeIndex }) => (
  <div className="flex items-center w-full px-4 py-3">
    {Array.from({ length: stepCount }, (_, index) => {
      const isCompleted = index < activeIndex;
      const isActive = index === activeIndex;

      return (
        <React.Fragment key={index}>
          {/* Step circle */}
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
              isCompleted
                ? 'bg-spark-primary text-spark-void'
                : isActive
                  ? 'bg-spark-primary/20 border-2 border-spark-primary text-spark-primary'
                  : 'border-2 border-spark-border text-spark-text-muted'
            }`}
          >
            {isCompleted ? (
              <CheckIcon size="xs" className="text-spark-void" />
            ) : (
              index + 1
            )}
          </div>

          {/* Connector line */}
          {index < stepCount - 1 && (
            <div
              className={`flex-1 h-px mx-2 transition-colors duration-300 ${
                index < activeIndex ? 'bg-spark-primary' : 'bg-spark-border'
              }`}
            />
          )}
        </React.Fragment>
      );
    })}
  </div>
);

export default StepperBar;
