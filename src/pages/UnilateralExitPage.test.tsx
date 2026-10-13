import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import type { FeeRates } from '@/services/chain';
import type { UnilateralExitFlow } from '@/features/unilateral-exit/hooks/useUnilateralExitFlow';
import { quoteFigures } from '@/features/unilateral-exit/quote';
import type { ArchivedExit } from '@/features/unilateral-exit/archive';
import type { UnilateralExitPlan } from '@/features/unilateral-exit/driver';
import { confirmed, funding, pendingExit, plan, prepared, tx } from '@/features/unilateral-exit/testFixtures';

// The page is the switch under test; the flow behind it is stubbed per step.
const flow = vi.hoisted(() => ({ current: null as unknown as UnilateralExitFlow }));
vi.mock('@/features/unilateral-exit/hooks/useUnilateralExitFlow', async () => ({
  ...(await vi.importActual('@/features/unilateral-exit/hooks/useUnilateralExitFlow')),
  useUnilateralExitFlow: () => flow.current,
}));

// The scanner pulls in a wasm barcode reader the test env cannot resolve.
vi.mock('@/components/QrScannerDialog', () => ({ default: () => null }));

vi.mock('@/features/unilateral-exit/engine', async () => ({
  ...(await vi.importActual('@/features/unilateral-exit/engine')),
  cancelPendingExit: vi.fn(),
}));

// The backup rows under Advanced read the connected wallet.
vi.mock('@/contexts/WalletContext', async () => ({
  ...(await vi.importActual('@/contexts/WalletContext')),
  useWallet: () => ({ exportUnilateralExitState: async () => ({ exitState: '{}' }) }),
}));

import UnilateralExitPage from './UnilateralExitPage';
import { cancelPendingExit } from '@/features/unilateral-exit/engine';

const feeFlow = (feeRates: FeeRates | null) =>
  ({
    phase: 'fee',
    engine: { plan: null, pending: null, archive: [] },
    canGoBack: true,
    back: vi.fn(),
    fee: { feeRates, feeChoice: 'medium', effectiveFeeRate: feeRates?.medium ?? 0, onSelect: vi.fn() },
    submitFee: vi.fn(),
    goTo: vi.fn(),
  }) as unknown as UnilateralExitFlow;

async function renderAt(fee: FeeRates | null) {
  flow.current = feeFlow(fee);
  render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={vi.fn()} />);
  await waitForSheetOpen();
}

describe('the fee step while its rates load', () => {
  it('leaves the action bar empty rather than holding a dead button', async () => {
    await renderAt(null);
    expect(screen.getByText('Reading current fee rates...')).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-get-quote')).not.toBeInTheDocument();
  });

  it('offers the quote once there is a rate to quote at', async () => {
    await renderAt({ slow: 2, medium: 5, fast: 10 });
    expect(screen.getByTestId('unilateral-exit-get-quote')).toBeEnabled();
  });
});

const quoteFlow = (
  exitFeeSat: number,
  {
    underWay = false,
    startError = null,
    mode,
    cosignedSat = 0,
  }: { underWay?: boolean; startError?: string | null; mode?: 'recover'; cosignedSat?: number } = {},
) => {
  const quote = prepared({
    funding: exitFeeSat > 0 ? funding(exitFeeSat) : undefined,
    leaves: [
      { leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' },
      ...(cosignedSat > 0 ? [{ leafId: 'c-1', valueSats: cosignedSat, method: 'cooperative' as const }] : []),
    ],
    recoverableValueSats: 100_000 + cosignedSat,
  });
  return {
    phase: 'quote',
    mode,
    engine: { plan: underWay ? plan([]) : null, pending: null, archive: [] },
    canGoBack: true,
    back: vi.fn(),
    quote: { quote, figures: quoteFigures(quote), isQuoting: false, error: null },
    startError,
    continueFromQuote: vi.fn(),
    goTo: vi.fn(),
  } as unknown as UnilateralExitFlow;
};

async function renderQuote(...args: Parameters<typeof quoteFlow>) {
  flow.current = quoteFlow(...args);
  render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={vi.fn()} />);
  await waitForSheetOpen();
  return screen.getByTestId('unilateral-exit-quote-continue');
}

