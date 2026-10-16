import {
  cancelPendingExit,
  keepRecovery,
  noteDropped,
  noteStopped,
  setPendingExit,
  setUnilateralExitPlan,
  startPendingExit,
  startUnilateralExitEngine,
  stopUnilateralExitEngine,
} from './api';
import { advanceNow } from './polling';
import { excludedLeafIds, getUnilateralExitState, startDeadEnded } from './state';
import { asKeptRecovery, type UnilateralExitPlan } from '../model/plan';
import { loadAccounting } from '../storage/accounting';
import { loadArchive } from '../storage/archive';
import { loadPendingExit } from '../storage/pending';
import { loadPlan } from '../storage/plan';
import { loadRecoveries, saveRecoveries } from '../storage/recoveries';
import { deriveFundingKey } from '../funding';
import { checked, coin, confirmed, MNEMONIC, pendingExit, plan, prepared, rawTx, ready, sdk, tx, txidOf } from '../testFixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainClient, ChainUtxo } from '@/services/chain';

const wallet = { identityPubkey: 'pubkey', network: 'regtest' };

const chain: ChainClient = {
  feeRates: async () => ({ slow: 1, medium: 1, fast: 1 }),
  addressUtxos: async () => [],
  tipHeight: async () => 100,
  broadcast: async () => undefined,
  broadcastPackage: async () => undefined,
  confirmedSpender: async () => null,
};

/** A refund and the sweep that paid it out: 99 000 sats to the destination. */
const swept = (status = confirmed(1)) => [
  tx({ txid: txidOf(1), kind: 'refund', nodeId: 'leaf-1', status }),
  tx({ txid: 's', kind: 'sweep', txHex: rawTx([`${txidOf(1)}:0`], [99_000]), dependsOn: [txidOf(1)], status }),
];

const done = plan(swept(), { network: 'regtest', status: { type: 'done' } });

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

/** A kept co-signed recovery of c-1 that pays 29 000 once it lands. */
const landing = () =>
  plan([tx({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', txHex: rawTx([`${txidOf(7)}:0`], [29_000]), status: ready })], {
    network: 'regtest',
    mode: 'recover',
    exit: { leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }] },
  });

// The SDK confirms a co-signed recovery once anything spends its output.
const confirming = (syncWallet = vi.fn(async () => ({}))) =>
  sdk({
    checkRecoverFunds: async ({ recovery }) => ({
      recovery: { ...recovery, transactions: recovery.transactions.map(t => ({ ...t, status: confirmed(12) })) },
      verdict: { type: 'done' },
    }),
    syncWallet,
  });

const spending = (txid: string, outputs: { address?: string; value: number }[]): ChainClient => ({
  ...chain,
  confirmedSpender: async () => ({ txid, blockHeight: 12, outputs }),
});

/** Runs `body` while the accounting cannot be saved, as when storage is full. */
async function withAccountingUnsaved(body: () => Promise<void>): Promise<void> {
  const setItem = vi.mocked(localStorage.setItem);
  const store = setItem.getMockImplementation();
  setItem.mockImplementation((key, value) => {
    if (key.startsWith('unilateral-exit-accounting:')) throw new DOMException('quota', 'QuotaExceededError');
    store?.(key, value);
  });
  try {
    await body();
  } finally {
    if (store) setItem.mockImplementation(store);
  }
}

beforeEach(() => {
  localStorage.clear();
  stopUnilateralExitEngine();
});

afterEach(() => {
  stopUnilateralExitEngine();
});

describe('the plan the engine holds', () => {
  it('stores a plan even when it is not running for that wallet, for when it does', () => {
    setUnilateralExitPlan(wallet, done);
    expect(getUnilateralExitState().plan).toBeNull();
    startUnilateralExitEngine(wallet, chain);
    expect(getUnilateralExitState().plan?.status).toEqual({ type: 'done' });
  });
});

describe('a pass that outlives its plan', () => {
  // A chain whose tip reads wait until released, so a pass can be held open.
  const held = () => {
    const pending: Array<(height: number) => void> = [];
    const client: ChainClient = { ...chain, tipHeight: () => new Promise(resolve => pending.push(resolve)) };
    return { client, pending };
  };
  const firstTxid = () => loadPlan(wallet)?.exit.transactions[0]?.txid;

  it('does not write over a plan rebuilt while it was out', async () => {
    const { client, pending } = held();
    setUnilateralExitPlan(wallet, plan([tx({ txid: 'old' })], { network: 'regtest' }));
    startUnilateralExitEngine(wallet, client);
    setUnilateralExitPlan(wallet, plan([tx({ txid: 'new' })], { network: 'regtest' }));

    pending[0](101);
    await settle();
    expect(firstTxid()).toBe('new');
    expect(getUnilateralExitState().plan?.exit.transactions[0].txid).toBe('new');

    // The rebuilt plan got a pass of its own, which does write.
    pending[1](102);
    await settle();
    expect(getUnilateralExitState().tipHeight).toBe(102);
    expect(firstTxid()).toBe('new');
  });

  it("does not write one wallet's plan under another started while it was out", async () => {
    const { client, pending } = held();
    const other = { identityPubkey: 'other', network: 'regtest' };
    setUnilateralExitPlan(wallet, plan([tx({ txid: 'old' })], { network: 'regtest' }));
    startUnilateralExitEngine(wallet, client);
    stopUnilateralExitEngine();
    startUnilateralExitEngine(other, chain);

    pending[0](101);
    await settle();
    expect(loadPlan(other)).toBeNull();
    expect(getUnilateralExitState().plan).toBeNull();
  });
});

