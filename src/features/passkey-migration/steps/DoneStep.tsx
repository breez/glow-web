import React from 'react';
import { PrimaryButton } from '@/components/ui/buttons';
import type { LnAddressFailure } from '../types';

interface DoneStepProps {
  onDone: () => void;
  /** Lightning addresses that couldn't be moved (funds are fine either way). */
  lnAddressFailures?: LnAddressFailure[];
}

/** Success screen after the new wallet has been adopted. */
const DoneStep: React.FC<DoneStepProps> = ({ onDone, lnAddressFailures = [] }) => (
  <>
    <p className="text-sm text-spark-text-secondary mb-4 text-center">
      Your funds have been moved to your new passkey.
    </p>
    {lnAddressFailures.length > 0 && (
      <div className="mb-4">
        <p className="text-xs text-spark-warning mb-2 text-center">
          {lnAddressFailures.length === 1
            ? "This Lightning address couldn't be transferred:"
            : "These Lightning addresses couldn't be transferred:"}
        </p>
        <ul className="space-y-1.5">
          {lnAddressFailures.map(({ label, address }) => (
            <li key={label} className="rounded-xl border border-spark-border bg-spark-dark px-3 py-2 text-left">
              <div className="text-sm font-medium text-spark-text-primary break-all">{address}</div>
              <div className="text-xs text-spark-text-muted">{label}</div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-spark-warning mt-2 text-center">
          {lnAddressFailures.length === 1
            ? "Payments sent to it will continue to arrive in your old wallet until the transfer is complete."
            : "Payments sent to them will continue to arrive in your old wallets until the transfers are complete."}
        </p>
      </div>
    )}
    <div className="flex flex-col gap-3">
      <PrimaryButton onClick={onDone}>Done</PrimaryButton>
    </div>
  </>
);

export default DoneStep;
