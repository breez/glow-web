import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

/** Opens the sheet on `first`. `show` hands the page the next flow the hook returns. */
async function open(first: UnilateralExitFlow, props: Partial<ComponentProps<typeof UnilateralExitPage>> = {}) {
  const onBack = vi.fn();
  const onFinished = vi.fn();
  const page = () => <UnilateralExitPage network="regtest" onBack={onBack} onFinished={onFinished} {...props} />;
  flow.current = first;
  const { rerender } = render(page());
  await waitForSheetOpen();
  const show = (next: UnilateralExitFlow) => {
    flow.current = next;
    rerender(page());
  };
  return { onBack, onFinished, show };
}

/** The tracker of `current`, or the intro once the engine holds no plan. */
const tracking = ({
  current = null,
  archive = [],
  endedPlans,
  mode,
  continueError = null,
}: {
  current?: UnilateralExitPlan | null;
  archive?: ArchivedExit[];
  endedPlans?: number;
  mode?: 'recover';
  continueError?: string | null;
}) =>
  ({
    phase: current ? 'tracker' : 'intro',
    mode,
    engine: { plan: current, pending: null, archive, tipHeight: 10, isAdvancing: false, endedPlans },
    canGoBack: false,
    back: vi.fn(),
    goTo: vi.fn(),
    rebuild: vi.fn(),
    continueExit: vi.fn(),
    isContinuing: false,
    continueError,
  }) as unknown as UnilateralExitFlow;

const quoteFlow = (
  exitFeeSat: number,
  {
    underWay = false,
    startError = null,
    mode,
    cosignedSat = 0,
    feeAlreadyHeld = false,
    bumping = false,
  }: {
    underWay?: boolean;
    startError?: string | null;
    mode?: 'recover';
    cosignedSat?: number;
    feeAlreadyHeld?: boolean;
    bumping?: boolean;
  } = {},
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
    bumping,
    bumpedTxid: bumping ? 'c1' : null,
    engine: { plan: underWay ? plan([]) : null, pending: null, archive: [] },
    canGoBack: true,
    back: vi.fn(),
    quote: { quote, figures: quoteFigures(quote), isQuoting: false, error: null },
    startError,
    feeAlreadyHeld,
    continueFromQuote: vi.fn(),
    goTo: vi.fn(),
  } as unknown as UnilateralExitFlow;
};

async function renderQuote(...args: Parameters<typeof quoteFlow>) {
  await open(quoteFlow(...args));
  return screen.getByTestId('unilateral-exit-quote-continue');
}