describe('the quote step of a recovery', () => {
  it('is titled and reviewed as a recovery', async () => {
    await renderQuote(0, { mode: 'recover' });
    expect(screen.getByRole('heading', { name: 'Recover Funds' })).toBeInTheDocument();
    expect(screen.getByText('Funds')).toBeInTheDocument();
    expect(screen.queryByText('Balance')).not.toBeInTheDocument();
  });

  it('names the tap that sends funds that need no exit fee', async () => {
    expect(await renderQuote(0, { mode: 'recover' })).toHaveTextContent(/^Recover Funds$/);
  });

  it('names the tap that sends the co-signed part of a quote that needs the exit fee for the rest', async () => {
    expect(await renderQuote(3_000, { mode: 'recover', cosignedSat: 48_200 })).toHaveTextContent(/^Recover Funds$/);
  });

  it('only continues, to the phrase and the fee, when nothing goes out on the tap', async () => {
    expect(await renderQuote(3_000, { mode: 'recover' })).toHaveTextContent(/^Continue$/);
  });

  it('continues a recovery under way', async () => {
    expect(await renderQuote(0, { mode: 'recover', underWay: true })).toHaveTextContent(/^Continue Recovery$/);
  });

  it('shows why it could not start under the review', async () => {
    await renderQuote(0, { mode: 'recover', startError: 'Please try again.' });
    expect(screen.getByText('Could not recover the funds')).toBeInTheDocument();
    expect(screen.queryByText('Could not start the exit')).not.toBeInTheDocument();
  });
});

describe('a co-signed recovery on its way', () => {
  it('says what was sent, and closes on Done', async () => {
    const onFinished = vi.fn();
    flow.current = {
      phase: 'sent',
      mode: 'recover',
      sentSat: 45_300,
      engine: { plan: null, pending: null, archive: [] },
      canGoBack: false,
      back: vi.fn(),
    } as unknown as UnilateralExitFlow;
    render(<UnilateralExitPage network="regtest" mode="recover" onBack={vi.fn()} onFinished={onFinished} />);
    await waitForSheetOpen();
    expect(screen.getByText('Funds sent')).toBeInTheDocument();
    expect(screen.getByText(/on its way/)).toHaveTextContent('45 300');
    fireEvent.click(screen.getByTestId('unilateral-exit-sent-done'));
    expect(onFinished).toHaveBeenCalled();
  });
});

describe('the sheet once a recovery lands', () => {
  it('closes when a co-signed recovery, which has no sweep, reaches the archive', async () => {
    const onFinished = vi.fn();
    const cosigned = plan([tx({ txid: 'coop-1', kind: 'cooperative', status: confirmed(9) })], { mode: 'recover' });
    const tracking = (archive: ArchivedExit[], current: UnilateralExitPlan | null = cosigned) =>
      ({
        phase: 'tracker',
        mode: 'recover',
        engine: { plan: current, pending: null, archive, tipHeight: 10, isAdvancing: false },
        canGoBack: false,
        back: vi.fn(),
        rebuild: vi.fn(),
        continueExit: vi.fn(),
        isContinuing: false,
        continueError: null,
      }) as unknown as UnilateralExitFlow;
    flow.current = tracking([]);
    const { rerender } = render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={onFinished} />);
    await waitForSheetOpen();
    expect(onFinished).not.toHaveBeenCalled();

    flow.current = tracking([{ id: 'coop-1', destination: 'bc1qdest', deliveredSat: 1, completedAt: 0 }], null);
    rerender(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={onFinished} />);
    expect(onFinished).toHaveBeenCalled();
  });
});

