import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackupActions, ExitActionRow } from './BackupCard';
import { AlertCard, SimpleAlert } from '@/components/AlertCard';
import { SatAmount } from '@/components/SatAmount';
import { CollapsibleCodeField, CollapsibleSection, PrimaryButton, SecondaryButton } from '@/components/ui';
import { RefreshIcon } from '@/components/Icons';
import { awaitsUpdate, blocksToFinish, exitStages, isLanded, leftoverIdsOf, nextAction, planProgress } from './driver';
import type { NextAction, PlanProgress, UnilateralExitPlan } from './driver';
import { isCooperative } from './quote';
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
  // A diverged exit sends nothing until its rebuild replaces the set, so the
  // set's next step is not what it is doing. Nor is it once the set has
  // landed and only leaves it left out remain, which Glow tries again by
  // itself for up to a week.
  const paused = plan.phase === 'redo' && awaitsUpdate(plan);
  const retrying = plan.phase === 'active' && isLanded(plan.exit) && leftoverIdsOf(plan).length > 0;
  const status = isChecking
    ? 'Checking the blockchain...'
    : plan.phase === 'redo' || retrying
      ? paused
        ? 'Update needed'
        : 'Updating automatically'
      : next === null
        ? 'Waiting for confirmations'
        : next.blocks > 0
          ? 'Waiting for timelock'
          : `Sending ${next.transactions === 1 ? 'a transaction' : `${next.transactions} transactions`}`;

  return (
    <div className="space-y-6">
      <div className="text-center py-4">
        <p className="text-spark-text-muted text-sm mb-2">
          {paused ? 'Paused' : 'Processing'}
        </p>
        <SatAmount
          sats={stages.willReceive}
          className="text-4xl font-bold text-spark-text-primary"
        />
      </div>

      <div
        className="bg-spark-dark border border-spark-border rounded-2xl p-4 space-y-3"
        data-testid="unilateral-exit-stages"
      >
        {/* Nothing in flight to count down, and no telling when a leftover lands. */}
        {!retrying && (
          <>
            <Row label="Days left">
              <span data-testid="unilateral-exit-eta">
                {blocksLeft === null ? 'almost there' : formatDaysLeft(blocksLeft)}
              </span>
            </Row>
            <div className="border-t border-spark-border/50" />
          </>
        )}
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

/** Scrolled into view as it appears: the tap that failed sits in the action bar, below the fold. */
const UpdateError: React.FC<{ noun: string; error: string }> = ({ noun, error }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.scrollIntoView?.({ block: 'nearest' }), [error]);
  return (
    <div ref={ref}>
      <AlertCard variant="error" title={`Could not update the ${noun}`}>
        <p className="text-sm">Please try again or choose a different fee.</p>
        <ErrorDetails text={error} testId="unilateral-exit-continue-error" />
      </AlertCard>
    </div>
  );
};

/**
 * The update buttons, for the sheet's action bar: inside the scroller they
 * fell below the fold at the sheet's resting height.
 */
export const RedoActions: React.FC<{
  /** Rebuilds the exit in place, at its own fee rate. */
  onContinue: () => void;
  /** Opens the wizard, for a new fee rate. */
  onRebuild?: () => void;
  isContinuing: boolean;
  continueError: string | null;
  noun?: string;
}> = ({ onContinue, onRebuild, isContinuing, continueError, noun = 'exit' }) => (
  <div className="space-y-3">
    <PrimaryButton onClick={onContinue} disabled={isContinuing} className="w-full" data-testid="unilateral-exit-rebuild">
      {isContinuing ? 'Updating...' : `Update & Continue ${noun.charAt(0).toUpperCase()}${noun.slice(1)}`}
    </PrimaryButton>
    {/* When the exit's own fee rate no longer works, the wizard can pick another. */}
    {continueError && onRebuild && (
      <SecondaryButton onClick={onRebuild} className="w-full" data-testid="unilateral-exit-rebuild-wizard">
        Choose a Different Fee
      </SecondaryButton>
    )}
  </div>
);

export const TrackerView: React.FC<{
  plan: UnilateralExitPlan;
  tipHeight: number | null;
  isAdvancing: boolean;
  /** Opens the wizard, for a new fee rate. Without it the tracker only follows. */
  onRebuild?: () => void;
  continueError?: string | null;
  /** The exit started while this sheet was open, so nothing has said yet that it can close. */
  justStarted?: boolean;
  /** What the closing line calls this, such as "recovery". */
  noun?: string;
}> = ({ plan, tipHeight, isAdvancing, onRebuild, continueError = null, justStarted = false, noun = 'exit' }) => {
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
  // A co-signed recovery is Glow's own record, which the exit-data export does
  // not hold, so saving or restoring exit data would not bring it back.
  const isCosignedRecovery = transactions.length > 0 && transactions.every(isCooperative);
  // With everything confirmed, nothing is left at the old rate to pay more for.
  const rebuildRow = plan.phase === 'active' && !isLanded(plan.exit) && onRebuild && (
    <ExitActionRow
      label="Rebuild at a higher fee"
      icon={<RefreshIcon size="md" />}
      onClick={onRebuild}
      testId="unilateral-exit-bump-fee"
    />
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

      {/* The engine only runs while the app is open, so leaving the sheet is
          fine but leaving Glow for good is not. */}
      {justStarted && plan.phase === 'active' && !awaitsUpdate(plan) && (
        <p className="text-spark-text-muted text-xs text-center text-balance">
          You can close this. Open Glow regularly until the {noun} finishes.
        </p>
      )}

      {/* A co-signed recovery has nothing here but the fee bump. */}
      {(!isCosignedRecovery || rebuildRow) && (
        <CollapsibleSection
          label="Advanced"
          isVisible={advanced}
          onToggle={() => setAdvanced(v => !v)}
          bare
        >
          {isCosignedRecovery ? (
            rebuildRow
          ) : (
            <BackupActions frozen={plan.exitStateSnapshot}>{rebuildRow}</BackupActions>
          )}
        </CollapsibleSection>
      )}

      {/* One box at a time: a failed update replaces the explanation the user read before tapping.
          A little room below, or the scroller's edge clips the box's border. */}
      {awaitsUpdate(plan) && (
        <div className="pb-1">
          {continueError ? (
            <UpdateError noun={noun} error={continueError} />
          ) : (
            <SimpleAlert variant="warning" hideIcon>
              {plan.redoCause === 'unverified' ? (
                <p>
                  Glow couldn&apos;t check part of your {noun} on-chain. Please update your{' '}
                  {noun === 'exit' ? 'unilateral exit' : noun} to continue.
                </p>
              ) : (
                <p>
                  Part of your {noun} didn&apos;t confirm in time, so the Spark operators moved some of your funds
                  on-chain to keep them safe. Please update your {noun === 'exit' ? 'unilateral exit' : noun} to
                  recover all your funds.
                </p>
              )}
            </SimpleAlert>
          )}
        </div>
      )}
    </div>
  );
};
