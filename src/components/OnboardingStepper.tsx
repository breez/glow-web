import React from 'react';
import { CheckIcon } from './Icons';

// ============================================
// Types
// ============================================

export interface StepDef {
  label: string;
}

interface StepperBarProps {
  steps: StepDef[];
  activeIndex: number;
}

// ============================================
// StepperBar — horizontal progress indicator
// ============================================

const StepperBar: React.FC<StepperBarProps> = ({ steps, activeIndex }) => (
  <div className="flex items-center w-full px-4 py-3">
    {steps.map((step, index) => {
      const isCompleted = index < activeIndex;
      const isActive = index === activeIndex;

      return (
        <React.Fragment key={index}>
          {/* Step */}
          <div className="flex items-center gap-1.5">
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
            <span
              className={`text-xs font-display font-medium transition-colors duration-300 ${
                isActive
                  ? 'text-spark-text-primary'
                  : isCompleted
                    ? 'text-spark-primary'
                    : 'text-spark-text-muted'
              }`}
            >
              {step.label}
            </span>
          </div>

          {/* Connector line */}
          {index < steps.length - 1 && (
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
