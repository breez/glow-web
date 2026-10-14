import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PrepareRecoverFundsResponse, RecoverFundsLeaf, RecoverFundsResponse } from '@breeztech/breez-sdk-spark';
import type { ChainUtxo } from '@/services/chain';
import type { ExitAccounting } from '../storage/accounting';
import type { ArchivedExit } from '../storage/archive';
import type { ExitMode, PendingExit, UnilateralExitPlan } from '../model/plan';
import type { ExitSdk } from '../quoting';
import { checked, coin, confirmed, funding, MNEMONIC, pendingExit, plan, prepared, rawTx, sdk, tx, txidOf } from '../testFixtures';

const wallet = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/contexts/WalletContext', () => ({
  useWallet: () => wallet.current,
  useWalletInfo: () => ({ identityPubkey: '02abc', balanceSats: 100_000 }),
}));
const chainTip = vi.hoisted(() => vi.fn(async () => 812));
const addressUtxos = vi.hoisted(() => vi.fn(async (): Promise<ChainUtxo[]> => []));
vi.mock('@/services/chain', () => ({
  createChainClient: () => ({
    feeRates: async () => ({ slow: 1, medium: 2, fast: 3 }),
    addressUtxos,
    tipHeight: chainTip,
  }),
}));
// Still the real signer: the spy only records which key it was made from.
vi.mock('@breeztech/breez-sdk-spark', async importOriginal => {
  const actual = await importOriginal<typeof import('@breeztech/breez-sdk-spark')>();
  return { ...actual, singleKeyCpfpSigner: vi.fn(actual.singleKeyCpfpSigner) };
});
vi.mock('@/services/appLock', () => ({ holdIdleLock: () => () => {} }));
vi.mock('../exitState', () => ({ loadExitState: async () => null, restoreExitState: async () => {} }));
vi.mock('../funding', async () => ({
  ...(await vi.importActual('../funding')),
  readWalletMnemonic: vi.fn(async () => 'never read'),
}));
// The exit the flow resumes, if any; the engine itself is not running here.
const saved = vi.hoisted(() => ({
  plan: null as UnilateralExitPlan | null,
  pending: null as PendingExit | null,
  pendingCoins: [] as ChainUtxo[],
  tipHeight: null as number | null,
  archive: [] as ArchivedExit[],
  recoveries: [] as UnilateralExitPlan[],
  accounting: { droppedLeaves: [], unsettledLeaves: [] } as ExitAccounting,
}));
vi.mock('./useUnilateralExitEngineLifecycle', () => ({
  useUnilateralExitEngineState: () => ({
    plan: saved.plan,
    pending: saved.pending,
    pendingCoins: saved.pendingCoins,
    nothingToExit: null,
    isStarting: false,
    startError: null,
    archive: saved.archive,
    recoveries: saved.recoveries,
    accounting: saved.accounting,
    tipHeight: saved.tipHeight,
    isAdvancing: false,
  }),
}));
vi.mock('../engine/api', async () => ({
  ...(await vi.importActual('../engine/api')),
  keepRecovery: vi.fn(),
  noteDropped: vi.fn(),
  setPendingExit: vi.fn(),
  setUnilateralExitPlan: vi.fn(),
}));
vi.mock('../engine/polling', async () => ({
  ...(await vi.importActual('../engine/polling')),
  advanceNow: vi.fn(),
}));

import { singleKeyCpfpSigner } from '@breeztech/breez-sdk-spark';
import { useUnilateralExitFlow } from './useUnilateralExitFlow';
import { keepRecovery, noteDropped, setPendingExit, setUnilateralExitPlan } from '../engine/api';
import { advanceNow } from '../engine/polling';
import { deriveFundingKey, readWalletMnemonic } from '../funding';

const unfunded = () => prepared({ funding: undefined, cpfpFeeSats: 0 });

const cosignedLeaves: RecoverFundsLeaf[] = [
  { leafId: 'c-1', valueSats: 30_000, method: 'cooperative' },
  { leafId: 'c-2', valueSats: 18_200, method: 'cooperative' },
];

/** Two co-signed leaves at 1 450 each: nothing to fund. */
const cosignedQuote = prepared({
  leaves: cosignedLeaves,
  recoverableValueSats: 48_200,
  sweepFeeSats: 0,
  cpfpFeeSats: 0,
  cooperativeFeeSats: 2_900,
  totalFeeSats: 2_900,
  funding: undefined,
});

const cosignedBuild = (over: Partial<RecoverFundsResponse> = {}) =>
  checked(
    [
      { txid: 'c1', kind: 'cooperative', nodeId: 'c-1' },
      { txid: 'c2', kind: 'cooperative', nodeId: 'c-2' },
    ],
    { leaves: cosignedLeaves, recoverableValueSats: 48_200, cooperativeFeeSats: 2_900, sweepFeeSats: 0, ...over },
  );

/** Opens the flow on a quote at the medium rate. */
async function quoted(
  quote: PrepareRecoverFundsResponse,
  recoverFunds = vi.fn(async () => checked([{ txid: 'sweep', kind: 'sweep' }])),
  {
    mode,
    prepareRecoverFunds = vi.fn<ExitSdk['prepareRecoverFunds']>(async () => quote),
  }: { mode?: ExitMode; prepareRecoverFunds?: Mock<ExitSdk['prepareRecoverFunds']> } = {},
) {
  wallet.current = sdk({ prepareRecoverFunds, recoverFunds });
  const { result, rerender } = renderHook(() => useUnilateralExitFlow('regtest', mode));
  act(() => result.current.goTo('fee'));
  await waitFor(() => expect(result.current.fee.feeRates).not.toBeNull());
  await act(() => result.current.submitFee());
  return { result, rerender, recoverFunds, prepareRecoverFunds };
}

describe('continuing from the quote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saved.plan = null;
  });

  it('builds a quote that needs no funding at once: no phrase, no inputs, no signer', async () => {
    const { result, recoverFunds } = await quoted(unfunded());
    await act(() => result.current.continueFromQuote());

    await waitFor(() => expect(setUnilateralExitPlan).toHaveBeenCalled());
    expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: expect.anything() }]);
    expect(readWalletMnemonic).not.toHaveBeenCalled();
    expect(setPendingExit).not.toHaveBeenCalled();
    // Nothing was paid, so the finished exit lists no exit fee.
    const built = vi.mocked(setUnilateralExitPlan).mock.calls[0][1];
    expect(built.quotedExitFeeSat).toBeUndefined();
    expect(built.exitFeeAddress).toBeUndefined();
  });

  it('shows why that build failed on the quote it came from', async () => {
    const failing = vi.fn(async () => {
      throw new Error('operators unreachable');
    });
    const { result } = await quoted(unfunded(), failing);
    await act(() => result.current.continueFromQuote());

    expect(result.current.phase).toBe('quote');
    expect(result.current.startError).toBe('operators unreachable');
    expect(setUnilateralExitPlan).not.toHaveBeenCalled();
  });

  it('asks to try again, and saves nothing, when the build comes back empty', async () => {
    const { result } = await quoted(unfunded(), vi.fn(async () => checked([])));
    await act(() => result.current.continueFromQuote());

    expect(result.current.phase).toBe('quote');
    expect(result.current.startError).toBe('Please try again.');
    expect(setUnilateralExitPlan).not.toHaveBeenCalled();
  });

  it('continues an exit under way that needs no more funding, keeping what it was built with', async () => {
    saved.plan = plan([], {
      fundingAddressIndex: 2,
      mode: 'recover',
      exitStateSnapshot: 'frozen',
      quotedExitFeeSat: 14_350,
      exitFeeAddress: 'bcrt1qfee',
    });
    const { result } = await quoted(unfunded());
    await act(() => result.current.continueFromQuote());

    await waitFor(() => expect(setUnilateralExitPlan).toHaveBeenCalled());
    expect(vi.mocked(setUnilateralExitPlan).mock.calls[0][1]).toMatchObject({
      fundingAddressIndex: 2,
      mode: 'recover',
      exitStateSnapshot: 'frozen',
      quotedExitFeeSat: 14_350,
      exitFeeAddress: 'bcrt1qfee',
    });
    expect(readWalletMnemonic).not.toHaveBeenCalled();
  });

  it('takes a quote that needs funding to the phrase, and builds nothing yet', async () => {
    const { result, recoverFunds } = await quoted(prepared({ funding: funding(3_000) }));
    await act(() => result.current.continueFromQuote());

    expect(result.current.phase).toBe('unlock');
    expect(recoverFunds).not.toHaveBeenCalled();
  });
});

