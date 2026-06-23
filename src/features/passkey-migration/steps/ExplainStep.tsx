import React from 'react';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import type { MigrationEntry } from '../types';

interface ExplainStepProps {
  entry: MigrationEntry;
  onContinue: () => void;
  onSecondary: () => void;
}

/** First screen: explains the upgrade and offers Continue + a per-entry opt-out. */
const ExplainStep: React.FC<ExplainStepProps> = ({ entry, onContinue, onSecondary }) => (
  <>
    {entry === 'banner' ? (
      <p className="text-sm text-spark-text-secondary mb-4">
        Your passkey needs upgrading. We'll create a new passkey and move your funds over
        automatically. You'll be asked to authenticate a few times along the way.
      </p>
    ) : (
      <p className="text-sm text-spark-text-secondary mb-4">
        Your passkey might need upgrading. If you created a passkey with a previous version of
        Glow, we'll move your funds over to a new one automatically. If this is your first time,
        choose <em>Skip</em> to continue.
      </p>
    )}
    <div className="flex flex-col gap-3">
      <PrimaryButton onClick={onContinue}>Continue</PrimaryButton>
      <SecondaryButton onClick={onSecondary}>{entry === 'banner' ? 'Not now' : 'Skip'}</SecondaryButton>
    </div>
  </>
);

export default ExplainStep;
