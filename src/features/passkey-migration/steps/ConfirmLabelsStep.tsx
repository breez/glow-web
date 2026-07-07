import React from 'react';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';

interface ConfirmLabelsStepProps {
  labels: string[];
  primaryLabel: string;
  onContinue: () => void;
  onCancel: () => void;
}

/** Shows the discovered legacy wallets and asks the user to confirm before migrating. */
const ConfirmLabelsStep: React.FC<ConfirmLabelsStepProps> = ({
  labels,
  primaryLabel,
  onContinue,
  onCancel,
}) => (
  <>
    <p className="text-sm text-spark-text-secondary mb-3">
      {labels.length === 1
        ? "We'll migrate your label to your new passkey."
        : `We'll migrate all ${labels.length} labels to your new passkey.`}
    </p>
    <div className="bg-spark-surface rounded-xl p-3 mb-3">
      <ul className="space-y-1">
        {labels.map((label) => (
          <li key={label} className="text-sm text-spark-text-primary font-mono flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-spark-primary" />
            {label}
            {label === primaryLabel && (
              <span className="text-xs text-spark-text-muted">(current)</span>
            )}
          </li>
        ))}
      </ul>
    </div>
    <p className="text-xs text-spark-text-muted mb-4">
      You'll be asked to verify your identity multiple times during the migration: once for each label being migrated,
      then a few more times to create your new passkey. Please keep this window open until the migration is complete.
    </p>
    <div className="flex flex-col gap-3">
      <PrimaryButton onClick={onContinue}>Continue</PrimaryButton>
      <SecondaryButton onClick={onCancel}>Not now</SecondaryButton>
    </div>
  </>
);

export default ConfirmLabelsStep;