describe('unlocking the phrase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saved.plan = null;
  });

  // The page runs unlock again whenever it changes, and each run asks for the passkey.
  it('keeps one unlock across engine passes, which emit a new plan each time', async () => {
    saved.plan = plan([], { fundingAddressIndex: 2 });
    const { result, rerender } = await quoted(prepared({ funding: funding(3_000) }));
    const unlock = result.current.unlock;

    saved.plan = { ...saved.plan };
    rerender();
    expect(result.current.unlock).toBe(unlock);
  });
});

describe('which leaves a quote takes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saved.plan = null;
    saved.archive = [];
  });

  it('takes every leaf for a fresh exit', async () => {
    const { prepareRecoverFunds, result } = await quoted(unfunded());
    expect(prepareRecoverFunds).toHaveBeenCalledWith(expect.objectContaining({ selection: { type: 'all' } }));
    expect(result.current.mode).toBeUndefined();
  });

  it('leaves out the leaves a finished exit dropped as unrecoverable', async () => {
    saved.archive = [
      { id: 'old', destination: 'bcrt1qdest', deliveredSat: 1, completedAt: 0, droppedLeaves: [{ leafId: 'd-1', valueSats: 5_000 }] },
    ];
    const prepareRecoverFunds = vi
      .fn<ExitSdk['prepareRecoverFunds']>()
      .mockResolvedValueOnce(
        prepared({
          leaves: [
            { leafId: 'd-1', valueSats: 5_000, method: 'cooperative' },
            { leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' },
          ],
        }),
      )
      .mockResolvedValue(unfunded());
    await quoted(unfunded(), undefined, { prepareRecoverFunds });
    expect(prepareRecoverFunds).toHaveBeenLastCalledWith(
      expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-1'] } }),
    );
  });

  it("names a saved exit's leaves, the ones whose co-signing failed too", async () => {
    saved.plan = plan([], {
      exit: { failed: [{ leafId: 'c-9', outputTxid: 'o', outputVout: 0, error: { type: 'generic', message: 'refused' } }] },
    });
    const { prepareRecoverFunds } = await quoted(unfunded());
    expect(prepareRecoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-1', 'c-9'] } }),
    );
  });
});

