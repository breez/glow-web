import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import type { FeeRates } from '@/services/chain';
import type { UnilateralExitFlow } from '@/features/unilateral-exit/hooks/useUnilateralExitFlow';
import { quoteFigures } from '@/features/unilateral-exit/quote';
import type { ArchivedExit } from '@/features/unilateral-exit/storage/archive';
import type { UnilateralExitPlan } from '@/features/unilateral-exit/model/plan';
import { coin, confirmed, funding, pendingExit, plan, prepared, tx } from '@/features/unilateral-exit/testFixtures';

// The page is the switch under test; the flow behind it is stubbed per step.
const flow = vi.hoisted(() => ({ current: null as unknown as UnilateralExitFlow }));
vi.mock('@/features/unilateral-exit/hooks/useUnilateralExitFlow', async () => ({
  ...(await vi.importActual('@/features/unilateral-exit/hooks/useUnilateralExitFlow')),
  useUnilateralExitFlow: () => flow.current,
}));

// The scanner pulls in a wasm barcode reader the test env cannot resolve.
vi.mock('@/components/QrScannerDialog', () => ({ default: () => null }));

vi.mock('@/features/unilateral-exit/engine/api', async () => ({
  ...(await vi.importActual('@/features/unilateral-exit/engine/api')),
  cancelPendingExit: vi.fn(),
}));

// The PIN gate's reason is what the OS biometric prompt shows.
vi.mock('@/services/appLock', async () => ({
  ...(await vi.importActual('@/services/appLock')),
  isPinEnabled: async () => true,
}));
vi.mock('@/components/PinEntry', () => ({
  PinGate: ({ reason }: { reason: string }) => <p data-testid="pin-gate-reason">{reason}</p>,
}));

// The backup rows under Advanced read the connected wallet.
vi.mock('@/contexts/WalletContext', async () => ({
  ...(await vi.importActual('@/contexts/WalletContext')),
  useWallet: () => ({ exportUnilateralExitState: async () => ({ exitState: '{}' }) }),
}));

import UnilateralExitPage from './UnilateralExitPage';
import { cancelPendingExit } from '@/features/unilateral-exit/engine/api';

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

  it('says a recovery under way could not continue when its rebuild failed', async () => {
    await renderQuote(0, { mode: 'recover', underWay: true, startError: 'operators unreachable' });
    expect(screen.getByText('Could not continue the recovery')).toBeInTheDocument();
    expect(screen.queryByText('Could not recover the funds')).not.toBeInTheDocument();
  });

  it('asks for no start while a recovery is under way', async () => {
    await renderQuote(3_000, { mode: 'recover', underWay: true });
    expect(screen.getByText('Exit fee')).toBeInTheDocument();
    expect(screen.queryByText(/To start the recovery/)).not.toBeInTheDocument();
  });

  it('speaks of a recovery while it quotes one, and when that quote fails', async () => {
    const quoting = (fields: Partial<UnilateralExitFlow['quote']>) =>
      ({
        ...quoteFlow(0, { mode: 'recover' }),
        quote: { quote: null, figures: null, isQuoting: false, error: null, ...fields },
      }) as UnilateralExitFlow;
    flow.current = quoting({ isQuoting: true });
    const { rerender } = render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={vi.fn()} />);
    await waitForSheetOpen();
    expect(screen.getByText('Working out what can be recovered...')).toBeInTheDocument();

    flow.current = quoting({ error: 'operators unreachable' });
    rerender(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={vi.fn()} />);
    expect(screen.getByText('Could not quote the recovery')).toBeInTheDocument();
  });
});

