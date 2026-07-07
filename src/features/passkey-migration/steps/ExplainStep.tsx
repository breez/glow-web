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
        We'll create a new passkey and automatically transfer your funds. 
        You'll be asked to verify your identity a few times during the process.
      </p>
    ) : (
      <p className="text-sm text-spark-text-secondary mb-4">
        If you created your passkey with an earlier version of Glow, we'll create a new one and transfer your funds automatically. 
        If this is your first time using Glow, choose <em>Skip</em> to continue.
      </p>
    )}
    <p className="text-xs text-spark-text-muted mb-4">
      Your funds will be transferred in a single transaction. Your payment history won't carry over.
    </p>
    <div className="flex flex-col gap-3">
      <PrimaryButton onClick={onContinue}>Continue</PrimaryButton>
      <SecondaryButton onClick={onSecondary}>{entry === 'banner' ? 'Not now' : 'Skip'}</SecondaryButton>
    </div>
  </>
);

export default ExplainStep;