describe('Recover Funds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saved.plan = null;
  });

  it('opens on where to send the funds, with nothing to go back to', () => {
    wallet.current = sdk();
    const { result } = renderHook(() => useUnilateralExitFlow('regtest', 'recover'));
    expect(result.current.phase).toBe('destination');
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.mode).toBe('recover');
  });

  it("goes back from a rebuild's destination to its tracker", () => {
    saved.plan = plan([], { mode: 'recover' });
    wallet.current = sdk();
    const { result } = renderHook(() => useUnilateralExitFlow('regtest'));
    act(() => result.current.rebuild());
    act(() => result.current.back());

    expect(result.current.phase).toBe('destination');
    expect(result.current.canGoBack).toBe(true);
    act(() => result.current.back());
    expect(result.current.phase).toBe('tracker');
  });

  it('syncs after an empty quote that skipped nothing, so the row stops offering recovered funds', async () => {
    const syncWallet = vi.fn<ExitSdk['syncWallet']>(async () => ({}));
    const empty = prepared({ leaves: [], recoverableValueSats: 0, totalFeeSats: 0, skipped: [], funding: undefined });
    wallet.current = sdk({ prepareRecoverFunds: async () => empty, syncWallet });
    const { result } = renderHook(() => useUnilateralExitFlow('regtest', 'recover'));
    act(() => result.current.goTo('fee'));
    await waitFor(() => expect(result.current.fee.feeRates).not.toBeNull());
    await act(() => result.current.submitFee());
    expect(syncWallet).toHaveBeenCalledTimes(1);

    // A quote that skipped something is not a recovery found on-chain.
    syncWallet.mockClear();
    wallet.current = sdk({
      prepareRecoverFunds: async () => ({ ...empty, skipped: [{ leafId: 'x', valueSats: 350, reason: { type: 'unverified' } }] }),
      syncWallet,
    });
    const second = renderHook(() => useUnilateralExitFlow('regtest', 'recover'));
    act(() => second.result.current.goTo('fee'));
    await waitFor(() => expect(second.result.current.fee.feeRates).not.toBeNull());
    await act(() => second.result.current.submitFee());
    expect(syncWallet).not.toHaveBeenCalled();
  });

  describe('beside coins an earlier exit left at the shared fee address', () => {
    const lastExit: ArchivedExit = { id: 'old', destination: 'bcrt1qdest', deliveredSat: 1, completedAt: 0, exitFeeAddress: 'bcrt1qshared' };

    afterEach(() => {
      saved.archive = [];
      addressUtxos.mockReset();
    });

    it("reads that address from the last exit's record, without the phrase, and says when it holds the fee already", async () => {
      saved.archive = [lastExit];
      addressUtxos.mockResolvedValue([coin(3_000)]);
      const { result } = await quoted(prepared(), undefined, { mode: 'recover' });
      await waitFor(() => expect(result.current.feeAlreadyHeld).toBe(true));
      expect(addressUtxos).toHaveBeenCalledWith('bcrt1qshared');
      expect(readWalletMnemonic).not.toHaveBeenCalled();
    });

    it('still asks for the fee when the address holds too little', async () => {
      saved.archive = [lastExit];
      addressUtxos.mockResolvedValue([coin(2_000)]);
      const { result } = await quoted(prepared(), undefined, { mode: 'recover' });
      await waitFor(() => expect(addressUtxos).toHaveBeenCalledWith('bcrt1qshared'));
      expect(result.current.feeAlreadyHeld).toBe(false);
    });
  });

  it('quotes only the funds outside the balance', async () => {
    const { prepareRecoverFunds } = await quoted(cosignedQuote, undefined, { mode: 'recover' });
    expect(prepareRecoverFunds).toHaveBeenCalledWith(expect.objectContaining({ selection: { type: 'recoverableOnly' } }));
  });

  it('keeps hidden what a quote finds unrecoverable, and leaves it out of the next quote', async () => {
    const skipped = [
      { leafId: 'd-1', valueSats: 5_000, reason: { type: 'notRecoverable' as const, message: 'paid elsewhere' } },
      { leafId: 'x', valueSats: 350, reason: { type: 'unverified' as const } },
      // Unrecoverable only until the operators relabel it.
      { leafId: 's-1', valueSats: 7_000, reason: { type: 'notRecoverable' as const, message: 'stopped' } },
    ];
    const exitChainState = { ...cosignedQuote.exitChainState, stoppedLeafIds: ['s-1'] };
    await quoted({ ...cosignedQuote, skipped, exitChainState }, undefined, { mode: 'recover' });
    expect(noteDropped).toHaveBeenCalledWith({ identityPubkey: '02abc', network: 'regtest' }, [{ leafId: 'd-1', valueSats: 5_000 }]);

    saved.accounting = { droppedLeaves: [{ leafId: 'd-1', valueSats: 5_000 }], unsettledLeaves: [] };
    try {
      const prepareRecoverFunds = vi
        .fn<ExitSdk['prepareRecoverFunds']>()
        .mockResolvedValueOnce(prepared({ leaves: [{ leafId: 'd-1', valueSats: 5_000, method: 'cooperative' }, ...cosignedLeaves] }))
        .mockResolvedValue(cosignedQuote);
      await quoted(cosignedQuote, undefined, { mode: 'recover', prepareRecoverFunds });
      expect(prepareRecoverFunds).toHaveBeenLastCalledWith(
        expect.objectContaining({ selection: { type: 'specific', leafIds: ['c-1', 'c-2'] } }),
      );
    } finally {
      saved.accounting = { droppedLeaves: [], unsettledLeaves: [] };
    }
  });

  it('offers a leaf the operators stopped for six blocks after a review first sees it, then drops it as unrecoverable', async () => {
    const stopped = prepared({
      leaves: [],
      recoverableValueSats: 0,
      totalFeeSats: 0,
      funding: undefined,
      skipped: [{ leafId: 's-1', valueSats: 7_000, reason: { type: 'notRecoverable', message: 'stopped' } }],
      exitChainState: { ...cosignedQuote.exitChainState, stoppedLeafIds: ['s-1'] },
    });
    const first = await quoted(stopped, undefined, { mode: 'recover' });
    expect(first.result.current.quote.figures?.leftOutReason).toBe('unavailable');
    expect(noteDropped).toHaveBeenLastCalledWith({ identityPubkey: '02abc', network: 'regtest' }, []);

    chainTip.mockResolvedValueOnce(818);
    const later = await quoted(stopped, undefined, { mode: 'recover' });
    expect(later.result.current.quote.figures?.leftOutReason).toBe('notRecoverable');
    expect(noteDropped).toHaveBeenLastCalledWith({ identityPubkey: '02abc', network: 'regtest' }, [{ leafId: 's-1', valueSats: 7_000 }]);
  });

  it('keeps a stopped leaf on offer when the chain cannot be read, which would date it', async () => {
    chainTip.mockRejectedValueOnce(new Error('chain service unavailable'));
    const stopped = prepared({
      leaves: [],
      skipped: [{ leafId: 's-1', valueSats: 7_000, reason: { type: 'notRecoverable', message: 'stopped' } }],
      exitChainState: { ...cosignedQuote.exitChainState, stoppedLeafIds: ['s-1'] },
    });
    const { result } = await quoted(stopped, undefined, { mode: 'recover' });
    expect(result.current.quote.figures?.leftOutReason).toBe('unavailable');
    expect(result.current.quote.quote).not.toBeNull();
  });

  it('notes nothing dropped from a quote for an exit', async () => {
    await quoted({ ...unfunded(), skipped: [{ leafId: 'd-1', valueSats: 5_000, reason: { type: 'notRecoverable', message: 'gone' } }] });
    expect(noteDropped).not.toHaveBeenCalled();
  });

  it('notes nothing dropped from a quote of a recovery under way, which its plan records', async () => {
    saved.plan = plan([tx({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1' })], {
      network: 'regtest',
      mode: 'recover',
      exit: { leaves: [cosignedLeaves[0]] },
    });
    try {
      const prepareRecoverFunds = vi.fn<ExitSdk['prepareRecoverFunds']>(async () => ({
        ...cosignedQuote,
        skipped: [{ leafId: 'c-1', valueSats: 30_000, reason: { type: 'notRecoverable', message: 'gone' } }],
      }));
      wallet.current = sdk({ prepareRecoverFunds });
      const { result } = renderHook(() => useUnilateralExitFlow('regtest'));
      act(() => result.current.rebuild());
      await waitFor(() => expect(result.current.fee.feeRates).not.toBeNull());
      await act(() => result.current.submitFee());
      expect(prepareRecoverFunds).toHaveBeenCalledWith(expect.objectContaining({ selection: { type: 'specific', leafIds: ['c-1'] } }));
      expect(noteDropped).not.toHaveBeenCalled();
    } finally {
      saved.plan = null;
    }
  });

  it('keeps a co-signed recovery beside the plan slot, and says what is on its way', async () => {
    const { result } = await quoted(cosignedQuote, vi.fn(async () => cosignedBuild()), { mode: 'recover' });
    await act(() => result.current.continueFromQuote());

    expect(keepRecovery).toHaveBeenCalledWith({ identityPubkey: '02abc', network: 'regtest' }, expect.objectContaining({ mode: 'recover' }));
    expect(setUnilateralExitPlan).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('sent');
    expect(result.current.sentSat).toBe(45_300);
  });

  it('counts only what the operators co-signed in what is on its way', async () => {
    const partial = cosignedBuild({
      leaves: [cosignedLeaves[0]],
      recoverableValueSats: 30_000,
      cooperativeFeeSats: 1_450,
      transactions: [checked([{ txid: 'c1', kind: 'cooperative', nodeId: 'c-1' }]).transactions[0]],
      failed: [{ leafId: 'c-2', outputTxid: 'o', outputVout: 0, error: { type: 'operatorsUnavailable', message: 'down' } }],
    });
    const { result } = await quoted(cosignedQuote, vi.fn(async () => partial), { mode: 'recover' });
    await act(() => result.current.continueFromQuote());
    expect(result.current.sentSat).toBe(28_550);
  });

  it('puts a recovery with a sweep in the plan slot, as a recovery', async () => {
    const { result } = await quoted(unfunded(), undefined, { mode: 'recover' });
    await act(() => result.current.continueFromQuote());

    await waitFor(() => expect(setUnilateralExitPlan).toHaveBeenCalled());
    expect(vi.mocked(setUnilateralExitPlan).mock.calls[0][1].mode).toBe('recover');
    expect(keepRecovery).not.toHaveBeenCalled();
  });

  describe('a mixed quote, which needs the exit fee for part of it', () => {
    const stranded: RecoverFundsLeaf = { leafId: 's-1', valueSats: 120_000, method: 'unilateral' };
    const mixed = prepared({
      leaves: [stranded, ...cosignedLeaves],
      recoverableValueSats: 168_200,
      sweepFeeSats: 1_100,
      cooperativeFeeSats: 2_900,
      totalFeeSats: 18_350,
      funding: funding(14_350),
    });

    it('sends the co-signed part on the tap, then asks for the exit fee for the rest', async () => {
      const prepareRecoverFunds = vi.fn<ExitSdk['prepareRecoverFunds']>().mockResolvedValueOnce(mixed).mockResolvedValueOnce(cosignedQuote);
      const recoverFunds = vi.fn(async () => cosignedBuild());
      const { result } = await quoted(mixed, recoverFunds, { mode: 'recover', prepareRecoverFunds });
      await act(() => result.current.continueFromQuote());

      expect(prepareRecoverFunds).toHaveBeenLastCalledWith(
        expect.objectContaining({ selection: { type: 'specific', leafIds: ['c-1', 'c-2'] } }),
      );
      expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: cosignedQuote }]);
      expect(keepRecovery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: 'recover' }));
      expect(result.current.phase).toBe('unlock');

      vi.mocked(readWalletMnemonic).mockResolvedValueOnce(MNEMONIC);
      await act(() => result.current.unlock());
      expect(setPendingExit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mode: 'recover', willReceiveSat: 118_900, required: { sat: 14_350, inputs: 1 } }),
        expect.anything(),
      );
    });

    const refused = (leafId: string) => ({
      leafId,
      outputTxid: 'o',
      outputVout: 0,
      error: { type: 'operatorsUnavailable' as const, message: 'unreachable' },
    });

    it.each([
      ['nobody co-signs', async () => cosignedBuild({ leaves: [], transactions: [], failed: [refused('c-1'), refused('c-2')] })],
      [
        'the co-signing fails',
        async (): Promise<RecoverFundsResponse> => {
          throw new Error('operators unreachable');
        },
      ],
    ])('goes on to the exit fee for the rest when %s, keeping nothing', async (_, build) => {
      const prepareRecoverFunds = vi.fn<ExitSdk['prepareRecoverFunds']>().mockResolvedValueOnce(mixed).mockResolvedValueOnce(cosignedQuote);
      const { result } = await quoted(mixed, vi.fn(build), { mode: 'recover', prepareRecoverFunds });
      await act(() => result.current.continueFromQuote());

      expect(result.current.phase).toBe('unlock');
      expect(result.current.startError).toBeNull();
      expect(keepRecovery).not.toHaveBeenCalled();
      vi.mocked(readWalletMnemonic).mockResolvedValueOnce(MNEMONIC);
      await act(() => result.current.unlock());
      expect(setPendingExit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mode: 'recover', willReceiveSat: 118_900, required: { sat: 14_350, inputs: 1 } }),
        expect.anything(),
      );
    });
  });
});

