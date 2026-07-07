import React from 'react';
import { PrimaryButton } from '@/components/ui/buttons';

interface DoneStepProps {
  onDone: () => void;
  /** Warn that incoming Lightning payments may still land in the old wallet. */
  lnAddressTransferFailed?: boolean;
}

/** Success screen after the new wallet has been adopted. */
const DoneStep: React.FC<DoneStepProps> = ({ onDone, lnAddressTransferFailed }) => (
  <>
    <p className="text-sm text-spark-text-secondary mb-4 text-center">
      Your funds have been moved to your new passkey.
    </p>
    {lnAddressTransferFailed && (
      <p className="text-xs text-spark-warning mb-4 text-center">
        Your Lightning address couldn't be transferred. 
        Payments sent to it will continue to arrive in your old wallet until the transfer is complete.
      </p>
    )}
    <div className="flex flex-col gap-3">
      <PrimaryButton onClick={onDone}>Done</PrimaryButton>
    </div>
  </>
);

export default DoneStep;
