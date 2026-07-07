import React from 'react';
import { PrimaryButton } from '@/components/ui/buttons';

interface DoneStepProps {
  onDone: () => void;
  /** Labels whose Lightning address couldn't be moved (funds are fine). */
  lnAddressFailedLabels?: string[];
}

/** Success screen after the new wallet has been adopted. */
const DoneStep: React.FC<DoneStepProps> = ({ onDone, lnAddressFailedLabels = [] }) => (
  <>
    <p className="text-sm text-spark-text-secondary mb-4 text-center">
      Your funds have been moved to your new passkey.
    </p>
    {lnAddressFailedLabels.length > 0 && (
      <p className="text-xs text-spark-warning mb-4 text-center">
        {lnAddressFailedLabels.length === 1
          ? `Your Lightning address for "${lnAddressFailedLabels[0]}" couldn't be transferred. Payments sent to it will continue to arrive in your old wallet until the transfer is complete.`
          : `Your Lightning addresses for ${lnAddressFailedLabels.map((l) => `"${l}"`).join(', ')} couldn't be transferred. Payments sent to them will continue to arrive in your old wallets until the transfers are complete.`}
      </p>
    )}
    <div className="flex flex-col gap-3">
      <PrimaryButton onClick={onDone}>Done</PrimaryButton>
    </div>
  </>
);

export default DoneStep;