describe('the update tap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saved.tipHeight = null;
  });

  const tapOn = async (stalled: UnilateralExitPlan) => {
    saved.plan = stalled;
    wallet.current = sdk({
      prepareRecoverFunds: async () => unfunded(),
      recoverFunds: async () => checked([{ txid: 'again', status: { type: 'unverified' } }]),
    });
    vi.mocked(readWalletMnemonic).mockResolvedValueOnce(MNEMONIC);
    const { result } = renderHook(() => useUnilateralExitFlow('regtest'));
    await act(() => result.current.continueExit());
    expect(result.current.continueError).toBeNull();
    return vi.mocked(setUnilateralExitPlan).mock.calls[0][1];
  };

  it('stamps the block on the rebuild, so a step it still could not read does not ask again at once', async () => {
    saved.tipHeight = 811;
    const stored = await tapOn(
      plan([tx({ txid: 'stuck', status: { type: 'unverified' } })], { status: { type: 'needsUpdate', why: 'signIn', cause: 'unverified' } }),
    );

    expect(stored).toMatchObject({ unverifiedRebuiltAt: 812 });
    expect(stored.status).toEqual({ type: 'running' });
  });

  it('reads the block itself on a diverged exit, whose paused engine holds no tip', async () => {
    const stored = await tapOn(plan([tx({ txid: 'moved' })], { status: { type: 'needsUpdate', why: 'signIn' } }));

    expect(chainTip).toHaveBeenCalled();
    expect(stored).toMatchObject({ status: { type: 'running' }, unverifiedRebuiltAt: 812 });
  });

  it("falls back to the engine's block when the chain cannot be read", async () => {
    saved.tipHeight = 811;
    chainTip.mockRejectedValueOnce(new Error('chain service unavailable'));
    const stored = await tapOn(plan([tx({ txid: 'moved' })], { status: { type: 'needsUpdate', why: 'signIn' } }));

    expect(stored).toMatchObject({ status: { type: 'running' }, unverifiedRebuiltAt: 811 });
  });

  describe('when the chain has yet to show where a leaf went', () => {
    const waiting = prepared({ leaves: [], skipped: [{ leafId: 'leaf-1', valueSats: 100_000, reason: { type: 'unverified' } }] });

    const tapWaiting = async (stalled: UnilateralExitPlan) => {
      saved.plan = stalled;
      wallet.current = sdk({ prepareRecoverFunds: async () => waiting });
      vi.mocked(readWalletMnemonic).mockResolvedValueOnce(MNEMONIC);
      const { result } = renderHook(() => useUnilateralExitFlow('regtest'));
      await act(() => result.current.continueExit());
      return result.current;
    };

    it('lifts the sign-in request, without an error, so the engine waits it out', async () => {
      const after = await tapWaiting(
        plan([tx({ txid: 'moved' })], { status: { type: 'needsUpdate', why: 'signIn' }, rebuildFailingSince: 90 }),
      );

      expect(after.continueError).toBeNull();
      const stored = vi.mocked(setUnilateralExitPlan).mock.calls[0][1];
      expect(stored.status).toEqual({ type: 'rebuilding' });
      expect(stored.rebuildFailingSince).toBeUndefined();
      expect(advanceNow).not.toHaveBeenCalled();
    });

    it('lifts the request over a step it could not read back to a running exit', async () => {
      await tapWaiting(
        plan([tx({ txid: 'stuck', status: { type: 'unverified' } })], { status: { type: 'needsUpdate', why: 'signIn', cause: 'unverified' } }),
      );
      expect(vi.mocked(setUnilateralExitPlan).mock.calls[0][1].status).toEqual({ type: 'running' });
    });

    it("leaves a failed rebuild's plan to the engine, whose next pass clears it", async () => {
      const after = await tapWaiting(plan([tx({ txid: 'moved' })], { status: { type: 'needsUpdate', why: 'rebuildFailed' } }));

      expect(after.continueError).toBeNull();
      expect(setUnilateralExitPlan).not.toHaveBeenCalled();
      expect(advanceNow).toHaveBeenCalled();
    });
  });

  describe('when the update fails for another reason', () => {
    const tapFailing = async () => {
      saved.plan = plan([tx({ txid: 'moved' })], { status: { type: 'needsUpdate', why: 'rebuildFailed' } });
      wallet.current = sdk({
        prepareRecoverFunds: async () => {
          throw new Error('operators unreachable');
        },
      });
      vi.mocked(readWalletMnemonic).mockResolvedValueOnce(MNEMONIC);
      const hook = renderHook(() => useUnilateralExitFlow('regtest'));
      await act(() => hook.result.current.continueExit());
      return hook;
    };

    it('shows it, so a different fee stays on offer', async () => {
      const { result } = await tapFailing();

      expect(result.current.continueError).toBe('operators unreachable');
      expect(setUnilateralExitPlan).not.toHaveBeenCalled();
    });

    it('drops it on the way to a different fee, whose own screens it does not belong on', async () => {
      const { result } = await tapFailing();
      act(() => result.current.rebuild());
      expect(result.current.phase).toBe('fee');
      expect(result.current.continueError).toBeNull();
    });

    it('drops it once the card goes, so a card that comes back explains itself again', async () => {
      const { result, rerender } = await tapFailing();

      saved.plan = plan([tx({ txid: 'moved' })], { status: { type: 'rebuilding' } });
      rerender();
      saved.plan = plan([tx({ txid: 'moved' })], { status: { type: 'needsUpdate', why: 'rebuildFailed' } });
      rerender();
      expect(result.current.continueError).toBeNull();
    });
  });
});

