import React from 'react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { DialogContainer, DialogCard } from '@/components/ui';
import { PasskeyIcon } from '@/components/Icons';
import { useMigrationFlow } from './hooks/useMigrationFlow';
import ExplainStep from './steps/ExplainStep';
import ConfirmLabelsStep from './steps/ConfirmLabelsStep';
import BlockedDepositsStep from './steps/BlockedDepositsStep';
import MigrationProgressStep from './steps/MigrationProgressStep';
import DoneStep from './steps/DoneStep';
import ErrorStep from './steps/ErrorStep';
import type { MigrationEntry, MigrationOutcome } from './types';

export type { MigrationEntry, MigrationOutcome } from './types';

export interface PasskeyMigrationModalProps {
  isOpen: boolean;
  entry: MigrationEntry;
  /** Active legacy SDK, required when `entry === 'banner'` (auto-reconnect already connected it). */
  activeLegacySdk?: BreezSdk | null;
  onClose: (outcome: MigrationOutcome) => void;
  /**
   * Invoked when the migration completes. The caller adopts the provided
   * (already connected + synced) new SDK as the active wallet. Ownership is
   * transferred: the modal will NOT disconnect it afterwards.
   */
  onSwitchToNewWallet: (newSdk: BreezSdk, label: string) => Promise<void>;
}

/**
 * Thin container for the passkey-RP migration. Owns no business logic: it wires
 * `useMigrationFlow` (phase state machine + orchestration) to the per-phase step
 * components inside a shared dialog shell.
 */
const PasskeyMigrationModal: React.FC<PasskeyMigrationModalProps> = (props) => {
  const { isOpen, entry } = props;
  const flow = useMigrationFlow(props);

  if (!isOpen) return null;

  return (
    <DialogContainer>
      <DialogCard maxWidth="sm">
        <div className="text-center mb-4">
          <div className="flex justify-center mb-3">
            <div className="w-14 h-14 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
              <PasskeyIcon size="xl" className="text-spark-primary" />
            </div>
          </div>
          <h2 className="font-display text-lg font-bold text-spark-text-primary">
            {flow.phase === 'done'
              ? 'Upgrade complete'
              : entry === 'login' ? 'Check passkey' : 'Upgrade passkey'}
          </h2>
        </div>

        {flow.isInFlight && <MigrationProgressStep text={flow.spinnerText} />}

        {flow.phase === 'explain' && (
          <ExplainStep
            entry={entry}
            onContinue={entry === 'banner' ? flow.startFromBanner : flow.checkForOldPasskey}
            onSecondary={entry === 'banner' ? flow.cancel : flow.skipNoOldPasskey}
          />
        )}

        {flow.phase === 'confirm-labels' && (
          <ConfirmLabelsStep
            labels={flow.confirmedLabels}
            primaryLabel={flow.primaryLabel}
            onContinue={flow.confirmLabels}
            onCancel={flow.cancel}
          />
        )}

        {flow.phase === 'blocked-deposits' && (
          <BlockedDepositsStep count={flow.unclaimedCount} onOpenDeposits={flow.openUnclaimedDeposits} />
        )}

        {flow.phase === 'done' && (
          <DoneStep onDone={flow.done} lnAddressFailedLabels={flow.lnAddressFailedLabels} />
        )}

        {flow.phase === 'error' && (
          <ErrorStep
            error={flow.error}
            onRetry={flow.retry}
            onCancel={flow.cancel}
            onStartOver={flow.canStartOver ? flow.startOver : undefined}
          />
        )}
      </DialogCard>
    </DialogContainer>
  );
};

export default PasskeyMigrationModal;