describe('a paused exit or recovery whose quote at the new fee moves nothing', () => {
  const emptyQuote = prepared({ leaves: [], recoverableValueSats: 0, totalFeeSats: 0 });
  const quoting = (
    current: UnilateralExitPlan,
    { mode, bumping = false, quote = emptyQuote }: { mode?: 'recover'; bumping?: boolean; quote?: typeof emptyQuote } = {},
  ) =>
    ({
      phase: 'quote',
      mode,
      bumping,
      bumpedTxid: bumping ? 'c1' : null,
      engine: { plan: current, pending: null, archive: [] },
      canGoBack: true,
      back: vi.fn(),
      goTo: vi.fn(),
      quote: { quote, figures: quoteFigures(quote), isQuoting: false, error: null },
      startError: null,
      continueFromQuote: vi.fn(),
    }) as unknown as UnilateralExitFlow;

  async function show(next: UnilateralExitFlow) {
    flow.current = next;
    render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={vi.fn()} />);
    await waitForSheetOpen();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  }

  it.each([
    ['a diverged exit whose rebuild needs the passkey', plan([tx({ txid: 'a' })], { status: { type: 'needsUpdate', why: 'signIn' } })],
    ['a diverged exit whose rebuild failed', plan([tx({ txid: 'a' })], { status: { type: 'needsUpdate', why: 'rebuildFailed' } })],
    [
      'a running exit whose update waits on the passkey',
      plan([tx({ txid: 'a', status: { type: 'unverified' } })], { status: { type: 'needsUpdate', why: 'signIn', cause: 'unverified' } }),
    ],
  ])('points %s at its update, and goes back straight to the tracker that holds it', async (_, current) => {
    await show(quoting(current));
    expect(screen.getByText('Nothing to rebuild right now')).toBeInTheDocument();
    expect(screen.getByText('Please update your unilateral exit to continue.')).toBeInTheDocument();
    expect(flow.current.goTo).toHaveBeenCalledWith('tracker');
    expect(flow.current.back).not.toHaveBeenCalled();
  });

  it('points a paused recovery at its update, and goes back straight to its tracker', async () => {
    await show(quoting(plan([tx({ txid: 'a' })], { mode: 'recover', status: { type: 'needsUpdate', why: 'rebuildFailed' } }), { mode: 'recover' }));
    expect(screen.getByText('Please update your recovery to continue.')).toBeInTheDocument();
    expect(flow.current.goTo).toHaveBeenCalledWith('tracker');
    expect(flow.current.back).not.toHaveBeenCalled();
  });

  it('says a running exit carries on by itself, and goes back to the fee', async () => {
    await show(quoting(plan([tx({ txid: 'a' })])));
    expect(screen.getByText('Glow keeps your exit moving on its own.')).toBeInTheDocument();
    expect(flow.current.back).toHaveBeenCalled();
    expect(flow.current.goTo).not.toHaveBeenCalled();
  });

  it('goes back to the fee from a paused exit whose quote moves something, since another rate may suit', async () => {
    await show(quoting(plan([tx({ txid: 'a' })], { status: { type: 'needsUpdate', why: 'signIn' } }), { quote: prepared({ funding: undefined }) }));
    expect(flow.current.back).toHaveBeenCalled();
    expect(flow.current.goTo).not.toHaveBeenCalled();
  });

  it("says a fee raise beside a paused exit has nothing to rebuild, rather than pointing at the exit's update", async () => {
    const paused = plan([tx({ txid: 'a' })], { status: { type: 'needsUpdate', why: 'signIn' } });
    await show(quoting(paused, { mode: 'recover', bumping: true }));
    expect(screen.getByText('Glow keeps your recovery moving on its own.')).toBeInTheDocument();
    expect(screen.queryByText(/Please update/)).not.toBeInTheDocument();
    expect(flow.current.back).toHaveBeenCalled();
    expect(flow.current.goTo).not.toHaveBeenCalled();
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

  it('closes when a plan that finished with no transaction of its own leaves the slot, archived under another txid', async () => {
    const onFinished = vi.fn();
    const at = (current: UnilateralExitPlan | null, archive: ArchivedExit[] = []) =>
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
    flow.current = at(plan([tx({ txid: 'stuck', kind: 'cooperative', status: { type: 'unverified' } })], { mode: 'recover' }));
    const { rerender } = render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={onFinished} />);
    await waitForSheetOpen();
    const show = (next: UnilateralExitFlow) => {
      flow.current = next;
      rerender(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={onFinished} />);
    };

    // The stuck recovery was let go, and an earlier one landed.
    show(at(plan([], { mode: 'recover', status: { type: 'done' } })));
    expect(onFinished).not.toHaveBeenCalled();
    show(at(null, [{ id: 'earlier', destination: 'bc1qdest', deliveredSat: 1, completedAt: 0 }]));
    expect(onFinished).toHaveBeenCalled();
  });

  it('stays open when the plan goes missing while it still runs, as while the engine restarts', async () => {
    const onFinished = vi.fn();
    const running = plan([tx({ txid: 'sweep-1', kind: 'sweep' })]);
    const at = (current: UnilateralExitPlan | null) =>
      ({
        phase: current ? 'tracker' : 'intro',
        engine: { plan: current, pending: null, archive: [], tipHeight: 10, isAdvancing: false },
        canGoBack: false,
        back: vi.fn(),
        goTo: vi.fn(),
        rebuild: vi.fn(),
        continueExit: vi.fn(),
        isContinuing: false,
        continueError: null,
      }) as unknown as UnilateralExitFlow;
    flow.current = at(running);
    const { rerender } = render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={onFinished} />);
    await waitForSheetOpen();
    flow.current = at(null);
    rerender(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={onFinished} />);
    expect(onFinished).not.toHaveBeenCalled();
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

  it('says the recovery could not continue when its build failed, though no exit is under way', async () => {
    flow.current = {
      ...quoteFlow(0, { mode: 'recover', cosignedSat: 48_200, startError: 'Please try again or choose a different fee.' }),
      bumping: true,
      bumpedTxid: 'c1',
    } as UnilateralExitFlow;
    render(<UnilateralExitPage network="regtest" bumpTxid="c1" onBack={vi.fn()} onFinished={vi.fn()} />);
    await waitForSheetOpen();
    expect(screen.getByText('Could not continue the recovery')).toBeInTheDocument();
    expect(screen.getByText('Please try again or choose a different fee.')).toBeInTheDocument();
  });

  it('says what is being built while it builds', async () => {
    await renderBump(bumpFlow({ phase: 'building' }));
    expect(screen.getByText('Building and signing the recovery...')).toBeInTheDocument();
  });

  it('closes once the recovery holding its leaves lands, under a transaction a retry swapped in', async () => {
    const { onFinished, show } = await renderBump(bumpFlow());
    show(bumpFlow({ bumpedTxid: 'c1-retried' }));
    show(bumpFlow({ bumpedTxid: null }));
    expect(onFinished).not.toHaveBeenCalled();

    show(bumpFlow({ bumpedTxid: null, archive: [record('c1-retried')] }));
    expect(onFinished).toHaveBeenCalled();
  });

  it('says the fee was raised, and what is on its way', async () => {
    await renderBump(bumpFlow({ phase: 'sent' }));
    expect(screen.getByText('Fee raised')).toBeInTheDocument();
    expect(screen.queryByText('Funds sent')).not.toBeInTheDocument();
    expect(screen.getByText(/on its way/)).toHaveTextContent('47 200');
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

describe('the fee screen of a leaf the exit left out', () => {
  const asking = plan([tx({ txid: 's', kind: 'sweep', status: confirmed(9) })], { status: { type: 'needsExitFee', topUp: { required: { sat: 3_000, inputs: 1 } } } });

  async function renderFund(over: Partial<UnilateralExitFlow> = {}) {
    flow.current = {
      phase: 'fund',
      engine: { plan: asking, pending: null, archive: [] },
      canGoBack: false,
      back: vi.fn(),
      goTo: vi.fn(),
      build: vi.fn(),
      buildError: null,
      funding: {
        address: 'bcrt1qfee',
        isFunded: true,
        topUp: { neededSat: 3_000, sentSat: 3_000, stillToSendSat: 0 },
        waitsForConfirmation: false,
        feeRate: 4,
        currentFeeRate: 4,
        networkFloorFeeRate: null,
        quotedAt: null,
      },
      isContinuing: false,
      continueError: null,
      ...over,
    } as unknown as UnilateralExitFlow;
    render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={vi.fn()} />);
    await waitForSheetOpen();
  }

  it('continues the exit once its fee arrived', async () => {
    await renderFund();
    expect(screen.getByText('Exit fee received')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('unilateral-exit-build'));
    expect(flow.current.build).toHaveBeenCalled();
  });

  it('holds the button while the build is out, and says it is under way', async () => {
    await renderFund({ isContinuing: true });
    expect(screen.getByTestId('unilateral-exit-build')).toBeDisabled();
    expect(screen.getByTestId('unilateral-exit-build')).toHaveTextContent(/^Updating\.\.\.$/);
  });

  it('says why continuing waits while the payment has yet to confirm', async () => {
    const funding = {
      address: 'bcrt1qfee',
      isFunded: false,
      topUp: { neededSat: 3_000, sentSat: 3_000, stillToSendSat: 0 },
      waitsForConfirmation: true,
      feeRate: 4,
      currentFeeRate: 4,
      networkFloorFeeRate: null,
      quotedAt: null,
    };
    await renderFund({ funding });
    expect(screen.getByText('Waiting for a confirmation')).toBeInTheDocument();
    expect(screen.getByTestId('unilateral-exit-build')).toBeDisabled();
  });

  it('says why continuing failed, which the receipt has no room for', async () => {
    await renderFund({ continueError: 'operators unreachable' });
    expect(screen.getByText('Exit fee received')).toBeInTheDocument();
    expect(screen.getByText('Could not continue the exit')).toBeInTheDocument();
  });

  it('continues a recovery in its own words', async () => {
    await renderFund({ mode: 'recover', continueError: 'operators unreachable' });
    expect(screen.getByTestId('unilateral-exit-build')).toHaveTextContent(/^Continue Recovery$/);
    expect(screen.getByText('Could not continue the recovery')).toBeInTheDocument();
  });

  it('continues an exit in its own', async () => {
    await renderFund();
    expect(screen.getByTestId('unilateral-exit-build')).toHaveTextContent(/^Continue Exit$/);
  });

  it("keeps a failed update's error off the wizard's own fee screen", async () => {
    const exit = plan([tx({ txid: 'a' })], { status: { type: 'needsUpdate', why: 'rebuildFailed' } });
    await renderFund({ engine: { plan: exit, pending: null, archive: [] } as unknown as UnilateralExitFlow['engine'], continueError: 'passkey cancelled' });
    expect(screen.queryByText('Could not continue the exit')).not.toBeInTheDocument();
  });
});

describe('updating an exit from the tracker', () => {
  const diverged = plan([tx({ txid: 'a' })], { status: { type: 'needsUpdate', why: 'signIn' } });
  const waitingOnTap = plan([tx({ txid: 'a', status: { type: 'unverified' } })], { status: { type: 'needsUpdate', why: 'signIn', cause: 'unverified' } });

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
    ['a diverged exit whose rebuild failed', plan([tx({ txid: 'a' })], { status: { type: 'needsUpdate', why: 'rebuildFailed' } })],
    ['a running exit whose update waits on the passkey', waitingOnTap],
  ])('offers the update on %s, which continues it at its own fee', async (_, current) => {
    await renderTracker(current);
    fireEvent.click(screen.getByTestId('unilateral-exit-rebuild'));
    expect(flow.current.continueExit).toHaveBeenCalled();
    expect(screen.queryByTestId('unilateral-exit-rebuild-wizard')).not.toBeInTheDocument();
  });

  it('offers a different fee once the update failed over its fee', async () => {
    await renderTracker(diverged, 'Insufficient CPFP funding: need at least 5000 sats');
    fireEvent.click(screen.getByTestId('unilateral-exit-rebuild-wizard'));
    expect(flow.current.rebuild).toHaveBeenCalled();
  });

  it.each([
    ['a running exit', plan([tx({ txid: 'a' })])],
    ['a diverged exit Glow rebuilds by itself', plan([tx({ txid: 'a' })], { status: { type: 'rebuilding' } })],
    ['a converted exit', plan([tx({ txid: 'a' })], { status: { type: 'running', converted: true } })],
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

  it('asks for no start while an exit is under way', async () => {
    await renderQuote(3_000, { underWay: true });
    expect(screen.getByText('Exit fee')).toBeInTheDocument();
    expect(screen.queryByText(/To start the process/)).not.toBeInTheDocument();
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

describe('the phrase unlock', () => {
  it.each([
    ['Unilateral Exit', undefined, 'Unilateral exit'],
    ['Recover Funds', 'recover' as const, 'Recover funds'],
  ])('names what it authorizes in %s', async (_, mode, reason) => {
    flow.current = {
      ...quoteFlow(3_000, { mode }),
      phase: 'unlock',
      unlock: vi.fn(async () => {}),
      unlockError: null,
    } as unknown as UnilateralExitFlow;
    render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={vi.fn()} />);
    await waitForSheetOpen();
    expect(await screen.findByTestId('pin-gate-reason')).toHaveTextContent(reason);
  });

  it('says sign-in failed in the app\'s words, folds the raw text away, and tries again', async () => {
    const raw = 'The operation either timed out or was not allowed.';
    const unlock = vi.fn(async () => {});
    flow.current = { ...quoteFlow(3_000), phase: 'unlock', unlock, unlockError: raw } as unknown as UnilateralExitFlow;
    render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={vi.fn()} />);
    await waitForSheetOpen();

    expect(screen.getByText('Sign-in failed')).toBeInTheDocument();
    expect(screen.getByText('Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(raw)).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('unilateral-exit-unlock-error')).getByText('Details'));
    expect(screen.getByTestId('unilateral-exit-unlock-error')).toHaveTextContent(raw);

    fireEvent.click(screen.getByTestId('unilateral-exit-unlock-retry'));
    expect(screen.getByTestId('unilateral-exit-unlock-retry')).toHaveTextContent(/^Try Again$/);
    expect(unlock).toHaveBeenCalledTimes(1);
  });
});

describe('the build', () => {
  it.each([
    ['Unilateral Exit', undefined, 'Building and signing the exit...'],
    ['Recover Funds', 'recover' as const, 'Building and signing the recovery...'],
  ])('says what it builds in %s', async (_, mode, text) => {
    flow.current = { ...quoteFlow(0, { mode }), phase: 'building' } as unknown as UnilateralExitFlow;
    render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={vi.fn()} />);
    await waitForSheetOpen();
    expect(screen.getByText(text)).toBeInTheDocument();
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
        nothingToExit: null,
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

describe('a pending start that found nothing to move', () => {
  async function renderFound(nothingToExit: UnilateralExitFlow['engine']['nothingToExit'], mode?: 'recover') {
    flow.current = {
      phase: 'pending',
      mode,
      engine: {
        plan: null,
        pending: pendingExit({ mode }),
        pendingCoins: [coin(5_898)],
        nothingToExit,
        isStarting: false,
        startError: null,
        archive: [],
      },
      canGoBack: false,
      back: vi.fn(),
    } as unknown as UnilateralExitFlow;
    render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={vi.fn()} />);
    await waitForSheetOpen();
  }

  it.each([
    ['a recovery', 'recover' as const, 'Nothing can be recovered right now', 'Recover Funds'],
    ['an exit', undefined, 'Could not start the exit', 'Exit Spark'],
  ])('keeps the start of %s open when what it found may yet move', async (_, mode, title, action) => {
    await renderFound({ reason: 'unavailable' }, mode);
    expect(screen.getByText('Exit fee received')).toBeInTheDocument();
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText('Try again later.')).toBeInTheDocument();
    expect(screen.getByTestId('unilateral-exit-start-exit')).toHaveTextContent(new RegExp(`^${action}$`));
  });

  it.each([
    ['funds a recovery cannot recover', 'recover' as const, 'notRecoverable' as const, 'Nothing left to recover', "These funds can't be recovered."],
    ['funds already recovered', 'recover' as const, null, 'Nothing left to recover', 'These funds were already recovered.'],
    ['an exit with nothing it can move', undefined, 'notRecoverable' as const, 'Nothing here to exit', /This wallet holds no funds on Spark/],
  ])('leaves only a cancel for %s', async (_, mode, reason, title, body) => {
    await renderFound({ reason }, mode);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-start-exit')).not.toBeInTheDocument();
  });
});