describe('the quote step of a recovery', () => {
  it('is titled and reviewed as a recovery', async () => {
    await renderQuote(0, { mode: 'recover' });
    expect(screen.getByRole('heading', { name: 'Recover Funds' })).toBeInTheDocument();
    expect(screen.getByText('Funds')).toBeInTheDocument();
    expect(screen.queryByText('Balance')).not.toBeInTheDocument();
  });

  it('says a recovery under way could not continue when its rebuild failed', async () => {
    await renderQuote(0, { mode: 'recover', underWay: true, startError: 'operators unreachable' });
    expect(screen.getByText('Could not continue the recovery')).toBeInTheDocument();
    expect(screen.queryByText('Could not recover the funds')).not.toBeInTheDocument();
  });

  it('speaks of a recovery while it quotes one, and when that quote fails', async () => {
    const quoting = (fields: Partial<UnilateralExitFlow['quote']>) =>
      ({
        ...quoteFlow(0, { mode: 'recover' }),
        quote: { quote: null, figures: null, isQuoting: false, error: null, ...fields },
      }) as UnilateralExitFlow;
    const { show } = await open(quoting({ isQuoting: true }));
    expect(screen.getByText('Working out what can be recovered...')).toBeInTheDocument();

    show(quoting({ error: 'operators unreachable' }));
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
    await open(next);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  }

  it('points a diverged exit whose rebuild needs the passkey at its update, and goes back straight to the tracker that holds it', async () => {
    await show(quoting(plan([tx({ txid: 'a' })], { status: { type: 'needsUpdate', why: 'signIn' } })));
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
    const sent = { phase: 'sent', mode: 'recover', sentSat: 45_300, engine: { plan: null, pending: null, archive: [] }, canGoBack: false, back: vi.fn() };
    const { onFinished } = await open(sent as unknown as UnilateralExitFlow, { mode: 'recover' });
    expect(screen.getByText('Funds sent')).toBeInTheDocument();
    expect(screen.getByText(/on its way/)).toHaveTextContent('45 300');
    fireEvent.click(screen.getByTestId('unilateral-exit-sent-done'));
    expect(onFinished).toHaveBeenCalled();
  });
});

describe('the sheet once a recovery lands', () => {
  const record = (id: string): ArchivedExit => ({ id, destination: 'bc1qdest', deliveredSat: 1, completedAt: 0 });

  it('closes when a co-signed recovery, which has no sweep, reaches the archive', async () => {
    const cosigned = plan([tx({ txid: 'coop-1', kind: 'cooperative', status: confirmed(9) })], { mode: 'recover' });
    const { onFinished, show } = await open(tracking({ current: cosigned, mode: 'recover' }));
    expect(onFinished).not.toHaveBeenCalled();

    show(tracking({ archive: [record('coop-1')], mode: 'recover' }));
    expect(onFinished).toHaveBeenCalled();
  });

  it('closes when a plan that finished with no transaction of its own leaves the slot, archived under another txid', async () => {
    const stuck = plan([tx({ txid: 'stuck', kind: 'cooperative', status: { type: 'unverified' } })], { mode: 'recover' });
    const { onFinished, show } = await open(tracking({ current: stuck, endedPlans: 2, mode: 'recover' }));

    // The stuck recovery was let go, and an earlier one landed.
    show(tracking({ current: plan([], { mode: 'recover', status: { type: 'done' } }), endedPlans: 2, mode: 'recover' }));
    expect(onFinished).not.toHaveBeenCalled();
    show(tracking({ archive: [record('earlier')], endedPlans: 3, mode: 'recover' }));
    expect(onFinished).toHaveBeenCalled();
  });

  it('closes when the plan it showed ends in one pass with nothing paid out, rather than falling back to the intro', async () => {
    const sweeping = plan([tx({ txid: 'sweep-1', kind: 'sweep' })], { mode: 'recover' });
    const { onFinished, show } = await open(tracking({ current: sweeping, endedPlans: 0, mode: 'recover' }));

    // Its last leaf was dropped as unrecoverable: nothing reaches the archive.
    show(tracking({ endedPlans: 1, mode: 'recover' }));
    expect(onFinished).toHaveBeenCalled();
  });

  it('stays open when the plan goes missing while it still runs, as while the engine restarts', async () => {
    const { onFinished, show } = await open(tracking({ current: plan([tx({ txid: 'sweep-1', kind: 'sweep' })]), endedPlans: 4 }));
    show(tracking({ endedPlans: 4 }));
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
  const renderBump = (first: UnilateralExitFlow) => open(first, { bumpTxid: 'c1' });

  it('says the recovery could not continue when its build failed, though no exit is under way', async () => {
    await renderBump(quoteFlow(0, { mode: 'recover', cosignedSat: 48_200, startError: 'Please try again or choose a different fee.', bumping: true }));
    expect(screen.getByText('Could not continue the recovery')).toBeInTheDocument();
    expect(screen.getByText('Please try again or choose a different fee.')).toBeInTheDocument();
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

describe('the fee screen of an exit under way', () => {
  const renderFund = (over: Partial<UnilateralExitFlow> = {}) =>
    open({
      phase: 'fund',
      engine: { plan: plan([tx({ txid: 'a' })]), pending: null, archive: [] },
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
      ...over,
    } as unknown as UnilateralExitFlow);

  it('continues the exit once its fee arrived', async () => {
    await renderFund();
    expect(screen.getByText('Exit fee received')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('unilateral-exit-build'));
    expect(flow.current.build).toHaveBeenCalled();
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

  it.each([
    ['a recovery', 'recover' as const, 'Continue Recovery'],
    ['an exit', undefined, 'Continue Exit'],
  ])('continues %s in its own words', async (_, mode, label) => {
    await renderFund({ mode });
    expect(screen.getByTestId('unilateral-exit-build')).toHaveTextContent(new RegExp(`^${label}$`));
  });
});

describe('updating an exit from the tracker', () => {
  const diverged = plan([tx({ txid: 'a' })], { status: { type: 'needsUpdate', why: 'signIn' } });
  const renderTracker = (current: UnilateralExitPlan, continueError: string | null = null) => open(tracking({ current, continueError }));

  it('offers the update on a diverged exit whose rebuild needs the passkey, which continues it at its own fee', async () => {
    await renderTracker(diverged);
    fireEvent.click(screen.getByTestId('unilateral-exit-rebuild'));
    expect(flow.current.continueExit).toHaveBeenCalled();
    expect(screen.queryByTestId('unilateral-exit-rebuild-wizard')).not.toBeInTheDocument();
  });

  it('offers a different fee once the update failed over its fee', async () => {
    await renderTracker(diverged, 'Insufficient CPFP funding: need at least 5000 sats');
    fireEvent.click(screen.getByTestId('unilateral-exit-rebuild-wizard'));
    expect(flow.current.rebuild).toHaveBeenCalled();
  });

  it('offers neither on a diverged exit Glow rebuilds by itself', async () => {
    await renderTracker(plan([tx({ txid: 'a' })], { status: { type: 'rebuilding' } }), 'Please try again.');
    expect(screen.getByTestId('unilateral-exit-tracker')).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-rebuild')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-rebuild-wizard')).not.toBeInTheDocument();
  });
});

describe('the quote step', () => {
  it.each([
    ['that starts the exit when the quote needs no funding', 0, {}, 'Exit Spark'],
    ['that continues an exit under way when the quote needs no funding', 0, { underWay: true }, 'Continue Exit'],
    ['that only continues, to the phrase and the fee, when the quote needs funding', 3_000, {}, 'Continue'],
    ['that sends recoverable funds that need no exit fee', 0, { mode: 'recover' as const }, 'Recover Funds'],
    [
      'that sends the co-signed part of a recovery that needs the exit fee for the rest',
      3_000,
      { mode: 'recover' as const, cosignedSat: 48_200 },
      'Recover Funds',
    ],
    ['that only continues a recovery when nothing goes out on the tap', 3_000, { mode: 'recover' as const }, 'Continue'],
    ['that continues a recovery under way', 0, { mode: 'recover' as const, underWay: true }, 'Continue Recovery'],
    ['that continues a fee raise, though no exit is under way', 0, { mode: 'recover' as const, cosignedSat: 48_200, bumping: true }, 'Continue Recovery'],
  ])('names the tap %s', async (_, exitFeeSat, options, label) => {
    const cta = await renderQuote(exitFeeSat, options);
    expect(cta).toHaveTextContent(new RegExp(`^${label}$`));
    fireEvent.click(cta);
    expect(flow.current.continueFromQuote).toHaveBeenCalled();
  });

  it.each([
    ['start when building it at once failed', false, 'Could not start the exit'],
    ['continue when rebuilding one under way failed', true, 'Could not continue the exit'],
  ])('says the exit could not %s', async (_, underWay, title) => {
    await renderQuote(0, { underWay, startError: 'operators unreachable' });
    expect(screen.getByText(title)).toBeInTheDocument();
  });

  it('asks for no exit fee the fee address already holds', async () => {
    await renderQuote(3_000, { feeAlreadyHeld: true });
    expect(screen.getByText('Exit fee')).toBeInTheDocument();
    expect(screen.queryByText(/To start the process/)).not.toBeInTheDocument();
  });

  it('says an exit under way has nothing to rebuild yet when the quote names none of its leaves', async () => {
    const empty = prepared({ leaves: [], recoverableValueSats: 0 });
    await open({
      ...quoteFlow(0, { underWay: true }),
      quote: { quote: empty, figures: quoteFigures(empty), isQuoting: false, error: null },
    } as UnilateralExitFlow);
    expect(screen.getByText('Nothing to rebuild right now')).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-quote-continue')).not.toBeInTheDocument();
  });
});

describe('the phrase unlock', () => {
  it.each([
    ['Unilateral Exit', undefined, 'Unilateral exit'],
    ['Recover Funds', 'recover' as const, 'Recover funds'],
  ])('names what it authorizes in %s', async (_, mode, reason) => {
    await open({ ...quoteFlow(3_000, { mode }), phase: 'unlock', unlock: vi.fn(async () => {}), unlockError: null } as unknown as UnilateralExitFlow);
    expect(await screen.findByTestId('pin-gate-reason')).toHaveTextContent(reason);
  });

  it("says sign-in failed in the app's words, and tries again", async () => {
    const unlock = vi.fn(async () => {});
    const unlockError = 'The operation either timed out or was not allowed.';
    await open({ ...quoteFlow(3_000), phase: 'unlock', unlock, unlockError } as unknown as UnilateralExitFlow);

    expect(screen.getByText('Sign-in failed')).toBeInTheDocument();
    expect(screen.getByText('Please try again.')).toBeInTheDocument();
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
    await open({ ...quoteFlow(0, { mode }), phase: 'building' } as unknown as UnilateralExitFlow);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});

/** An exit waiting on its fee, whose fee address holds `coins`. */
const pendingFlow = (
  mode: 'recover' | undefined,
  coins: UnilateralExitFlow['engine']['pendingCoins'] = [],
  nothingToExit: UnilateralExitFlow['engine']['nothingToExit'] = null,
) =>
  ({
    phase: 'pending',
    mode,
    engine: { plan: null, pending: pendingExit({ mode }), pendingCoins: coins, nothingToExit, isStarting: false, startError: null, archive: [] },
    canGoBack: false,
    back: vi.fn(),
  }) as unknown as UnilateralExitFlow;

describe('cancelling an exit that waits on its fee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["closes the sheet on a recovery, rather than land on the exit's intro", 'recover' as const, 1],
    ['stays open on an exit, which starts again from its intro', undefined, 0],
  ])('%s', async (_, mode, closes) => {
    const { onBack } = await open(pendingFlow(mode));
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByTestId('unilateral-exit-cancel'));
    expect(cancelPendingExit).toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledTimes(closes);
  });
});

describe('a pending start that found nothing to move', () => {
  it.each([
    ['a recovery', 'recover' as const, 'Nothing can be recovered right now', 'Recover Funds'],
    ['an exit', undefined, 'Could not start the exit', 'Exit Spark'],
  ])('keeps the start of %s open when what it found may yet move', async (_, mode, title, action) => {
    await open(pendingFlow(mode, [coin(5_898)], { reason: 'unavailable' }));
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
    await open(pendingFlow(mode, [coin(5_898)], { reason }));
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-start-exit')).not.toBeInTheDocument();
  });
});