describe('a leaf the exit left out, waiting on more exit fee', () => {
  const soloLeaf = { leafId: 'leaf-2', valueSats: 50_000, method: 'unilateral' as const };
  const waiting = (over: Parameters<typeof plan>[1] = {}) =>
    plan([tx({ txid: 's', kind: 'sweep', status: confirmed(9) })], {
      feeRateSatPerVbyte: 4,
      exitFeeAddress: 'bcrt1qfee',
      quotedExitFeeSat: 5_000,
      status: { type: 'needsExitFee', topUp: { required: { sat: 3_000, inputs: 1 }, heldSat: 0 } },
      namedLeaves: [
        { leafId: 'leaf-1', valueSats: 100_000 },
        { leafId: 'leaf-2', valueSats: 50_000 },
      ],
      ...over,
    });
  const askQuote = prepared({ leaves: [soloLeaf], funding: funding(3_000), feeRateSatPerVbyte: 4 });
  const nextPart = () =>
    checked([{ txid: 'refund-2', kind: 'refund', nodeId: 'leaf-2', status: { type: 'waitingForTimelock', spendableAtHeight: 900 } }], {
      leaves: [soloLeaf],
    });

  beforeEach(() => {
    vi.clearAllMocks();
    saved.plan = waiting();
    saved.pendingCoins = [];
  });

  afterEach(() => {
    saved.pendingCoins = [];
  });

  it("opens on its fee screen with the plan's address and rate and the coins the engine read, and moves to the tracker once it is built", () => {
    saved.pendingCoins = [coin(1_000), coin(500, false)];
    wallet.current = sdk();
    const { result, rerender } = renderHook(() => useUnilateralExitFlow('regtest'));

    expect(result.current.phase).toBe('fund');
    expect(result.current.canGoBack).toBe(false);
    // The coin on its way counts toward what is still to send, as on the list row.
    expect(result.current.funding).toEqual({
      address: 'bcrt1qfee',
      isFunded: false,
      topUp: { neededSat: 3_544, sentSat: 1_500, stillToSendSat: 2_044 },
      waitsForConfirmation: false,
      feeRate: 4,
      currentFeeRate: 4,
      networkFloorFeeRate: null,
      quotedAt: null,
    });
    act(() => result.current.goTo('topUp'));
    expect(result.current.phase).toBe('topUp');
    expect(result.current.canGoBack).toBe(false);

    saved.plan = waiting({ status: { type: 'running' } });
    rerender();
    expect(result.current.phase).toBe('tracker');
  });

  it('asks for nothing more once the payment is on its way, and waits for it to confirm', () => {
    saved.pendingCoins = [coin(3_000, false)];
    wallet.current = sdk();
    const { result } = renderHook(() => useUnilateralExitFlow('regtest'));
    expect(result.current.funding?.topUp?.stillToSendSat).toBe(0);
    expect(result.current.funding?.waitsForConfirmation).toBe(true);
    expect(result.current.funding?.isFunded).toBe(false);
  });

  it('waits for a unilateral step in flight, but not for a co-signed recovery, which the build carries', () => {
    saved.pendingCoins = [coin(3_000)];
    wallet.current = sdk();
    const sweep = tx({ txid: 's', kind: 'sweep', status: confirmed(9) });
    saved.plan = waiting({ exit: { transactions: [{ ...sweep, status: { type: 'ready' } }] } });
    const { result, rerender } = renderHook(() => useUnilateralExitFlow('regtest'));
    expect(result.current.funding?.isFunded).toBe(false);
    expect(result.current.funding?.waitsForConfirmation).toBe(true);

    saved.plan = waiting({ exit: { transactions: [sweep, tx({ txid: 'c9', kind: 'cooperative', nodeId: 'c-9', status: { type: 'unverified' } })] } });
    rerender();
    expect(result.current.funding?.isFunded).toBe(true);
    expect(result.current.funding?.waitsForConfirmation).toBe(false);
  });

  it('builds it from the tap once the fee confirms, reading the phrase first, and stores what it built', async () => {
    // Only the confirmed coin funds it: a build spends nothing from the mempool.
    saved.pendingCoins = [coin(3_000), coin(1_000, false)];
    const recoverFunds = vi.fn<ExitSdk['recoverFunds']>(async () => nextPart());
    wallet.current = sdk({ prepareRecoverFunds: async () => askQuote, recoverFunds });
    vi.mocked(readWalletMnemonic).mockResolvedValueOnce(MNEMONIC);
    const { result } = renderHook(() => useUnilateralExitFlow('regtest'));
    expect(result.current.funding?.isFunded).toBe(true);
    await act(() => result.current.build());

    expect(readWalletMnemonic).toHaveBeenCalledWith({ interactive: true });
    expect(recoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ fundingInputs: [expect.objectContaining({ txid: 'coin-3000', valueSats: 3_000 })] }),
      expect.anything(),
    );
    const stored = vi.mocked(setUnilateralExitPlan).mock.calls[0][1];
    expect(stored.status).toEqual({ type: 'running' });
    expect(stored).toMatchObject({ quotedExitFeeSat: 8_000, exitFeeAddress: 'bcrt1qfee' });
    expect(result.current.continueError).toBeNull();
  });

  it('shows why that build failed, and stores nothing', async () => {
    saved.pendingCoins = [coin(3_000)];
    wallet.current = sdk({
      prepareRecoverFunds: async () => {
        throw new Error('operators unreachable');
      },
    });
    vi.mocked(readWalletMnemonic).mockResolvedValueOnce(MNEMONIC);
    const { result } = renderHook(() => useUnilateralExitFlow('regtest'));
    await act(() => result.current.build());

    expect(result.current.continueError).toBe('operators unreachable');
    expect(setUnilateralExitPlan).not.toHaveBeenCalled();
  });

  it('drops that error once the request goes, so a later request starts clean', async () => {
    saved.pendingCoins = [coin(3_000)];
    wallet.current = sdk({
      prepareRecoverFunds: async () => {
        throw new Error('operators unreachable');
      },
    });
    vi.mocked(readWalletMnemonic).mockResolvedValueOnce(MNEMONIC);
    const { result, rerender } = renderHook(() => useUnilateralExitFlow('regtest'));
    await act(() => result.current.build());
    expect(result.current.continueError).toBe('operators unreachable');

    saved.plan = waiting({ status: { type: 'running' } });
    rerender();
    saved.plan = waiting();
    rerender();
    expect(result.current.continueError).toBeNull();
  });

  it('builds nothing by itself on its fee screen, which waits for the tap', async () => {
    saved.pendingCoins = [coin(3_000)];
    const recoverFunds = vi.fn(async () => nextPart());
    const { result } = await quoted(askQuote, recoverFunds);
    act(() => result.current.goTo('fund'));
    expect(result.current.phase).toBe('fund');
    await act(async () => {});

    expect(readWalletMnemonic).not.toHaveBeenCalled();
    expect(recoverFunds).not.toHaveBeenCalled();
  });
});