describe('an exit waiting on its fee', () => {
  const holding = (coins: ChainUtxo[]): ChainClient => ({ ...chain, addressUtxos: async () => coins });
  const building = () => {
    const recoverFunds = vi.fn(async () => checked([{ txid: 'fan', kind: 'fanOut' }]));
    return { recoverFunds, driver: sdk({ prepareRecoverFunds: async () => prepared(), recoverFunds }) };
  };

  beforeEach(() => localStorage.setItem('walletMnemonic', MNEMONIC));

  it('does not start when its fee confirms, only when the user taps', async () => {
    const { recoverFunds, driver } = building();
    startUnilateralExitEngine(wallet, holding([coin(5_898)]), driver);
    setPendingExit(wallet, pendingExit());

    await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));
    await advanceNow();
    expect(recoverFunds).not.toHaveBeenCalled();

    await startPendingExit();
    expect(getUnilateralExitState().plan?.exit.transactions[0].txid).toBe('fan');
    expect(getUnilateralExitState().pending).toBeNull();
    expect(loadPendingExit(wallet)).toBeNull();
  });

  it('ignores a tap before the fee has confirmed', async () => {
    const { recoverFunds, driver } = building();
    startUnilateralExitEngine(wallet, holding([coin(5_898, false)]), driver);
    setPendingExit(wallet, pendingExit());

    await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));
    await startPendingExit();
    expect(recoverFunds).not.toHaveBeenCalled();
  });

  it.each([
    ['asks for what the build says it still needs', 'Insufficient CPFP funding: need at least 6400 sats', { sat: 6_400, inputs: 1 }, null],
    ['keeps why a start failed, so the user can try again', 'chain service unreachable', { sat: 5_898, inputs: 1 }, 'chain service unreachable'],
  ])('%s', async (_, failure, required, startError) => {
    const recoverFunds = vi.fn(async () => {
      throw new Error(failure);
    });
    startUnilateralExitEngine(wallet, holding([coin(5_898)]), sdk({ prepareRecoverFunds: async () => prepared(), recoverFunds }));
    setPendingExit(wallet, pendingExit());

    await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));
    await startPendingExit();
    expect(loadPendingExit(wallet)?.required).toEqual(required);
    expect(getUnilateralExitState()).toMatchObject({ pending: { required }, startError, isStarting: false });
  });

  describe('when the watchtower took the leaf after the save', () => {
    const stopped = prepared({
      leaves: [],
      recoverableValueSats: 0,
      funding: undefined,
      skipped: [{ leafId: 's-1', valueSats: 150_000, reason: { type: 'notRecoverable', message: 'stopped' } }],
      exitChainState: { ...prepared().exitChainState, stoppedLeafIds: ['s-1'] },
    });

    it('waits six blocks from the first start that sees it, then says it cannot be recovered', async () => {
      let tip = 100;
      startUnilateralExitEngine(wallet, { ...holding([coin(5_898)]), tipHeight: async () => tip }, sdk({ prepareRecoverFunds: async () => stopped }));
      setPendingExit(wallet, pendingExit({ mode: 'recover' }));
      await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));

      await startPendingExit();
      expect(getUnilateralExitState().nothingToExit).toEqual({ reason: 'unavailable' });
      expect(loadAccounting(wallet).stoppedSince).toEqual({ 's-1': 100 });

      tip = 106;
      await startPendingExit();
      expect(getUnilateralExitState().nothingToExit).toEqual({ reason: 'notRecoverable' });
      expect(startDeadEnded(getUnilateralExitState())).toBe(true);
    });

    it('keeps the start open while the tip cannot be read to date it', async () => {
      const tipHeight = async (): Promise<number> => {
        throw new Error('chain service unavailable');
      };
      startUnilateralExitEngine(wallet, { ...holding([coin(5_898)]), tipHeight }, sdk({ prepareRecoverFunds: async () => stopped }));
      noteStopped(wallet, stopped, 50);
      setPendingExit(wallet, pendingExit({ mode: 'recover' }));
      await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));

      await startPendingExit();
      expect(getUnilateralExitState().nothingToExit).toEqual({ reason: 'unavailable' });
    });
  });

  it('starts with the key the wizard derived, without a second sign-in', async () => {
    localStorage.removeItem('walletMnemonic');
    localStorage.setItem('passkeyLabel', 'Default');
    const key = deriveFundingKey(MNEMONIC, 'regtest', 0);
    const { driver } = building();
    startUnilateralExitEngine(wallet, holding([coin(5_898)]), driver);
    setPendingExit(wallet, pendingExit({ fundingAddress: key.address }), key);

    await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));
    await startPendingExit();
    expect(getUnilateralExitState().plan).not.toBeNull();
  });

  it('keeps what the fee address last held through a restart and a failed read, so a paid exit never reads as unpaid', async () => {
    let reads = 0;
    const flaky: ChainClient = {
      ...chain,
      addressUtxos: async () => {
        reads += 1;
        if (reads > 1) throw new Error('rate limited');
        return [coin(5_898)];
      },
    };
    startUnilateralExitEngine(wallet, flaky, sdk());
    setPendingExit(wallet, pendingExit({ fundingAddress: 'bcrt1qflaky' }));
    await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));

    stopUnilateralExitEngine();
    startUnilateralExitEngine(wallet, flaky, sdk());
    expect(getUnilateralExitState().pendingCoins).toEqual([coin(5_898)]);
    await advanceNow();
    expect(reads).toBeGreaterThan(1);
    expect(getUnilateralExitState().pendingCoins).toEqual([coin(5_898)]);
  });

  it('shows a payment for an exit after a reload whose read of the fee address fails', async () => {
    startUnilateralExitEngine(wallet, holding([coin(5_898, false)]), sdk());
    setPendingExit(wallet, pendingExit({ fundingAddress: 'bcrt1qreload' }));
    await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));
    await vi.waitFor(() => expect(getUnilateralExitState().isAdvancing).toBe(false));
    stopUnilateralExitEngine();

    // Nothing read before the reload is left in memory, and the indexer is down.
    vi.resetModules();
    const reloaded = await import('./api');
    const { advanceNow: advanceReloaded } = await import('./polling');
    const { getUnilateralExitState: reloadedState } = await import('./state');
    const addressUtxos = vi.fn(async (): Promise<ChainUtxo[]> => {
      throw new Error('rate limited');
    });
    reloaded.startUnilateralExitEngine(wallet, { ...chain, addressUtxos }, sdk());
    try {
      expect(reloadedState().pendingCoins).toEqual([coin(5_898, false)]);
      await advanceReloaded();
      await vi.waitFor(() => expect(reloadedState().isAdvancing).toBe(false));
      expect(addressUtxos).toHaveBeenCalledWith('bcrt1qreload');
      expect(reloadedState().pendingCoins).toEqual([coin(5_898, false)]);
    } finally {
      reloaded.stopUnilateralExitEngine();
    }
  });

  it('survives a reload, and forgets the exit once cancelled', () => {
    setPendingExit(wallet, pendingExit());
    startUnilateralExitEngine(wallet, chain);
    expect(getUnilateralExitState().pending).toEqual(pendingExit());

    cancelPendingExit();
    expect(getUnilateralExitState().pending).toBeNull();
    expect(loadPendingExit(wallet)).toBeNull();
  });
});