describe('raising the fee of a kept co-signed recovery', () => {
  const record = (id: string): ArchivedExit => ({ id, destination: 'bcrt1qmine', deliveredSat: 1, completedAt: 0 });
  const bumpFlow = ({
    phase = 'fee',
    bumpedTxid = 'c1',
    archive = [],
    plan: current = null,
  }: { phase?: string; bumpedTxid?: string | null; archive?: ArchivedExit[]; plan?: UnilateralExitPlan | null } = {}) =>
    ({
      phase,
      mode: 'recover',
      bumping: true,
      bumpedTxid,
      engine: { plan: current, pending: null, archive },
      canGoBack: false,
      back: vi.fn(),
      fee: { feeRates: { slow: 2, medium: 2, fast: 3 }, feeChoice: 'medium', effectiveFeeRate: 2, onSelect: vi.fn() },
      submitFee: vi.fn(),
      sentSat: 47_200,
      goTo: vi.fn(),
    }) as unknown as UnilateralExitFlow;

  async function renderBump(first: UnilateralExitFlow) {
    const onFinished = vi.fn();
    flow.current = first;
    const view = render(<UnilateralExitPage network="regtest" bumpTxid="c1" onBack={vi.fn()} onFinished={onFinished} />);
    await waitForSheetOpen();
    const show = (next: UnilateralExitFlow) => {
      flow.current = next;
      view.rerender(<UnilateralExitPage network="regtest" bumpTxid="c1" onBack={vi.fn()} onFinished={onFinished} />);
    };
    return { onFinished, show };
  }

  it('continues the recovery from its review, though no exit is under way', async () => {
    flow.current = { ...quoteFlow(0, { mode: 'recover', cosignedSat: 48_200 }), bumping: true, bumpedTxid: 'c1' } as UnilateralExitFlow;
    render(<UnilateralExitPage network="regtest" bumpTxid="c1" onBack={vi.fn()} onFinished={vi.fn()} />);
    await waitForSheetOpen();
    expect(screen.getByTestId('unilateral-exit-quote-continue')).toHaveTextContent(/^Continue Recovery$/);
  });

  it('closes once the recovery holding its leaves lands, under a transaction a retry swapped in', async () => {
    const { onFinished, show } = await renderBump(bumpFlow());
    show(bumpFlow({ bumpedTxid: 'c1-retried' }));
    show(bumpFlow({ bumpedTxid: null }));
    expect(onFinished).not.toHaveBeenCalled();

    show(bumpFlow({ bumpedTxid: null, archive: [record('c1-retried')] }));
    expect(onFinished).toHaveBeenCalled();
  });

  it('keeps its receipt until Done, though the new recovery lands', async () => {
    const { onFinished, show } = await renderBump(bumpFlow({ phase: 'sent' }));
    show(bumpFlow({ phase: 'sent', bumpedTxid: 'c1-bumped' }));
    show(bumpFlow({ phase: 'sent', bumpedTxid: null, archive: [record('c1-bumped')] }));
    expect(onFinished).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('unilateral-exit-sent-done'));
    expect(onFinished).toHaveBeenCalled();
  });

  it('stays open when an exit under way beside it lands', async () => {
    const exit = plan([tx({ txid: 'sweep-1', kind: 'sweep' })]);
    const { onFinished, show } = await renderBump(bumpFlow({ plan: exit }));
    show(bumpFlow({ archive: [record('sweep-1')] }));
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('closes at once when no kept recovery held its leaves as it opened', async () => {
    const { onFinished } = await renderBump(bumpFlow({ bumpedTxid: null }));
    expect(onFinished).toHaveBeenCalled();
  });
});

describe('updating an exit from the tracker', () => {
  const diverged = plan([tx({ txid: 'a' })], { phase: 'redo', needsSignIn: true });
  const waitingOnTap = plan([tx({ txid: 'a', status: { type: 'unverified' } })], { needsSignIn: true, redoCause: 'unverified' });

  async function renderTracker(current: UnilateralExitPlan, continueError: string | null = null) {
    flow.current = {
      phase: 'tracker',
      engine: { plan: current, pending: null, archive: [], tipHeight: 10, isAdvancing: false },
      canGoBack: false,
      back: vi.fn(),
      rebuild: vi.fn(),
      continueExit: vi.fn(),
      isContinuing: false,
      continueError,
    } as unknown as UnilateralExitFlow;
    render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={vi.fn()} />);
    await waitForSheetOpen();
  }

  it.each([
    ['a diverged exit whose rebuild needs the passkey', diverged],
    ['a diverged exit whose rebuild failed', plan([tx({ txid: 'a' })], { phase: 'redo', rebuildFailed: true })],
    ['a running exit whose update waits on the passkey', waitingOnTap],
  ])('offers the update on %s, which continues it at its own fee', async (_, current) => {
    await renderTracker(current);
    fireEvent.click(screen.getByTestId('unilateral-exit-rebuild'));
    expect(flow.current.continueExit).toHaveBeenCalled();
    expect(screen.queryByTestId('unilateral-exit-rebuild-wizard')).not.toBeInTheDocument();
  });

  it('offers a different fee once the update failed', async () => {
    await renderTracker(diverged, 'Please try again.');
    fireEvent.click(screen.getByTestId('unilateral-exit-rebuild-wizard'));
    expect(flow.current.rebuild).toHaveBeenCalled();
  });

  it.each([
    ['a running exit', plan([tx({ txid: 'a' })])],
    ['a diverged exit Glow rebuilds by itself', plan([tx({ txid: 'a' })], { phase: 'redo' })],
    ['a converted exit waiting on sign-in over no unread step', plan([tx({ txid: 'a' })], { needsRebuild: true, needsSignIn: true })],
  ])('offers neither on %s', async (_, current) => {
    await renderTracker(current, 'Please try again.');
    expect(screen.getByTestId('unilateral-exit-tracker')).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-rebuild')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-rebuild-wizard')).not.toBeInTheDocument();
  });
});