describe('rebuilding an exit under way at a higher fee that needs more exit fee', () => {
  // Not the first index, so a key derived at the wrong one shows.
  const key = deriveFundingKey(MNEMONIC, 'regtest', 2);
  const stored = { type: 'p2wpkh' as const, txid: 'fund', vout: 0, valueSats: 6_000, pubkey: key.publicKeyHex };
  const higher = prepared({ funding: funding(9_000) });
  const short = new Error('Insufficient CPFP funding: need at least 9500 sats');

  const underWay = (over: Parameters<typeof plan>[1] = {}) =>
    plan([tx({ txid: 'stuck' })], {
      network: 'regtest',
      feeRateSatPerVbyte: 1,
      fundingAddressIndex: 2,
      exit: { fundingInputs: [stored] },
      ...over,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    saved.plan = underWay();
  });

  afterEach(() => addressUtxos.mockReset());

  /** Rebuilds at 2 sat/vB through the phrase, whose first build tries the exit's own funding and falls short. */
  async function fallsShort(recoverFunds = vi.fn<ExitSdk['recoverFunds']>(async () => Promise.reject(short))) {
    wallet.current = sdk({ prepareRecoverFunds: async () => higher, recoverFunds });
    const hook = renderHook(() => useUnilateralExitFlow('regtest'));
    act(() => hook.result.current.rebuild());
    await waitFor(() => expect(hook.result.current.fee.feeRates).not.toBeNull());
    await act(() => hook.result.current.submitFee());
    await act(() => hook.result.current.continueFromQuote());
    vi.mocked(readWalletMnemonic).mockResolvedValueOnce(MNEMONIC);
    await act(() => hook.result.current.unlock());
    await waitFor(() => expect(hook.result.current.buildError).toBe(short.message));
    return { ...hook, recoverFunds };
  }

  it('asks for the shortfall the build names, counting the funding the exit was built with', async () => {
    const { result } = await fallsShort();

    expect(result.current.phase).toBe('fund');
    expect(result.current.funding).toMatchObject({
      address: key.address,
      isFunded: false,
      topUp: { neededSat: 9_636, sentSat: 6_000, stillToSendSat: 3_636 },
    });
    expect(setUnilateralExitPlan).not.toHaveBeenCalled();
  });

  it("reviews only the exit fee the exit's own funding and its fee address leave to pay", async () => {
    addressUtxos.mockResolvedValue([coin(1_000)]);
    wallet.current = sdk({ prepareRecoverFunds: async () => higher });
    const { result } = renderHook(() => useUnilateralExitFlow('regtest'));
    act(() => result.current.rebuild());
    await waitFor(() => expect(result.current.fee.feeRates).not.toBeNull());
    await act(() => result.current.submitFee());

    // 9 000 at 2 sat/vB with a second coin to spend, less the 6 000 and 1 000 held.
    await waitFor(() => expect(result.current.exitFeeDueSat).toBe(2_272));
    expect(addressUtxos).toHaveBeenCalledWith(key.address);
    expect(readWalletMnemonic).not.toHaveBeenCalled();
  });

  it('counts a payment on its way, so it is not asked for twice, and waits for it to confirm', async () => {
    const { result } = await fallsShort();

    addressUtxos.mockResolvedValue([coin(3_636, false)]);
    act(() => result.current.goTo('topUp'));
    await waitFor(() => expect(result.current.funding?.topUp?.stillToSendSat).toBe(0));
    expect(result.current.funding).toMatchObject({ isFunded: false, waitsForConfirmation: true });
  });

  it('keeps what the fee address last held when a read fails, so a paid top-up never reads as unpaid', async () => {
    const before = await fallsShort();
    addressUtxos.mockResolvedValue([coin(3_636, false)]);
    act(() => before.result.current.goTo('topUp'));
    await waitFor(() => expect(before.result.current.funding?.topUp?.stillToSendSat).toBe(0));
    before.unmount();

    // The sheet opens again while the indexer is down.
    addressUtxos.mockRejectedValue(new Error('rate limited'));
    const { result } = await fallsShort();
    await waitFor(() => expect(result.current.funding?.topUp?.stillToSendSat).toBe(0));
    expect(result.current.funding?.waitsForConfirmation).toBe(true);
  });

  it("counts none of the exit's own change in the mempool as a payment", async () => {
    // The sweep spends the change a stuck step left at the fee address.
    saved.plan = plan(
      [tx({ txid: 'stuck' }), tx({ txid: 'sweep', kind: 'sweep', txHex: rawTx([`${txidOf(9)}:0`], [4_000]) })],
      { network: 'regtest', feeRateSatPerVbyte: 1, fundingAddressIndex: 2, exit: { fundingInputs: [stored] } },
    );
    const { result } = await fallsShort();

    addressUtxos.mockResolvedValue([coin(5_000, false, txidOf(9)), coin(1_000)]);
    act(() => result.current.goTo('topUp'));
    await waitFor(() => expect(result.current.funding?.topUp?.sentSat).toBe(7_000));
    expect(result.current.funding?.topUp?.stillToSendSat).toBe(2_772);
  });

  it("offers no rate at or below the exit's own, which the network would refuse as a replacement", async () => {
    saved.plan = underWay({ feeRateSatPerVbyte: 2 });
    wallet.current = sdk();
    const { result } = renderHook(() => useUnilateralExitFlow('regtest'));
    act(() => result.current.rebuild());
    // Today's rates are 1, 2 and 3, against an exit built at 2.
    await waitFor(() => expect(result.current.fee.feeRates).toEqual({ slow: 3, medium: 4, fast: 5 }));
  });

  it("gives the network's slowest rate, so a stall by fees reads as the network's doing", async () => {
    const { result } = await fallsShort();
    expect(result.current.funding?.networkFloorFeeRate).toBe(1);
  });

  it('gives no network floor while the exit waits on its update tap, which fees dropping would not continue', async () => {
    saved.plan = underWay({ status: { type: 'needsUpdate', why: 'signIn' } });
    const { result } = await fallsShort();
    expect(result.current.phase).toBe('fund');
    expect(result.current.funding?.networkFloorFeeRate).toBeNull();
  });

  it("builds from that funding and the coins sent since, signed with the fee key at the exit's index", async () => {
    const recoverFunds = vi
      .fn<ExitSdk['recoverFunds']>()
      .mockRejectedValueOnce(short)
      .mockResolvedValue(checked([{ txid: 'rebuilt' }]));
    const { result } = await fallsShort(recoverFunds);

    addressUtxos.mockResolvedValue([coin(4_000)]);
    act(() => result.current.goTo('topUp'));
    await waitFor(() => expect(result.current.funding?.isFunded).toBe(true));
    await act(() => result.current.build());

    const sent = { type: 'p2wpkh', txid: 'coin-4000', vout: 0, valueSats: 4_000, pubkey: key.publicKeyHex };
    expect(recoverFunds.mock.calls.map(([request]) => request.fundingInputs)).toEqual([[stored], [stored, sent]]);
    expect(vi.mocked(singleKeyCpfpSigner).mock.calls).toEqual([[key.secretKey], [key.secretKey]]);
    expect(recoverFunds.mock.lastCall?.[1]).toBe(vi.mocked(singleKeyCpfpSigner).mock.results[1].value);
    expect(setUnilateralExitPlan).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('tracker');
  });

  it('adds the top-up sent for the higher fee to what the exit fee address was paid', async () => {
    saved.plan = underWay({ quotedExitFeeSat: 6_000, exitFeeAddress: key.address });
    const recoverFunds = vi
      .fn<ExitSdk['recoverFunds']>()
      .mockRejectedValueOnce(short)
      .mockResolvedValue(checked([{ txid: 'rebuilt' }]));
    const { result } = await fallsShort(recoverFunds);

    addressUtxos.mockResolvedValue([coin(4_000)]);
    act(() => result.current.goTo('topUp'));
    await waitFor(() => expect(result.current.funding?.isFunded).toBe(true));
    await act(() => result.current.build());

    // Not the 9 000 the higher fee was quoted at.
    expect(vi.mocked(setUnilateralExitPlan).mock.calls[0][1]).toMatchObject({ quotedExitFeeSat: 10_000, exitFeeAddress: key.address });
  });
});