describe('kept co-signed recoveries', () => {
  const cosigned = (txid: string, leafId = 'c-1', over: Partial<UnilateralExitPlan> = {}) =>
    plan([tx({ txid, kind: 'cooperative', nodeId: leafId, txHex: `hex-${txid}`, status: ready })], {
      network: 'regtest',
      mode: 'recover',
      ...over,
      exit: { leaves: [{ leafId, valueSats: 30_000, method: 'cooperative' }] },
    });

  it('are sent on their own, with no exit to drive', async () => {
    const broadcast = vi.fn(async () => undefined);
    saveRecoveries(wallet, [cosigned('c1')]);
    startUnilateralExitEngine(wallet, { ...chain, broadcast }, sdk());
    await vi.waitFor(() => expect(broadcast).toHaveBeenCalledWith('hex-c1'));
    expect(getUnilateralExitState().recoveries).toHaveLength(1);
  });

  it('are archived once done, with getInfo read again first and no sync', async () => {
    const syncWallet = vi.fn(async () => ({}));
    const refresh = vi.fn(async () => true);
    saveRecoveries(wallet, [landing()]);
    startUnilateralExitEngine(wallet, spending('c1', [{ address: 'bc1qdest', value: 29_000 }]), confirming(syncWallet), refresh);

    await vi.waitFor(() => expect(getUnilateralExitState().recoveries).toEqual([]));
    expect(loadRecoveries(wallet)).toEqual([]);
    expect(loadArchive(wallet)).toEqual([expect.objectContaining({ id: 'c1', mode: 'recover', deliveredSat: 29_000 })]);
    expect(getUnilateralExitState().archive).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(syncWallet).not.toHaveBeenCalled();
  });

  it('stay followed while the spender of a done one cannot be read', async () => {
    saveRecoveries(wallet, [landing()]);
    const failing: ChainClient = {
      ...chain,
      confirmedSpender: async () => {
        throw new Error('rate limited');
      },
    };
    startUnilateralExitEngine(wallet, failing, confirming());

    await vi.waitFor(() => expect(getUnilateralExitState().recoveries[0]?.status).toEqual({ type: 'done' }));
    expect(loadArchive(wallet)).toEqual([]);
    expect(loadRecoveries(wallet)).toHaveLength(1);
  });

  it.each([
    ['another recovery beside it', cosigned('c2', 'c-2'), ['c1', 'c2']],
    ['the same recovery kept again in place of itself', cosigned('c1', 'c-1', { quotedSweepFeeSat: 999 }), ['c1']],
    ['a fee bump in place of the recovery it bumps', cosigned('c1-bumped'), ['c1-bumped']],
  ])('keeps %s while a pass is out', async (_, kept, txids) => {
    let release: (height: number) => void = () => {};
    const slow: ChainClient = { ...chain, tipHeight: () => new Promise(resolve => (release = resolve)) };
    saveRecoveries(wallet, [cosigned('c1')]);
    startUnilateralExitEngine(wallet, slow, sdk());

    keepRecovery(wallet, kept);
    release(101);
    await settle();
    const { recoveries } = getUnilateralExitState();
    expect(recoveries.map(r => r.exit.transactions[0].txid)).toEqual(txids);
    expect(recoveries[recoveries.length - 1]).toEqual(asKeptRecovery(kept));
    expect(loadRecoveries(wallet).map(r => r.exit.transactions[0].txid)).toEqual(txids);
  });

  describe('raised to a higher fee', () => {
    it('archives what landed once when the recovery it bumped confirms during a pass', async () => {
      let release: (height: number) => void = () => {};
      const tipHeight = vi
        .fn<ChainClient['tipHeight']>()
        .mockImplementationOnce(() => new Promise(resolve => (release = resolve)))
        .mockResolvedValue(101);
      const bumped = plan(
        [tx({ txid: 'c1-bumped', kind: 'cooperative', nodeId: 'c-1', txHex: rawTx([`${txidOf(7)}:0`], [28_000]), status: ready })],
        { network: 'regtest', mode: 'recover', exit: { leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }] } },
      );
      saveRecoveries(wallet, [landing()]);
      startUnilateralExitEngine(wallet, { ...spending('c1', [{ address: 'bc1qdest', value: 29_000 }]), tipHeight }, confirming());

      keepRecovery(wallet, bumped);
      release(101);
      await settle();
      expect(loadArchive(wallet)).toEqual([]);

      // The bump reads as done once anything spends its input, and names the original as what paid.
      await advanceNow();
      await vi.waitFor(() => expect(getUnilateralExitState().recoveries).toEqual([]));
      expect(loadArchive(wallet)).toEqual([expect.objectContaining({ id: 'c1-bumped', txids: ['c1'], deliveredSat: 29_000 })]);
    });
  });

  describe('stuck unverified', () => {
    // Due a retry on the first pass, at tip 100, unless `over` says otherwise.
    const stuck = (over: Partial<UnilateralExitPlan> = {}) =>
      plan([tx({ txid: 'c-old', kind: 'cooperative', nodeId: 'c-1', txHex: 'hex-c-old', status: { type: 'unverified' } })], {
        network: 'regtest',
        mode: 'recover',
        retrySince: 90,
        ...over,
        exit: { leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }] },
      });
    const quoting = (over: Parameters<typeof prepared>[0]) => async () =>
      prepared({ leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }], funding: undefined, ...over });

    it('drops a kept recovery whose only leaf a quote finds unrecoverable, with no archive record', async () => {
      const skipped = [{ leafId: 'c-1', valueSats: 30_000, reason: { type: 'notRecoverable' as const, message: 'paid elsewhere' } }];
      saveRecoveries(wallet, [stuck()]);
      startUnilateralExitEngine(wallet, chain, sdk({ prepareRecoverFunds: quoting({ leaves: [], skipped }) }));

      await vi.waitFor(() => expect(getUnilateralExitState().recoveries).toEqual([]));
      expect(loadRecoveries(wallet)).toEqual([]);
      expect(loadArchive(wallet)).toEqual([]);
      // Kept hidden still, since getInfo goes on counting it.
      expect(loadAccounting(wallet).droppedLeaves).toEqual([{ leafId: 'c-1', valueSats: 30_000 }]);
      expect(getUnilateralExitState().accounting.droppedLeaves).toEqual([{ leafId: 'c-1', valueSats: 30_000 }]);
    });

    it('keeps a finished recovery until what it accounted for is stored, then retires it', async () => {
      const skipped = [{ leafId: 'c-1', valueSats: 30_000, reason: { type: 'notRecoverable' as const, message: 'paid elsewhere' } }];
      saveRecoveries(wallet, [stuck()]);
      await withAccountingUnsaved(async () => {
        startUnilateralExitEngine(wallet, chain, sdk({ prepareRecoverFunds: quoting({ leaves: [], skipped }) }));
        await vi.waitFor(() => expect(getUnilateralExitState().recoveries[0]?.status).toEqual({ type: 'done' }));
        expect(loadRecoveries(wallet)).toHaveLength(1);
      });

      await advanceNow();
      expect(getUnilateralExitState().recoveries).toEqual([]);
      expect(loadRecoveries(wallet)).toEqual([]);
      expect(loadAccounting(wallet).droppedLeaves).toEqual([{ leafId: 'c-1', valueSats: 30_000 }]);
    });

    it.each([
      ['a kept recovery that can move', () => keepRecovery(wallet, cosigned('c2', 'c-2'))],
      ['an exit with a step to send', () => setUnilateralExitPlan(wallet, plan([tx({ txid: 'r', kind: 'refund', status: ready })], { network: 'regtest' }))],
      ['an exit waiting on its fee', () => setPendingExit(wallet, pendingExit())],
    ])('are polled about once a block, and at the usual pace again beside %s', async (_, open) => {
      const setInterval = vi.spyOn(globalThis, 'setInterval');
      const lastInterval = () => setInterval.mock.lastCall?.[1];
      try {
        saveRecoveries(wallet, [stuck({ retrySince: undefined })]);
        startUnilateralExitEngine(wallet, chain, sdk());
        await settle();
        expect(getUnilateralExitState().recoveries[0].retrySince).toBe(100);
        expect(lastInterval()).toBe(100_000);

        open();
        await settle();
        expect(lastInterval()).toBe(5_000);
      } finally {
        setInterval.mockRestore();
      }
    });
  });
});