describe('the quote step', () => {
  it('names the tap that starts the exit when the quote needs no funding', async () => {
    const cta = await renderQuote(0);
    expect(cta).toHaveTextContent(/^Exit Spark$/);
    fireEvent.click(cta);
    expect(flow.current.continueFromQuote).toHaveBeenCalled();
  });

  it('names the tap that continues an exit under way when the quote needs no funding', async () => {
    expect(await renderQuote(0, { underWay: true })).toHaveTextContent(/^Continue Exit$/);
  });

  it('only continues, to the phrase and the fee, when the quote needs funding', async () => {
    expect(await renderQuote(3_000)).toHaveTextContent(/^Continue$/);
  });

  it('says the exit could not start when building it at once failed', async () => {
    await renderQuote(0, { startError: 'operators unreachable' });
    expect(screen.getByText('Could not start the exit')).toBeInTheDocument();
  });

  it('says the exit could not continue when rebuilding one under way failed', async () => {
    await renderQuote(0, { underWay: true, startError: 'operators unreachable' });
    expect(screen.getByText('Could not continue the exit')).toBeInTheDocument();
  });

  it('says an exit under way has nothing to rebuild yet when the quote names none of its leaves', async () => {
    const empty = prepared({ leaves: [], recoverableValueSats: 0 });
    flow.current = {
      ...quoteFlow(0, { underWay: true }),
      quote: { quote: empty, figures: quoteFigures(empty), isQuoting: false, error: null },
    } as UnilateralExitFlow;
    render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={vi.fn()} />);
    await waitForSheetOpen();
    expect(screen.getByText('Nothing to rebuild right now')).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-quote-continue')).not.toBeInTheDocument();
  });
});

describe('cancelling an exit that waits on its fee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function cancel(mode?: 'recover') {
    const onBack = vi.fn();
    flow.current = {
      phase: 'pending',
      mode,
      engine: {
        plan: null,
        pending: pendingExit({ mode }),
        pendingCoins: [],
        nothingToExit: false,
        isStarting: false,
        startError: null,
        archive: [],
      },
      canGoBack: false,
      back: vi.fn(),
    } as unknown as UnilateralExitFlow;
    render(<UnilateralExitPage network="regtest" onBack={onBack} onFinished={vi.fn()} />);
    await waitForSheetOpen();
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByTestId('unilateral-exit-cancel'));
    expect(cancelPendingExit).toHaveBeenCalled();
    return onBack;
  }

  it("closes the sheet on a recovery, rather than land on the exit's intro", async () => {
    expect(await cancel('recover')).toHaveBeenCalled();
  });

  it('stays open on an exit, which starts again from its intro', async () => {
    expect(await cancel()).not.toHaveBeenCalled();
  });
});