describe('starting a unilateral exit beside a recovery that needs an exit fee', () => {
  // Not the first index, so a key derived at the wrong one shows.
  const key = deriveFundingKey(MNEMONIC, 'regtest', 2);
  const stored = { type: 'p2wpkh' as const, txid: 'fund', vout: 0, valueSats: 6_000, pubkey: key.publicKeyHex };
  const balance: RecoverFundsLeaf = { leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' };
  const stranded: RecoverFundsLeaf = { leafId: 's-1', valueSats: 40_000, method: 'unilateral' };
  const short = new Error('Insufficient CPFP funding: need at least 9500 sats');
  const landedCosigned = { leafIds: ['c-1'], valueSat: 30_000, txid: 'coop', paidSat: 29_000, blockHeight: 90 };

  // At 2 sat/vB: its co-signed leaf landed, and its stranded leaf is on its way.
  const recovery = () =>
    plan([tx({ txid: 'stuck' })], {
      network: 'regtest',
      mode: 'recover',
      destination: 'bcrt1qrecovery',
      fundingAddressIndex: 2,
      quotedExitFeeSat: 3_000,
      exitFeeAddress: key.address,
      namedLeaves: [{ leafId: 's-1', valueSats: 40_000 }],
      recoverableLeafIds: ['c-1'],
      landed: [landedCosigned],
      exit: { leaves: [stranded], fundingInputs: [stored] },
    });

  /** Quotes `fresh` for the whole wallet and `named` by name, at the rate and address asked. */
  const quotes = (fresh: RecoverFundsLeaf[], named: Partial<PrepareRecoverFundsResponse> = {}) =>
    vi.fn<ExitSdk['prepareRecoverFunds']>(async ({ selection, feeRateSatPerVbyte, destination }) => {
      const at = { feeRateSatPerVbyte, destination, funding: funding(9_000) };
      if (selection.type !== 'specific') return prepared({ ...at, leaves: fresh });
      return prepared({ ...at, leaves: [balance, stranded], recoverableValueSats: 140_000, ...named });
    });

  /** Opens Start Unilateral Exit and takes it to a quote to `bcrt1qexit` at the medium rate. */
  async function quotedExit(prepareRecoverFunds: Mock<ExitSdk['prepareRecoverFunds']>, recoverFunds = vi.fn<ExitSdk['recoverFunds']>()) {
    wallet.current = sdk({ prepareRecoverFunds, recoverFunds });
    const hook = renderHook(() => useUnilateralExitFlow('regtest', 'exit'));
    expect(hook.result.current).toMatchObject({ phase: 'intro', mode: 'exit', engine: { plan: null, pending: null } });
    act(() => hook.result.current.destination.onChange('bcrt1qexit'));
    act(() => hook.result.current.goTo('fee'));
    await waitFor(() => expect(hook.result.current.fee.feeRates).not.toBeNull());
    await act(() => hook.result.current.submitFee());
    return hook;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    saved.plan = null;
    saved.pending = null;
    saved.recoveries = [];
  });

  afterEach(() => addressUtxos.mockReset());

  it('builds one plan over a running recovery that names both leaf sets, merges the funding, floors the rate and keeps the ledger', async () => {
    saved.plan = recovery();
    const prepareRecoverFunds = quotes([balance]);
    const recoverFunds = vi
      .fn<ExitSdk['recoverFunds']>()
      .mockRejectedValueOnce(short)
      .mockResolvedValue(checked([{ txid: 'rebuilt' }], { leaves: [balance, stranded], destination: 'bcrt1qexit' }));
    const { result, rerender } = await quotedExit(prepareRecoverFunds, recoverFunds);

    // Today's rates are 1, 2 and 3, against a recovery built at 2.
    expect(result.current.fee.feeRates).toEqual({ slow: 3, medium: 4, fast: 5 });
    // The fresh quote missed the stranded leaf part-way out, so both are named.
    expect(prepareRecoverFunds.mock.calls.map(([request]) => request.selection)).toEqual([
      { type: 'all' },
      { type: 'specific', leafIds: ['leaf-1', 's-1'] },
    ]);

    await act(() => result.current.continueFromQuote());
    vi.mocked(readWalletMnemonic).mockResolvedValueOnce(MNEMONIC);
    await act(() => result.current.unlock());
    await waitFor(() => expect(result.current.buildError).toBe(short.message));
    addressUtxos.mockResolvedValue([coin(4_000)]);
    act(() => result.current.goTo('topUp'));
    await waitFor(() => expect(result.current.funding?.isFunded).toBe(true));
    await act(() => result.current.build());

    const sent = { type: 'p2wpkh', txid: 'coin-4000', vout: 0, valueSats: 4_000, pubkey: key.publicKeyHex };
    expect(recoverFunds.mock.lastCall?.[0].fundingInputs).toEqual([stored, sent]);
    expect(setUnilateralExitPlan).toHaveBeenCalledTimes(1);
    const built = vi.mocked(setUnilateralExitPlan).mock.calls[0][1];
    expect(built).toMatchObject({
      mode: 'exit',
      destination: 'bcrt1qexit',
      feeRateSatPerVbyte: 4,
      fundingAddressIndex: 2,
      // What the recovery was paid, and what was sent for the exit.
      quotedExitFeeSat: 7_000,
      exitFeeAddress: key.address,
      landed: [landedCosigned],
    });
    expect(built.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['s-1', 'leaf-1']);
    expect(built.recoverableLeafIds).toEqual(['c-1', 's-1']);
    // The engine hands the sheet the exit in place of the recovery.
    saved.plan = built;
    rerender();
    expect(result.current).toMatchObject({ phase: 'tracker', mode: 'exit', engine: { plan: built } });
  });

  it('replaces a pending recovery with the exit, paid at the same fee address', async () => {
    saved.pending = pendingExit({ mode: 'recover', destination: 'bcrt1qrecovery' });
    const prepareRecoverFunds = quotes([balance]);
    const { result } = await quotedExit(prepareRecoverFunds);

    // Nothing of the recovery is on the network to replace.
    expect(result.current.fee.feeRates).toEqual({ slow: 1, medium: 2, fast: 3 });
    expect(prepareRecoverFunds.mock.calls.map(([request]) => request.selection)).toEqual([{ type: 'all' }]);
    await act(() => result.current.continueFromQuote());
    vi.mocked(readWalletMnemonic).mockResolvedValueOnce(MNEMONIC);
    await act(() => result.current.unlock());

    expect(setPendingExit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mode: 'exit',
        destination: 'bcrt1qexit',
        fundingAddressIndex: 0,
        fundingAddress: deriveFundingKey(MNEMONIC, 'regtest', 0).address,
        required: { sat: 9_000, inputs: 1 },
      }),
      expect.anything(),
    );
  });

  it('leaves a kept co-signed recovery to itself', async () => {
    saved.plan = recovery();
    const kept: RecoverFundsLeaf = { leafId: 'c-2', valueSats: 18_200, method: 'cooperative' };
    saved.recoveries = [plan([tx({ txid: 'k2', kind: 'cooperative', nodeId: 'c-2' })], { mode: 'recover', exit: { leaves: [kept] } })];
    const prepareRecoverFunds = quotes([balance, stranded, kept], { funding: undefined });
    const { result } = await quotedExit(prepareRecoverFunds, vi.fn(async () => checked([{ txid: 'rebuilt' }], { leaves: [balance, stranded] })));

    expect(prepareRecoverFunds.mock.lastCall?.[0].selection).toEqual({ type: 'specific', leafIds: ['leaf-1', 's-1'] });
    await act(() => result.current.continueFromQuote());

    await waitFor(() => expect(setUnilateralExitPlan).toHaveBeenCalled());
    const built = vi.mocked(setUnilateralExitPlan).mock.calls[0][1];
    expect(built.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['s-1', 'leaf-1']);
    expect(built.recoverableLeafIds).not.toContain('c-2');
    expect(keepRecovery).not.toHaveBeenCalled();
  });
});

