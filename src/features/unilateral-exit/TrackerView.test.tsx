import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { TrackerView } from './TrackerView';

// The backup card reads the connected wallet; the tracker itself works off the
// plan it is handed.
vi.mock('@/contexts/WalletContext', () => ({
  useWallet: () => ({ exportUnilateralExitState: async () => ({ exitState: '{}' }) }),
}));
import type { UnilateralExitPlan } from './driver';
import { blocked, confirmed, locked, plan, tx } from './testFixtures';

// one input, one 596 524 sat output
const twoLeaves = (transactions: Parameters<typeof plan>[0], over: Parameters<typeof plan>[1] = {}) =>
  plan(transactions, {
    quotedSweepFeeSat: 215,
    ...over,
    exit: {
      leaves: [
        { leafId: 'leaf-1', value: 180_000 },
        { leafId: 'leaf-2', value: 420_000 },
      ],
      recoverableValueSat: 600_000,
      totalFeeSat: 3_122,
      cpfpFeeSat: 2_907,
      sweepFeeSat: 0,
      ...over.exit,
    },
  });

const renderTracker = (p: UnilateralExitPlan, tipHeight: number | null = 1000, onRebuild = vi.fn()) =>
  render(<TrackerView plan={p} tipHeight={tipHeight} isAdvancing={false} onRebuild={onRebuild} />);

describe('the status line while a check runs', () => {
  const advancing = () =>
    render(
      <TrackerView plan={twoLeaves([tx({ txid: 'r', kind: 'refund' })])} tipHeight={1000} isAdvancing onRebuild={vi.fn()} />,
    );

  it('says nothing about checking while the pass is quick', () => {
    vi.useFakeTimers();
    try {
      advancing();
      // A pass that returns this fast used to flip the line and flip it back.
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.getByTestId('unilateral-exit-status')).not.toHaveTextContent('Checking');
    } finally {
      vi.useRealTimers();
    }
  });

  it('explains itself once a pass is slow enough to notice', () => {
    vi.useFakeTimers();
    try {
      advancing();
      act(() => { vi.advanceTimersByTime(1_000); });
      expect(screen.getByTestId('unilateral-exit-status')).toHaveTextContent('Checking');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('what the exit is worth right now', () => {
  it('counts only the sats that reached the destination, against the whole balance', () => {
    renderTracker(
      twoLeaves([
        tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1', status: confirmed(900) }),
        tx({ txid: 'r2', kind: 'refund', nodeId: 'leaf-2', status: blocked }),
      ]),
    );
    const stages = screen.getByTestId('unilateral-exit-stages');
    expect(stages).toHaveTextContent('Processed sats');
    // Nothing is spendable until the sweep lands, so the numerator is still 0.
    expect(stages).toHaveTextContent('0/600 000');
  });

  it('leads with what will arrive: the balance less the sweep fee', () => {
    renderTracker(twoLeaves([tx({ txid: 'a' })]));
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.getByText(/599 785/)).toBeInTheDocument();
  });

  it('counts the transactions done against the total', () => {
    renderTracker(
      plan([tx({ txid: 'a', status: confirmed(900) }), tx({ txid: 'r', kind: 'refund', status: locked(3000) })]),
    );
    const stages = screen.getByTestId('unilateral-exit-stages');
    expect(stages).toHaveTextContent('Processed transactions');
    expect(stages).toHaveTextContent('1/2');
  });

  it('names what the exit is waiting on', () => {
    renderTracker(
      plan([
        tx({ txid: 'r1', kind: 'refund', status: locked(1144) }),
        tx({ txid: 'r2', kind: 'refund', status: locked(1144) }),
        tx({ txid: 's', kind: 'sweep', status: locked(9000) }),
      ]),
    );
    expect(screen.getByTestId('unilateral-exit-status')).toHaveTextContent('Waiting for timelock');
  });

  it('estimates the whole wait, not just the next step, and marks it approximate', () => {
    renderTracker(
      plan([
        tx({ txid: 'a', status: confirmed(1000) }),
        tx({ txid: 'r', kind: 'refund', dependsOn: ['a'], csvTimelockBlocks: 2000, status: locked(3000) }),
      ]),
    );
    expect(screen.getByTestId('unilateral-exit-eta')).toHaveTextContent('~14');
  });

  it('says it is rebuilding rather than moving when the chain diverged', () => {
    renderTracker(plan([tx({ txid: 'a' })], { phase: 'redo' }));
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });
});

describe('TrackerView', () => {
  it('continues a diverged exit in place, without the wizard', () => {
    const onRebuild = vi.fn();
    const onContinue = vi.fn();
    render(
      <TrackerView plan={plan([tx({ txid: 'a' })], { phase: 'redo' })} tipHeight={1000} isAdvancing={false} onRebuild={onRebuild} onContinue={onContinue} />,
    );
    expect(screen.getByText('Your exit needs an update')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('unilateral-exit-rebuild'));
    expect(onContinue).toHaveBeenCalled();
    expect(onRebuild).not.toHaveBeenCalled();
    expect(screen.queryByTestId('unilateral-exit-rebuild-wizard')).not.toBeInTheDocument();
  });

  it('offers the wizard when continuing in place fails', () => {
    const onRebuild = vi.fn();
    render(
      <TrackerView
        plan={plan([tx({ txid: 'a' })], { phase: 'redo' })}
        tipHeight={1000}
        isAdvancing={false}
        onRebuild={onRebuild}
        onContinue={vi.fn()}
        continueError="Insufficient CPFP funding: need at least 5000 sats"
      />,
    );
    expect(screen.getByText('Glow could not continue the exit.')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('unilateral-exit-continue-error')).getByText('Details'));
    expect(screen.getByTestId('unilateral-exit-continue-error')).toHaveTextContent('need at least 5000 sats');
    fireEvent.click(screen.getByTestId('unilateral-exit-rebuild-wizard'));
    expect(onRebuild).toHaveBeenCalled();
  });

  it('offers a fee bump while the exit is still running', () => {
    const onRebuild = vi.fn();
    renderTracker(plan([tx({ txid: 'a' })]), 1000, onRebuild);
    // Kept out of the way under Advanced: an exit that is simply slow is not a
    // reason to put a rebuild in front of everyone.
    fireEvent.click(screen.getByText('Advanced'));
    screen.getByTestId('unilateral-exit-bump-fee').click();
    expect(onRebuild).toHaveBeenCalled();
  });

  it('drops the fee bump once the chain has diverged, since a rebuild is already offered', () => {
    renderTracker(plan([tx({ txid: 'a' })], { phase: 'redo' }));
    expect(screen.queryByTestId('unilateral-exit-bump-fee')).not.toBeInTheDocument();
  });

  it('keeps an off-device copy reachable, since only this device holds what an exit needs', () => {
    renderTracker(plan([tx({ txid: 'a' })]));
    expect(screen.queryByTestId('unilateral-exit-backup-save')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByText('Save exit data')).toBeInTheDocument();
    expect(screen.getByTestId('unilateral-exit-backup-save')).toBeInTheDocument();
  });
});