describe('a fresh quote beside kept recoveries and finished exits', () => {
  beforeEach(() => localStorage.setItem('walletMnemonic', MNEMONIC));

  const kept = plan([tx({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: ready })], {
    network: 'regtest',
    mode: 'recover',
    exit: { leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }] },
  });
  const finished = { id: 'old', destination: 'bcrt1qdest', deliveredSat: 1, completedAt: 0, droppedLeaves: [{ leafId: 'd-1', valueSats: 5_000 }] };

  it.each([
    ['a kept recovery holds', 'c-1', () => saveRecoveries(wallet, [kept])],
    [
      'a finished exit dropped as unrecoverable',
      'd-1',
      () => localStorage.setItem(`unilateral-exit-archive:${wallet.identityPubkey.slice(0, 16)}:${wallet.network}`, JSON.stringify([finished])),
    ],
  ])('leaves the leaves %s out of the exit it starts', async (_, leafId, record) => {
    record();
    const prepareRecoverFunds = vi
      .fn()
      .mockResolvedValueOnce(
        prepared({
          leaves: [
            { leafId, valueSats: 30_000, method: 'cooperative' },
            { leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' },
          ],
        }),
      )
      .mockResolvedValueOnce(prepared());
    const driver = sdk({ prepareRecoverFunds, recoverFunds: async () => checked([{ txid: 'fan', kind: 'fanOut' }]) });
    startUnilateralExitEngine(wallet, { ...chain, addressUtxos: async () => [coin(5_898)] }, driver);
    setPendingExit(wallet, pendingExit());
    await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));

    await startPendingExit();
    expect(prepareRecoverFunds).toHaveBeenLastCalledWith(
      expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-1'] } }),
    );
  });

  it('leaves out the leaves a Recover Funds quote found unrecoverable', () => {
    startUnilateralExitEngine(wallet, chain);
    noteDropped(wallet, [{ leafId: 'd-1', valueSats: 5_000 }]);
    expect(loadAccounting(wallet).droppedLeaves).toEqual([{ leafId: 'd-1', valueSats: 5_000 }]);
    expect(excludedLeafIds(getUnilateralExitState())).toContain('d-1');
  });
});

