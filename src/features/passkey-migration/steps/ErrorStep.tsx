import React from 'react';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { AlertCard } from '@/components/AlertCard';

interface ErrorStepProps {
  error: string | null;
  onRetry: () => void;
  onCancel: () => void;
}

/** Failure screen with Retry + Cancel. */
const ErrorStep: React.FC<ErrorStepProps> = ({ error, onRetry, onCancel }) => (
  <>
    <AlertCard variant="error" title="Migration failed">
      <p className="text-sm text-spark-text-secondary">{error ?? 'Something went wrong.'}</p>
    </AlertCard>
    <div className="flex flex-col gap-3 mt-4">
      <PrimaryButton onClick={onRetry}>Retry</PrimaryButton>
      <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
    </div>
  </>
);

export default ErrorStep;
