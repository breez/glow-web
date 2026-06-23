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
      We found {labels.length} wallet{labels.length === 1 ? '' : 's'} on your legacy passkey.
      Each one will be migrated to a new passkey.
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
      You'll be asked to authenticate several times, once per wallet for the legacy passkey, plus
      a couple more for the new one. Please keep this window open until it's done.
    </p>
    <div className="flex flex-col gap-3">
      <PrimaryButton onClick={onContinue}>Continue</PrimaryButton>
      <SecondaryButton onClick={onCancel}>Not now</SecondaryButton>
    </div>
  </>
);

export default ConfirmLabelsStep;