describe('a pass over an exit', () => {
  // The check asks for a rebuild, whose quote finds the only leaf unrecoverable.
  const droppingRebuild = () =>
    sdk({
      checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: { type: 'redo', reason: 'onChainStateDiverged' } }),
      prepareRecoverFunds: async () =>
        prepared({ leaves: [], skipped: [{ leafId: 'leaf-1', valueSats: 100_000, reason: { type: 'notRecoverable', message: 'paid elsewhere' } }] }),
    });

  it('archives a finished exit, with getInfo read again first and no sync', async () => {
    const syncWallet = vi.fn(async () => ({}));
    const refresh = vi.fn(async () => true);
    const driver = sdk({
      checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: { type: 'done' } }),
      syncWallet,
    });
    setUnilateralExitPlan(wallet, plan(swept(), { network: 'regtest' }));
    startUnilateralExitEngine(wallet, chain, driver, refresh);
    await vi.waitFor(() => expect(getUnilateralExitState().plan).toBeNull());
    expect(loadArchive(wallet)).toEqual([expect.objectContaining({ id: 's', deliveredSat: 99_000, txids: ['s'] })]);
    expect(getUnilateralExitState().archive).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(syncWallet).not.toHaveBeenCalled();
  });

  it('keeps hidden a leaf a rebuild found unrecoverable, once the exit ends having paid nothing', async () => {
    setUnilateralExitPlan(wallet, plan([tx({ txid: 'a' })], { network: 'regtest' }));
    startUnilateralExitEngine(wallet, chain, droppingRebuild());
    await vi.waitFor(() => expect(getUnilateralExitState().plan).toBeNull());
    expect(loadPlan(wallet)).toBeNull();
    expect(loadArchive(wallet)).toEqual([]);
    expect(loadAccounting(wallet).droppedLeaves).toEqual([{ leafId: 'leaf-1', valueSats: 100_000 }]);
    expect(excludedLeafIds(getUnilateralExitState())).toContain('leaf-1');
  });

  it('counts each plan it ends, archived or not, and keeps the count through a restart', async () => {
    const driver = droppingRebuild();
    const before = getUnilateralExitState().endedPlans;
    setUnilateralExitPlan(wallet, plan([tx({ txid: 'a' })], { network: 'regtest' }));
    startUnilateralExitEngine(wallet, chain, driver);
    await vi.waitFor(() => expect(getUnilateralExitState().plan).toBeNull());
    expect(loadArchive(wallet)).toEqual([]);
    expect(getUnilateralExitState().endedPlans).toBe(before + 1);

    setUnilateralExitPlan(wallet, done);
    await vi.waitFor(() => expect(getUnilateralExitState().plan).toBeNull());
    expect(getUnilateralExitState().endedPlans).toBe(before + 2);

    // A restart reports no plan for a while, which ends none.
    stopUnilateralExitEngine();
    startUnilateralExitEngine(wallet, chain, driver);
    expect(getUnilateralExitState().endedPlans).toBe(before + 2);
  });

  it('keeps a finished exit until what it accounted for is stored, then retires it', async () => {
    await withAccountingUnsaved(async () => {
      setUnilateralExitPlan(wallet, plan([tx({ txid: 'a' })], { network: 'regtest' }));
      startUnilateralExitEngine(wallet, chain, droppingRebuild());
      await vi.waitFor(() => expect(getUnilateralExitState().plan?.status).toEqual({ type: 'done' }));
      expect(loadPlan(wallet)?.droppedLeaves).toEqual([{ leafId: 'leaf-1', valueSats: 100_000 }]);
    });

    await advanceNow();
    expect(getUnilateralExitState().plan).toBeNull();
    expect(loadPlan(wallet)).toBeNull();
    expect(loadAccounting(wallet).droppedLeaves).toEqual([{ leafId: 'leaf-1', valueSats: 100_000 }]);
  });

  it('keeps a finished exit until what paid it out is read, and archives it on the pass that reads it', async () => {
    const confirmedSpender = vi
      .fn<ChainClient['confirmedSpender']>()
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValue({ txid: 'replacement', blockHeight: 90, outputs: [{ address: 'bc1qdest', value: 29_000 }] });
    const finished = plan([tx({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: confirmed(90) })], {
      network: 'regtest',
      status: { type: 'done' },
      landed: [{ leafIds: ['c-1'], valueSat: 30_000, outpoint: `${txidOf(7)}:0` }],
    });
    setUnilateralExitPlan(wallet, finished);
    startUnilateralExitEngine(wallet, { ...chain, confirmedSpender }, sdk());
    await vi.waitFor(() => expect(getUnilateralExitState().tipHeight).toBe(100));
    expect(getUnilateralExitState().plan?.status).toEqual({ type: 'done' });
    expect(loadPlan(wallet)).not.toBeNull();
    expect(loadArchive(wallet)).toEqual([]);

    await advanceNow();
    expect(getUnilateralExitState().plan).toBeNull();
    expect(loadArchive(wallet)).toEqual([expect.objectContaining({ id: 'c1', txids: ['replacement'], deliveredSat: 29_000 })]);
  });

  it('keeps on its record what a finished exit left at its fee address, counting only confirmed coins', async () => {
    const addressUtxos = vi.fn(async () => [coin(1_500), coin(700, false)]);
    startUnilateralExitEngine(wallet, { ...chain, addressUtxos });
    setUnilateralExitPlan(wallet, { ...done, quotedExitFeeSat: 3_122, exitFeeAddress: 'bcrt1qfee' });
    await vi.waitFor(() => expect(getUnilateralExitState().plan).toBeNull());
    expect(addressUtxos).toHaveBeenCalledWith('bcrt1qfee');
    expect(loadArchive(wallet)[0]).toMatchObject({ exitFeePaidSat: 3_122, unspentExitFeeSat: 1_500 });
  });

  it('runs no pass over a diverged exit that waits for the user to sign in', async () => {
    const checkRecoverFunds = vi.fn(async ({ recovery }: { recovery: UnilateralExitPlan['exit'] }) => ({
      recovery,
      verdict: { type: 'valid' as const },
    }));
    setUnilateralExitPlan(wallet, plan([tx({ txid: 'a' })], { network: 'regtest', status: { type: 'needsUpdate', why: 'signIn' } }));
    startUnilateralExitEngine(wallet, chain, sdk({ checkRecoverFunds }));
    await advanceNow();
    expect(checkRecoverFunds).not.toHaveBeenCalled();
  });

  it('keeps sending the other steps of an exit whose tap waits on a step it could not read', async () => {
    const broadcastPackage = vi.fn(async () => undefined);
    const waiting = plan(
      [tx({ txid: 'stuck', status: { type: 'unverified' } }), tx({ txid: 'due', cpfpTxHex: 'bb', status: ready })],
      { network: 'regtest', status: { type: 'needsUpdate', why: 'signIn', cause: 'unverified' } },
    );
    setUnilateralExitPlan(wallet, waiting);
    startUnilateralExitEngine(wallet, { ...chain, broadcastPackage }, sdk());
    await vi.waitFor(() => expect(broadcastPackage).toHaveBeenCalledWith('aa', 'bb'));
  });
});

