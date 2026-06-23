import React from 'react';
import { PrimaryButton } from '@/components/ui/buttons';

interface DoneStepProps {
  onDone: () => void;
}

/** Success screen after the new wallet has been adopted. */
const DoneStep: React.FC<DoneStepProps> = ({ onDone }) => (
  <>
    <p className="text-sm text-spark-text-secondary mb-4 text-center">
      Your funds were moved to the new passkey.
    </p>
    <div className="flex flex-col gap-3">
      <PrimaryButton onClick={onDone}>Done</PrimaryButton>
    </div>
  </>
);

export default DoneStep;
