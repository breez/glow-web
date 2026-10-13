import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { RedoActions, TrackerView } from './TrackerView';

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
        { leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' },
        { leafId: 'leaf-2', valueSats: 420_000, method: 'unilateral' },
      ],
      recoverableValueSats: 600_000,
      totalFeeSats: 3_122,
      cpfpFeeSats: 2_907,
      sweepFeeSats: 0,
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

  it('shows what will arrive without a marker, even when an exit fee paid for it', () => {
    renderTracker(twoLeaves([tx({ txid: 'a' })], { quotedExitFeeSat: 3_122 }));
    expect(screen.getByText(/599 785/).closest('span')).not.toHaveTextContent('~');
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

  it.each([
    ['its rebuild needs the passkey', { needsSignIn: true }],
    ['its rebuild failed', { rebuildFailed: true }],
  ] as const)('pauses a diverged exit when %s, and says it needs the update', (_, flags) => {
    renderTracker(plan([tx({ txid: 'a' })], { phase: 'redo', ...flags }));
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByTestId('unilateral-exit-status')).toHaveTextContent('Update needed');
    expect(screen.getByText(/Part of your exit didn't confirm in time/)).toBeInTheDocument();
  });

  it('says a diverged exit Glow rebuilds by itself is updating, and asks nothing, even after a failed tap', () => {
    render(
      <TrackerView
        plan={plan([tx({ txid: 'a', status: locked(1144) })], { phase: 'redo' })}
        tipHeight={1000}
        isAdvancing={false}
        continueError="Nothing is left to rebuild. The exit updates on its next check."
      />,
    );
    expect(screen.getByText('Processing')).toBeInTheDocument();
    // Not the old set's timelock: the rebuild replaces that set.
    expect(screen.getByTestId('unilateral-exit-status')).toHaveTextContent('Updating automatically');
    expect(screen.queryByText(/Part of your exit didn't confirm in time/)).not.toBeInTheDocument();
    expect(screen.queryByText('Could not update the exit')).not.toBeInTheDocument();
  });
});

describe('TrackerView', () => {
  it('explains a diverged exit and continues it in place, without the wizard', () => {
    const onRebuild = vi.fn();
    const onContinue = vi.fn();
    render(<TrackerView plan={plan([tx({ txid: 'a' })], { phase: 'redo', needsSignIn: true })} tipHeight={1000} isAdvancing={false} onRebuild={onRebuild} />);
    expect(screen.getByText(/Part of your exit didn't confirm in time/)).toBeInTheDocument();
    render(<RedoActions onContinue={onContinue} onRebuild={onRebuild} isContinuing={false} continueError={null} />);
    expect(screen.getByTestId('unilateral-exit-rebuild')).toHaveTextContent(/^Update & Continue Exit$/);
    fireEvent.click(screen.getByTestId('unilateral-exit-rebuild'));
    expect(onContinue).toHaveBeenCalled();
    expect(onRebuild).not.toHaveBeenCalled();
    expect(screen.queryByTestId('unilateral-exit-rebuild-wizard')).not.toBeInTheDocument();
  });

  it('says Glow could not check the exit when that is why it needs the tap, while it keeps running', () => {
    render(<TrackerView plan={plan([tx({ txid: 'a' })], { needsSignIn: true, redoCause: 'unverified' })} tipHeight={1000} isAdvancing={false} />);
    expect(screen.getByText(/Glow couldn't check part of your exit on-chain/)).toBeInTheDocument();
    expect(screen.queryByText(/Spark operators moved/)).not.toBeInTheDocument();
    expect(screen.getByText('Processing')).toBeInTheDocument();
  });

  it('offers the wizard when continuing in place fails', () => {
    const onRebuild = vi.fn();
    const error = 'Insufficient CPFP funding: need at least 5000 sats';
    render(
      <TrackerView plan={plan([tx({ txid: 'a' })], { phase: 'redo', needsSignIn: true })} tipHeight={1000} isAdvancing={false} onRebuild={onRebuild} continueError={error} />,
    );
    expect(screen.getByText('Could not update the exit')).toBeInTheDocument();
    expect(screen.queryByText(/Part of your exit didn't confirm in time/)).not.toBeInTheDocument();
    expect(screen.getByText('Please try again or choose a different fee.')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('unilateral-exit-continue-error')).getByText('Details'));
    expect(screen.getByTestId('unilateral-exit-continue-error')).toHaveTextContent('need at least 5000 sats');
    render(<RedoActions onContinue={vi.fn()} onRebuild={onRebuild} isContinuing={false} continueError={error} />);
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

  it('drops the fee bump once every transaction is confirmed, leaving nothing at the old rate', () => {
    renderTracker(plan([tx({ txid: 'r', kind: 'refund', status: confirmed(9) }), tx({ txid: 's', kind: 'sweep', status: confirmed(9) })]));
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.queryByTestId('unilateral-exit-bump-fee')).not.toBeInTheDocument();
  });

  it('keeps an off-device copy reachable, since only this device holds what an exit needs', () => {
    renderTracker(plan([tx({ txid: 'a' })]));
    expect(screen.queryByTestId('unilateral-exit-backup-save')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByText('Save exit data')).toBeInTheDocument();
    expect(screen.getByTestId('unilateral-exit-backup-save')).toBeInTheDocument();
  });

  it('offers only the fee bump for a co-signed recovery, which exit data cannot restore', () => {
    renderTracker(plan([tx({ txid: 'c1', kind: 'cooperative' }), tx({ txid: 'c2', kind: 'cooperative' })]));
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByTestId('unilateral-exit-bump-fee')).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-backup-save')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-backup-restore')).not.toBeInTheDocument();
  });

  it('leaves out Advanced for a co-signed recovery it only follows, which has nothing to put there', () => {
    render(
      <TrackerView
        plan={plan([tx({ txid: 'c1', kind: 'cooperative' })], { mode: 'recover' })}
        tipHeight={1000}
        isAdvancing={false}
        noun="recovery"
      />,
    );
    expect(screen.queryByText('Advanced')).not.toBeInTheDocument();
    expect(screen.getByTestId('unilateral-exit-stages')).toBeInTheDocument();
  });

  it('keeps the exit data under Advanced for an exit it only follows', () => {
    render(<TrackerView plan={plan([tx({ txid: 'a' })])} tipHeight={1000} isAdvancing={false} />);
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByText('Save exit data')).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-bump-fee')).not.toBeInTheDocument();
  });
});

describe('the note once an exit starts', () => {
  const running = twoLeaves([tx({ txid: 'r', kind: 'refund' })]);

  it('says the sheet can close when the exit just started here, and not when the user came back to it', () => {
    const { rerender } = render(
      <TrackerView plan={running} tipHeight={1000} isAdvancing={false} onRebuild={vi.fn()} justStarted />,
    );
    expect(screen.getByText(/You can close this/)).toBeInTheDocument();
    rerender(<TrackerView plan={running} tipHeight={1000} isAdvancing={false} onRebuild={vi.fn()} />);
    expect(screen.queryByText(/You can close this/)).not.toBeInTheDocument();
  });

  it('leaves a paused exit to its own card', () => {
    render(
      <TrackerView plan={{ ...running, phase: 'redo', needsSignIn: true }} tipHeight={1000} isAdvancing={false} onRebuild={vi.fn()} justStarted />,
    );
    expect(screen.queryByText(/You can close this/)).not.toBeInTheDocument();
  });
});