describe('an exit holding a leaf it left out', () => {
  const failure = { leafId: 'c-9', outputTxid: txidOf(5), outputVout: 2, error: { type: 'generic' as const, message: 'refused' } };
  const done = (over: Parameters<typeof sdk>[0] = {}) =>
    sdk({ checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: { type: 'done' } }), ...over });

  beforeEach(() => localStorage.setItem('walletMnemonic', MNEMONIC));

  it('keeps it in its slot on the done verdict, archiving nothing, and reads getInfo again once for the leaf it landed', async () => {
    const refresh = vi.fn(async () => true);
    const prepareRecoverFunds = vi.fn(async () =>
      prepared({ leaves: [], skipped: [{ leafId: 'c-9', valueSats: 30_000, reason: { type: 'unverified' } }] }),
    );
    const holding = plan(swept(), {
      network: 'regtest',
      namedLeaves: [
        { leafId: 'leaf-1', valueSats: 100_000 },
        { leafId: 'c-9', valueSats: 30_000 },
      ],
      exit: { failed: [failure] },
    });
    setUnilateralExitPlan(wallet, holding);
    startUnilateralExitEngine(wallet, chain, done({ prepareRecoverFunds }), refresh);

    await vi.waitFor(() => expect(prepareRecoverFunds).toHaveBeenCalled());
    await vi.waitFor(() => expect(getUnilateralExitState().isAdvancing).toBe(false));
    expect(getUnilateralExitState().plan?.status).toEqual({ type: 'running' });
    expect(loadPlan(wallet)?.status).toEqual({ type: 'running' });
    expect(loadArchive(wallet)).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Ending lands nothing more, so it reads nothing again.
    setUnilateralExitPlan(wallet, { ...getUnilateralExitState().plan!, status: { type: 'done' } });
    await vi.waitFor(() => expect(getUnilateralExitState().plan).toBeNull());
    await advanceNow();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps a kept recovery to the leaves it built', () => {
    startUnilateralExitEngine(wallet, chain);
    keepRecovery(
      wallet,
      plan([tx({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: ready })], {
        network: 'regtest',
        mode: 'recover',
        namedLeaves: [
          { leafId: 'c-1', valueSats: 30_000 },
          { leafId: 'c-9', valueSats: 30_000 },
        ],
        exit: { leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }], failed: [failure] },
      }),
    );
    expect(getUnilateralExitState().recoveries[0].namedLeaves).toEqual([{ leafId: 'c-1', valueSats: 30_000 }]);
    expect(loadRecoveries(wallet)[0].namedLeaves).toEqual([{ leafId: 'c-1', valueSats: 30_000 }]);
  });
});