describe('raising the fee of a kept co-signed recovery', () => {
  // Sent at 1 sat/vB, below what the network now takes.
  const kept = (txid = 'c1') =>
    plan(
      [
        tx({ txid, kind: 'cooperative', nodeId: 'c-1', status: { type: 'unverified' } }),
        tx({ txid: `${txid}-2`, kind: 'cooperative', nodeId: 'c-2', status: { type: 'unverified' } }),
      ],
      {
        network: 'regtest',
        mode: 'recover',
        destination: 'bcrt1qmine',
        feeRateSatPerVbyte: 1,
        exit: { leaves: cosignedLeaves, recoverableValueSats: 48_200 },
      },
    );
  const bumpQuote = prepared({
    leaves: cosignedLeaves,
    recoverableValueSats: 48_200,
    sweepFeeSats: 0,
    cpfpFeeSats: 0,
    cooperativeFeeSats: 1_000,
    totalFeeSats: 1_000,
    funding: undefined,
    feeRateSatPerVbyte: 2,
    destination: 'bcrt1qmine',
  });
  const bumpBuild = (over: Partial<RecoverFundsResponse> = {}) =>
    cosignedBuild({
      transactions: checked([
        { txid: 'c1-bumped', kind: 'cooperative', nodeId: 'c-1' },
        { txid: 'c2-bumped', kind: 'cooperative', nodeId: 'c-2' },
      ]).transactions,
      cooperativeFeeSats: 1_000,
      feeRateSatPerVbyte: 2,
      destination: 'bcrt1qmine',
      ...over,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    saved.plan = null;
    saved.archive = [];
    saved.recoveries = [kept()];
  });

  afterEach(() => {
    saved.recoveries = [];
  });

  /** Opens the flow on the bump of `bumpTxid`, once its rates load. */
  async function bumping(
    bumpTxid = 'c1',
    recoverFunds = vi.fn<ExitSdk['recoverFunds']>(async () => bumpBuild()),
    prepareRecoverFunds = vi.fn<ExitSdk['prepareRecoverFunds']>(async () => bumpQuote),
  ) {
    wallet.current = sdk({ prepareRecoverFunds, recoverFunds });
    const hook = renderHook(() => useUnilateralExitFlow('regtest', undefined, bumpTxid));
    await waitFor(() => expect(hook.result.current.fee.feeRates).not.toBeNull());
    return { ...hook, prepareRecoverFunds, recoverFunds };
  }

  it('notes nothing dropped from a bump quote, which only rebuilds what the recovery holds', async () => {
    const skipped = [{ leafId: 'd-1', valueSats: 5_000, reason: { type: 'notRecoverable' as const, message: 'gone' } }];
    const { result } = await bumping('c1', undefined, vi.fn(async () => ({ ...bumpQuote, skipped })));
    await act(() => result.current.submitFee());
    expect(result.current.quote.figures).not.toBeNull();
    expect(noteDropped).not.toHaveBeenCalled();
  });

  it('opens on the fee as a recovery, with nothing to go back to', async () => {
    const { result } = await bumping();
    expect(result.current.phase).toBe('fee');
    expect(result.current.mode).toBe('recover');
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.bumping).toBe(true);
    expect(result.current.bumpedTxid).toBe('c1');
  });

  it("offers no rate at or below the recovery's own, and no two that read the same", async () => {
    const { result } = await bumping();
    // Today's rates are 1, 2 and 3, against a recovery sent at 1.
    expect(result.current.fee.feeRates).toEqual({ slow: 2, medium: 3, fast: 4 });
  });

  it("quotes the recovery's own leaves to its own address beside an exit under way, with the quote's own fee", async () => {
    saved.plan = plan([], { quotedSweepFeeSat: 9_999 });
    const { result, prepareRecoverFunds } = await bumping();
    await act(() => result.current.submitFee());

    expect(prepareRecoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        feeRateSatPerVbyte: 3,
        destination: 'bcrt1qmine',
        selection: { type: 'specific', leafIds: ['c-1', 'c-2'] },
      }),
    );
    expect(result.current.quote.figures?.networkFeeSat).toBe(1_000);
  });

  it('keeps the rebuilt recovery in place of the old one, and touches nothing of the exit', async () => {
    saved.plan = plan([], { quotedSweepFeeSat: 9_999 });
    const { result, recoverFunds } = await bumping();
    await act(() => result.current.submitFee());
    await act(() => result.current.continueFromQuote());

    expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: bumpQuote }]);
    const next = vi.mocked(keepRecovery).mock.calls[0][1];
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['c1-bumped', 'c2-bumped']);
    expect(next).toMatchObject({ mode: 'recover', feeRateSatPerVbyte: 2, destination: 'bcrt1qmine' });
    expect(setUnilateralExitPlan).not.toHaveBeenCalled();
    expect(setPendingExit).not.toHaveBeenCalled();
    expect(readWalletMnemonic).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('sent');
    expect(result.current.sentSat).toBe(47_200);
  });

  it('keeps to its own recovery beside an exit waiting on more exit fee', async () => {
    saved.plan = plan([tx({ txid: 's', kind: 'sweep', status: confirmed(9) })], {
      exitFeeAddress: 'bcrt1qfee',
      status: { type: 'needsExitFee', topUp: { required: { sat: 3_000, inputs: 1 } } },
      namedLeaves: [
        { leafId: 'leaf-1', valueSats: 100_000 },
        { leafId: 'leaf-2', valueSats: 50_000 },
      ],
    });
    const { result } = await bumping();
    expect(result.current.phase).toBe('fee');
    await act(() => result.current.submitFee());
    await act(() => result.current.continueFromQuote());

    expect(keepRecovery).toHaveBeenCalled();
    expect(setUnilateralExitPlan).not.toHaveBeenCalled();
    expect(readWalletMnemonic).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('sent');
  });

  it('asks to try again, keeping nothing, when the operators co-signed only part of it', async () => {
    const partial = bumpBuild({
      leaves: [cosignedLeaves[0]],
      transactions: [checked([{ txid: 'c1-bumped', kind: 'cooperative', nodeId: 'c-1' }]).transactions[0]],
      failed: [
        {
          leafId: 'c-2',
          outputTxid: 'o',
          outputVout: 0,
          error: { type: 'replacementFeeTooLow', requiredFeeSats: 600, requiredFeeRateSatPerVbyte: 3 },
        },
      ],
    });
    const { result } = await bumping('c1', vi.fn(async () => partial));
    await act(() => result.current.submitFee());
    await act(() => result.current.continueFromQuote());

    expect(result.current.phase).toBe('quote');
    expect(result.current.startError).toBe('Please try again or choose a different fee.');
    expect(keepRecovery).not.toHaveBeenCalled();
  });

  it('follows the recovery to the transaction a retry swapped in, and still bumps what the sheet opened on', async () => {
    const { result, rerender, prepareRecoverFunds } = await bumping();
    saved.recoveries = [kept('c1-retried')];
    rerender();
    expect(result.current.bumpedTxid).toBe('c1-retried');

    await act(() => result.current.submitFee());
    expect(prepareRecoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'bcrt1qmine', selection: { type: 'specific', leafIds: ['c-1', 'c-2'] } }),
    );
    await act(() => result.current.continueFromQuote());
    expect(keepRecovery).toHaveBeenCalled();
    expect(setUnilateralExitPlan).not.toHaveBeenCalled();
  });

  it('quotes nothing when the recovery was gone before the sheet opened', async () => {
    const { result, prepareRecoverFunds } = await bumping('gone');
    expect(result.current.bumpedTxid).toBeNull();
    await act(() => result.current.submitFee());
    expect(prepareRecoverFunds).not.toHaveBeenCalled();
    expect(result.current.mode).toBe('recover');
  });
});
