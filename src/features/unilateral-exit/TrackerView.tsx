import React, { useEffect, useMemo, useState } from 'react';
import { BackupActions, ExitActionRow } from './BackupCard';
import { AlertCard } from '@/components/AlertCard';
import { SatAmount } from '@/components/SatAmount';
import { CollapsibleCodeField, CollapsibleSection, PrimaryButton, SecondaryButton } from '@/components/ui';
import { RefreshIcon } from '@/components/Icons';
import { blocksToFinish, exitStages, nextAction, planProgress } from './driver';
import type { NextAction, PlanProgress, UnilateralExitPlan } from './driver';
import { formatDaysLeft } from '@/utils/blockTime';
import { formatWithSpaces } from '@/utils/formatNumber';

/** The node's or the SDK's own words, folded away: support needs them, the user rarely does. */
const ErrorDetails: React.FC<{ text: string; testId: string }> = ({ text, testId }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2" data-testid={testId}>
      <CollapsibleCodeField label="Details" value={text} isVisible={open} onToggle={() => setOpen(v => !v)} />
    </div>
  );
};

/** One labelled figure. No icon and no marker: the label is the whole story. */
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-spark-text-secondary text-sm shrink-0">{label}</span>
    <span className="text-sm text-spark-text-primary text-right">{children}</span>
  </div>
);

/** `x/y`, tight: a spaced slash reads as two separate figures. */
const Ratio: React.FC<{ done: React.ReactNode; total: React.ReactNode }> = ({ done, total }) => (
  <span className="font-mono [word-spacing:-0.4em]">
    {done}
    <span className="text-spark-text-muted">/</span>
    <span className="text-spark-text-secondary">{total}</span>
  </span>
);

/**
 * True once `active` has held for `delayMs`. A chain check that returns almost
 * at once never trips it, so the status line does not flicker on every poll.
 */
const useHeldFor = (active: boolean, delayMs: number): boolean => {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setHeld(true), delayMs);
    // Reset on the way out rather than in the body, which would set state
    // synchronously during the effect and cascade a render.
    return () => {
      clearTimeout(timer);
      setHeld(false);
    };
  }, [active, delayMs]);
  return held;
};

/** Long enough that a fast pass stays invisible, short enough to explain a slow one. */
const CHECKING_VISIBLE_AFTER_MS = 600;

const ExitSummary: React.FC<{
  plan: UnilateralExitPlan;
  blocksLeft: number | null;
  progress: PlanProgress;
  next: NextAction | null;
  isAdvancing: boolean;
}> = ({ plan, blocksLeft, next, isAdvancing, progress }) => {
  const stages = exitStages(plan);
  const total = stages.inSpark + stages.onChain + stages.delivered;

  const isChecking = useHeldFor(isAdvancing, CHECKING_VISIBLE_AFTER_MS);
  const status = isChecking
    ? 'Checking the blockchain...'
    : next === null
      ? 'Waiting for confirmations'
      : next.blocks > 0
        ? 'Waiting for timelock'
        : `Sending ${next.transactions === 1 ? 'a transaction' : `${next.transactions} transactions`}`;

  return (
    <div className="space-y-6">
      <div className="text-center py-4">
        <p className="text-spark-text-muted text-sm mb-2">
          {plan.phase === 'redo' ? 'Paused' : 'Processing'}
        </p>
        <SatAmount
          sats={stages.willReceive}
          approximate
          className="text-4xl font-bold text-spark-text-primary"
        />
      </div>

      <div
        className="bg-spark-dark border border-spark-border rounded-2xl p-4 space-y-3"
        data-testid="unilateral-exit-stages"
      >
        <Row label="Days left">
          <span data-testid="unilateral-exit-eta">
            {blocksLeft === null ? 'almost there' : formatDaysLeft(blocksLeft)}
          </span>
        </Row>
        <div className="border-t border-spark-border/50" />
        <Row label="Processed transactions">
          <Ratio done={progress.confirmed} total={progress.total} />
        </Row>
        <div className="border-t border-spark-border/50" />
        <Row label="Processed sats">
          {/* Only what reached the destination: anything mid-flight is not the
              user's to spend yet. */}
          <Ratio
            done={formatWithSpaces(stages.delivered)}
            total={formatWithSpaces(total)}
          />
        </Row>
        <div className="border-t border-spark-border/50" />
        <Row label="Current status">
          <span data-testid="unilateral-exit-status">{status}</span>
        </Row>
      </div>
    </div>
  );
};

export const TrackerView: React.FC<{
  plan: UnilateralExitPlan;
  tipHeight: number | null;
  isAdvancing: boolean;
  /** Opens the wizard, for a new fee rate. */
  onRebuild: () => void;
  /** Rebuilds a diverged exit in place, at its own fee rate. */
  onContinue?: () => void;
  isContinuing?: boolean;
  continueError?: string | null;
}> = ({ plan, tipHeight, isAdvancing, onRebuild, onContinue, isContinuing = false, continueError = null }) => {
  const { transactions } = plan.exit;
  const [advanced, setAdvanced] = useState(false);
  const progress = useMemo(() => planProgress(plan), [plan]);
  const next = useMemo(
    () => (tipHeight === null ? null : nextAction(transactions, tipHeight)),
    [transactions, tipHeight],
  );
  const blocksLeft = useMemo(
    () => (tipHeight === null ? null : blocksToFinish(transactions, tipHeight)),
    [transactions, tipHeight],
  );

  return (
    <div className="space-y-4" data-testid="unilateral-exit-tracker">
      <ExitSummary
        plan={plan}
        blocksLeft={blocksLeft}
        next={next}
        progress={progress}
        isAdvancing={isAdvancing}
      />

      {plan.phase === 'redo' && (
        <AlertCard variant="warning" title="Your exit needs an update">
          <p className="text-sm">
            Part of your exit already went through, so the remaining transactions need an update.
            Your money is safe.
          </p>
          {continueError && (
            <>
              <p className="text-sm mt-2">Glow could not continue the exit.</p>
              <ErrorDetails text={continueError} testId="unilateral-exit-continue-error" />
            </>
          )}
          <div className="mt-3 space-y-2">
            <PrimaryButton
              onClick={onContinue ?? onRebuild}
              disabled={isContinuing}
              className="w-full"
              data-testid="unilateral-exit-rebuild"
            >
              {isContinuing ? 'Rebuilding...' : 'Continue Exit'}
            </PrimaryButton>
            {/* When the exit's own fee rate no longer works, the wizard can pick another. */}
            {continueError && (
              <SecondaryButton onClick={onRebuild} className="w-full" data-testid="unilateral-exit-rebuild-wizard">
                Choose a Different Fee
              </SecondaryButton>
            )}
          </div>
        </AlertCard>
      )}

      <CollapsibleSection
        label="Advanced"
        isVisible={advanced}
        onToggle={() => setAdvanced(v => !v)}
        bare
      >
        <BackupActions frozen={plan.exitStateSnapshot}>
          {plan.phase === 'active' && (
            <ExitActionRow
              label="Rebuild at a higher fee"
              icon={<RefreshIcon size="md" />}
              onClick={onRebuild}
              testId="unilateral-exit-bump-fee"
            />
          )}
        </BackupActions>
      </CollapsibleSection>
    </div>
  );
};
