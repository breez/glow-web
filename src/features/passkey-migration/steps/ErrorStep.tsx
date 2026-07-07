import React from 'react';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { AlertCard } from '@/components/AlertCard';

interface ErrorStepProps {
  error: string | null;
  onRetry: () => void;
  onCancel: () => void;
  /** When set, offer a fresh-start action (the recorded passkey is unreachable). */
  onStartOver?: () => void;
}

/** Failure screen with Retry + Cancel, plus an optional fresh-start action. */
const ErrorStep: React.FC<ErrorStepProps> = ({ error, onRetry, onCancel, onStartOver }) => (
  <>
    <AlertCard variant="error" title="Migration failed">
      <p className="text-sm text-spark-text-secondary">{error ?? 'Something went wrong.'}</p>
    </AlertCard>
    <div className="flex flex-col gap-3 mt-4">
      <PrimaryButton onClick={onRetry}>Retry</PrimaryButton>
      {onStartOver && (
        <SecondaryButton onClick={onStartOver}>Create a new passkey</SecondaryButton>
      )}
      <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
    </div>
  </>
);

export default ErrorStep;