describe('reading getInfo again once leaves land', () => {
  const paid = spending('c1', [{ address: 'bc1qdest', value: 29_000 }]);
  /** A read of getInfo that waits until released. */
  const held = () => {
    let release: (ok: boolean) => void = () => {};
    const refresh = vi.fn(() => new Promise<boolean>(resolve => (release = resolve)));
    return { refresh, release: () => release(true) };
  };

  it('shows a recovery as it was until the read is back, so the row never offers what landed', async () => {
    const { refresh, release } = held();
    saveRecoveries(wallet, [landing()]);
    startUnilateralExitEngine(wallet, paid, confirming(), refresh);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await settle();
    expect(getUnilateralExitState().recoveries.map(r => r.status)).toEqual([{ type: 'running' }]);
    expect(loadArchive(wallet)).toEqual([]);

    release();
    await vi.waitFor(() => expect(getUnilateralExitState().recoveries).toEqual([]));
    expect(loadArchive(wallet)).toHaveLength(1);
  });

  it('shows an exit as it was until the read is back', async () => {
    const { refresh, release } = held();
    setUnilateralExitPlan(wallet, plan(swept(), { network: 'regtest' }));
    startUnilateralExitEngine(wallet, chain, sdk({ checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: { type: 'done' } }) }), refresh);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await settle();
    expect(getUnilateralExitState().plan?.status).toEqual({ type: 'running' });

    release();
    await vi.waitFor(() => expect(getUnilateralExitState().plan).toBeNull());
  });

  it('stores what landed even when the read fails', async () => {
    saveRecoveries(wallet, [landing()]);
    startUnilateralExitEngine(wallet, paid, confirming(), async () => {
      throw new Error('disconnected');
    });
    await vi.waitFor(() => expect(getUnilateralExitState().recoveries).toEqual([]));
    expect(loadArchive(wallet)).toHaveLength(1);
  });

  it("writes nothing for a wallet stopped while the read was out, and leaves the next one's state alone", async () => {
    const { refresh, release } = held();
    saveRecoveries(wallet, [landing()]);
    startUnilateralExitEngine(wallet, paid, confirming(), refresh);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    stopUnilateralExitEngine();
    startUnilateralExitEngine({ identityPubkey: 'other', network: 'regtest' }, chain, sdk());

    release();
    await settle();
    expect(loadRecoveries(wallet)).toHaveLength(1);
    expect(loadArchive(wallet)).toEqual([]);
    expect(getUnilateralExitState().archive).toEqual([]);
  });

  it('reads getInfo again for a plan the wizard built that lands a leaf', async () => {
    const refresh = vi.fn(async () => true);
    const running = plan([tx({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: ready })], {
      network: 'regtest',
      exit: { leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }] },
    });
    setUnilateralExitPlan(wallet, running);
    startUnilateralExitEngine(wallet, chain, null, refresh);
    setUnilateralExitPlan(wallet, { ...running, landed: [{ leafIds: ['c-1'], valueSat: 30_000, outpoint: 'o:0' }] });
    expect(refresh).toHaveBeenCalledTimes(1);
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('a finished exit with exit fee left at its address', () => {
  const feeKey = deriveFundingKey(MNEMONIC, 'regtest', 0);
  const destination = deriveFundingKey(MNEMONIC, 'regtest', 1).address;
  const finished = plan(swept(), {
    network: 'regtest',
    status: { type: 'done' },
    destination,
    exitFeeAddress: feeKey.address,
    quotedExitFeeSat: 2_000,
  });

  beforeEach(() => localStorage.setItem('walletMnemonic', MNEMONIC));

  it('sends it to the destination, then archives the exit with it counted as received', async () => {
    const broadcast = vi.fn(async () => undefined);
    let landed = false;
    const client: ChainClient = {
      ...chain,
      addressUtxos: async () => (landed ? [] : [coin(2_000, true, txidOf(8))]),
      broadcast,
      confirmedSpender: async () =>
        landed ? { txid: 'fee-sweep', blockHeight: 101, outputs: [{ address: destination, value: 1_780 }] } : null,
    };
    setUnilateralExitPlan(wallet, finished);
    startUnilateralExitEngine(wallet, client);

    await vi.waitFor(() => expect(getUnilateralExitState().plan?.feeSweep).toBeDefined());
    expect(broadcast).toHaveBeenCalledWith(getUnilateralExitState().plan?.feeSweep?.txHex);
    expect(loadArchive(wallet)).toEqual([]);

    landed = true;
    await advanceNow();
    await vi.waitFor(() => expect(getUnilateralExitState().plan).toBeNull());
    expect(loadArchive(wallet)[0]).toMatchObject({ deliveredSat: 100_780, unspentExitFeeSat: 0, txids: ['s', 'fee-sweep'] });
  });
});
