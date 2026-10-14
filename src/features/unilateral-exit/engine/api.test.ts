import {
  cancelPendingExit,
  dismissUnilateralExitPlan,
  keepRecovery,
  noteDropped,
  setPendingExit,
  setUnilateralExitPlan,
  startPendingExit,
  startUnilateralExitEngine,
  stopUnilateralExitEngine,
} from './api';
import { advanceNow } from './polling';
import { excludedLeafIds, getUnilateralExitState } from './state';
import type { UnilateralExitPlan } from '../model/plan';
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

describe('the plan the engine holds', () => {
  beforeEach(() => {
    localStorage.clear();
    stopUnilateralExitEngine();
  });

  it('keeps a completed plan on disk so the outcome survives a reload', () => {
    startUnilateralExitEngine(wallet, chain);
    setUnilateralExitPlan(wallet, done);
    expect(loadPlan(wallet)?.status).toEqual({ type: 'done' });
    expect(getUnilateralExitState().plan?.status).toEqual({ type: 'done' });
  });

  it('stores a plan even when it is not running for that wallet, for when it does', () => {
    setUnilateralExitPlan(wallet, done);
    expect(getUnilateralExitState().plan).toBeNull();
    startUnilateralExitEngine(wallet, chain);
    expect(getUnilateralExitState().plan?.status).toEqual({ type: 'done' });
  });

  it('drops the plan once the user acknowledges it, freeing the next exit', () => {
    startUnilateralExitEngine(wallet, chain);
    setUnilateralExitPlan(wallet, done);
    dismissUnilateralExitPlan();
    expect(loadPlan(wallet)).toBeNull();
    expect(getUnilateralExitState().plan).toBeNull();
  });
});

describe('a pass that outlives its plan', () => {
  // A chain whose tip reads wait until released, so a pass can be held open.
  const held = () => {
    const pending: Array<(height: number) => void> = [];
    const client: ChainClient = { ...chain, tipHeight: () => new Promise(resolve => pending.push(resolve)) };
    return { client, pending };
  };
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
  };
  const firstTxid = () => loadPlan(wallet)?.exit.transactions[0]?.txid;

  beforeEach(() => {
    localStorage.clear();
    stopUnilateralExitEngine();
  });

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

  beforeEach(() => {
    localStorage.clear();
    stopUnilateralExitEngine();
    localStorage.setItem('walletMnemonic', MNEMONIC);
  });

  afterEach(() => {
    stopUnilateralExitEngine();
  });

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

  it('asks for what the build says it still needs', async () => {
    const recoverFunds = vi.fn(async () => {
      throw new Error('Insufficient CPFP funding: need at least 6400 sats');
    });
    startUnilateralExitEngine(wallet, holding([coin(5_898)]), sdk({ prepareRecoverFunds: async () => prepared(), recoverFunds }));
    setPendingExit(wallet, pendingExit());

    await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));
    await startPendingExit();
    expect(loadPendingExit(wallet)?.required).toEqual({ sat: 6_400, inputs: 1 });
    expect(getUnilateralExitState().pending?.required.sat).toBe(6_400);
    expect(getUnilateralExitState().startError).toBeNull();
  });

  it('keeps why a start failed, so the user can try again', async () => {
    const driver = sdk({
      prepareRecoverFunds: async () => prepared(),
      recoverFunds: async () => {
        throw new Error('chain service unreachable');
      },
    });
    startUnilateralExitEngine(wallet, holding([coin(5_898)]), driver);
    setPendingExit(wallet, pendingExit());

    await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));
    await startPendingExit();
    expect(getUnilateralExitState().startError).toBe('chain service unreachable');
    expect(getUnilateralExitState().isStarting).toBe(false);
    expect(getUnilateralExitState().pending).not.toBeNull();
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
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
  };
  const cosigned = (txid: string, leafId = 'c-1', over: Partial<UnilateralExitPlan> = {}) =>
    plan([tx({ txid, kind: 'cooperative', nodeId: leafId, txHex: `hex-${txid}`, status: ready })], {
      network: 'regtest',
      mode: 'recover',
      ...over,
      exit: { leaves: [{ leafId, valueSats: 30_000, method: 'cooperative' }] },
    });

  beforeEach(() => {
    localStorage.clear();
    stopUnilateralExitEngine();
  });

  afterEach(() => {
    stopUnilateralExitEngine();
  });

  it('are sent on their own, with no exit to drive', async () => {
    const broadcast = vi.fn(async () => undefined);
    saveRecoveries(wallet, [cosigned('c1')]);
    startUnilateralExitEngine(wallet, { ...chain, broadcast }, sdk());
    await vi.waitFor(() => expect(broadcast).toHaveBeenCalledWith('hex-c1'));
    expect(getUnilateralExitState().recoveries).toHaveLength(1);
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
  const landing = (txid: string) =>
    plan([tx({ txid, kind: 'cooperative', nodeId: 'c-1', txHex: rawTx([`${txidOf(7)}:0`], [29_000]), status: ready })], {
      network: 'regtest',
      mode: 'recover',
      exit: { leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }] },
    });

  it('are archived once done, and the wallet syncs so getInfo stops counting them', async () => {
    const syncWallet = vi.fn(async () => ({}));
    saveRecoveries(wallet, [landing('c1')]);
    startUnilateralExitEngine(wallet, spending('c1', [{ address: 'bc1qdest', value: 29_000 }]), confirming(syncWallet));

    await vi.waitFor(() => expect(getUnilateralExitState().recoveries).toEqual([]));
    expect(loadRecoveries(wallet)).toEqual([]);
    expect(loadArchive(wallet)).toEqual([expect.objectContaining({ id: 'c1', mode: 'recover', deliveredSat: 29_000 })]);
    expect(getUnilateralExitState().archive).toHaveLength(1);
    await vi.waitFor(() => expect(getUnilateralExitState().settledLeafIds).toContain('c-1'));
    expect(syncWallet).toHaveBeenCalledTimes(1);
    expect(getUnilateralExitState().accounting.unsettledLeaves).toEqual([]);
    expect(loadAccounting(wallet).unsettledLeaves).toEqual([]);
  });

  it('archive the replacement that confirmed in place of one, with what it paid', async () => {
    saveRecoveries(wallet, [landing('c1')]);
    const replacement = spending('c1-bumped', [
      { address: 'BC1QDEST', value: 28_400 },
      { address: 'bc1qother', value: 500 },
    ]);
    startUnilateralExitEngine(wallet, replacement, confirming());

    await vi.waitFor(() => expect(getUnilateralExitState().recoveries).toEqual([]));
    expect(loadArchive(wallet)).toEqual([expect.objectContaining({ id: 'c1', txids: ['c1-bumped'], deliveredSat: 28_400 })]);
  });

  it('stay followed while the spender of a done one cannot be read', async () => {
    saveRecoveries(wallet, [landing('c1')]);
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

  it('keeps one kept while a pass is out', async () => {
    let release: (height: number) => void = () => {};
    const slow: ChainClient = { ...chain, tipHeight: () => new Promise(resolve => (release = resolve)) };
    saveRecoveries(wallet, [cosigned('c1')]);
    startUnilateralExitEngine(wallet, slow, sdk());

    keepRecovery(wallet, cosigned('c2', 'c-2'));
    release(101);
    await settle();
    expect(getUnilateralExitState().recoveries.map(r => r.exit.transactions[0].txid)).toEqual(['c1', 'c2']);
    expect(loadRecoveries(wallet)).toHaveLength(2);
  });

  it('replaces a recovery kept again, rather than listing it twice, even mid-pass', async () => {
    let release: (height: number) => void = () => {};
    const slow: ChainClient = { ...chain, tipHeight: () => new Promise(resolve => (release = resolve)) };
    saveRecoveries(wallet, [cosigned('c1')]);
    startUnilateralExitEngine(wallet, slow, sdk());

    keepRecovery(wallet, cosigned('c1', 'c-1', { quotedSweepFeeSat: 999 }));
    release(101);
    await settle();
    expect(getUnilateralExitState().recoveries).toEqual([expect.objectContaining({ quotedSweepFeeSat: 999 })]);
    expect(loadRecoveries(wallet)).toHaveLength(1);
  });

  describe('raised to a higher fee', () => {
    const slowTip = () => {
      let release: (height: number) => void = () => {};
      const tipHeight = vi
        .fn<ChainClient['tipHeight']>()
        .mockImplementationOnce(() => new Promise(resolve => (release = resolve)))
        .mockResolvedValue(101);
      return { tipHeight, release: (height: number) => release(height) };
    };

    it('replaces the recovery it bumps, even mid-pass', async () => {
      const { tipHeight, release } = slowTip();
      saveRecoveries(wallet, [cosigned('c1')]);
      startUnilateralExitEngine(wallet, { ...chain, tipHeight }, sdk());

      keepRecovery(wallet, cosigned('c1-bumped'));
      release(101);
      await settle();
      expect(getUnilateralExitState().recoveries.map(r => r.exit.transactions[0].txid)).toEqual(['c1-bumped']);
      expect(loadRecoveries(wallet).map(r => r.exit.transactions[0].txid)).toEqual(['c1-bumped']);
    });

    it('archives what landed once when the recovery it bumped confirms during a pass', async () => {
      const { tipHeight, release } = slowTip();
      const bumped = plan(
        [tx({ txid: 'c1-bumped', kind: 'cooperative', nodeId: 'c-1', txHex: rawTx([`${txidOf(7)}:0`], [28_000]), status: ready })],
        { network: 'regtest', mode: 'recover', exit: { leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }] } },
      );
      saveRecoveries(wallet, [landing('c1')]);
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

    it('replaces the record a retry just swapped the transaction of', async () => {
      const stuck = plan([tx({ txid: 'c-old', kind: 'cooperative', nodeId: 'c-1', txHex: 'hex-c-old', status: { type: 'unverified' } })], {
        network: 'regtest',
        mode: 'recover',
        retrySince: 90,
        exit: { leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }] },
      });
      const prepareRecoverFunds = async () =>
        prepared({ leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }], funding: undefined });
      const recoverFunds = async () =>
        checked([{ txid: 'c-new', kind: 'cooperative', nodeId: 'c-1', txHex: 'hex-c-new', status: { type: 'unverified' } }], {
          leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }],
        });
      saveRecoveries(wallet, [stuck]);
      startUnilateralExitEngine(wallet, chain, sdk({ prepareRecoverFunds, recoverFunds }));
      await vi.waitFor(() => expect(getUnilateralExitState().recoveries[0]?.exit.transactions[0].txid).toBe('c-new'));

      // Bumped from the snapshot the sheet took of `c-old`.
      keepRecovery(wallet, cosigned('c-bumped'));
      expect(getUnilateralExitState().recoveries.map(r => r.exit.transactions[0].txid)).toEqual(['c-bumped']);
      expect(loadRecoveries(wallet).map(r => r.exit.transactions[0].txid)).toEqual(['c-bumped']);
    });
  });

  it('replaces one of the same leaves built again', () => {
    startUnilateralExitEngine(wallet, chain);
    keepRecovery(wallet, cosigned('c1'));
    keepRecovery(wallet, cosigned('c1-again'));
    expect(loadRecoveries(wallet).map(r => r.exit.transactions[0].txid)).toEqual(['c1-again']);
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

    it("replaces a stuck kept recovery's transaction with the one a fresh build makes, and saves it", async () => {
      const recoverFunds = async () =>
        checked([{ txid: 'c-new', kind: 'cooperative', nodeId: 'c-1', txHex: 'hex-c-new', status: { type: 'unverified' } }], {
          leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }],
        });
      saveRecoveries(wallet, [stuck()]);
      startUnilateralExitEngine(wallet, chain, sdk({ prepareRecoverFunds: quoting({}), recoverFunds }));

      await vi.waitFor(() => expect(getUnilateralExitState().recoveries[0]?.exit.transactions[0].txid).toBe('c-new'));
      expect(loadRecoveries(wallet)[0].exit.transactions[0].txid).toBe('c-new');
    });

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

    it('are polled about once a block, and at the usual pace again once something can move', async () => {
      const setInterval = vi.spyOn(globalThis, 'setInterval');
      const lastInterval = () => setInterval.mock.lastCall?.[1];
      try {
        saveRecoveries(wallet, [stuck({ retrySince: undefined })]);
        startUnilateralExitEngine(wallet, chain, sdk());
        await settle();
        expect(getUnilateralExitState().recoveries[0].retrySince).toBe(100);
        expect(lastInterval()).toBe(100_000);

        keepRecovery(wallet, cosigned('c2', 'c-2'));
        expect(lastInterval()).toBe(5_000);
      } finally {
        setInterval.mockRestore();
      }
    });

    it.each([
      ['an exit with a step to send', () => setUnilateralExitPlan(wallet, plan([tx({ txid: 'r', kind: 'refund', status: ready })], { network: 'regtest' }))],
      ['an exit waiting on its fee', () => setPendingExit(wallet, pendingExit())],
    ])('keep the usual pace beside %s', async (_, open) => {
      const setInterval = vi.spyOn(globalThis, 'setInterval');
      const lastInterval = () => setInterval.mock.lastCall?.[1];
      try {
        saveRecoveries(wallet, [stuck({ retrySince: undefined })]);
        startUnilateralExitEngine(wallet, chain, sdk());
        await settle();
        expect(lastInterval()).toBe(100_000);

        open();
        await settle();
        expect(lastInterval()).toBe(5_000);
      } finally {
        setInterval.mockRestore();
      }
    });
  });

  it('keep their leaves out of an exit started beside them', async () => {
    localStorage.setItem('walletMnemonic', MNEMONIC);
    const prepareRecoverFunds = vi
      .fn()
      .mockResolvedValueOnce(
        prepared({
          leaves: [
            { leafId: 'c-1', valueSats: 30_000, method: 'cooperative' },
            { leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' },
          ],
        }),
      )
      .mockResolvedValueOnce(prepared());
    const driver = sdk({ prepareRecoverFunds, recoverFunds: async () => checked([{ txid: 'fan', kind: 'fanOut' }]) });
    saveRecoveries(wallet, [cosigned('c1')]);
    startUnilateralExitEngine(wallet, { ...chain, addressUtxos: async () => [coin(5_898)] }, driver);
    setPendingExit(wallet, pendingExit());
    await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));

    await startPendingExit();
    expect(prepareRecoverFunds).toHaveBeenLastCalledWith(
      expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-1'] } }),
    );
  });
});

describe('a fresh quote beside finished exits', () => {
  beforeEach(() => {
    localStorage.clear();
    stopUnilateralExitEngine();
    localStorage.setItem('walletMnemonic', MNEMONIC);
  });

  afterEach(() => {
    stopUnilateralExitEngine();
  });

  it('leaves out the leaves a finished exit dropped as unrecoverable', async () => {
    const finished = { id: 'old', destination: 'bcrt1qdest', deliveredSat: 1, completedAt: 0, droppedLeaves: [{ leafId: 'd-1', valueSats: 5_000 }] };
    localStorage.setItem(`unilateral-exit-archive:${wallet.identityPubkey.slice(0, 16)}:${wallet.network}`, JSON.stringify([finished]));
    const prepareRecoverFunds = vi
      .fn()
      .mockResolvedValueOnce(
        prepared({
          leaves: [
            { leafId: 'd-1', valueSats: 5_000, method: 'cooperative' },
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
  beforeEach(() => {
    localStorage.clear();
    stopUnilateralExitEngine();
  });

  afterEach(() => {
    stopUnilateralExitEngine();
  });

  it('archives a finished exit and syncs the wallet', async () => {
    const syncWallet = vi.fn(async () => ({}));
    const driver = sdk({
      checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: { type: 'done' } }),
      syncWallet,
    });
    setUnilateralExitPlan(wallet, plan(swept(), { network: 'regtest' }));
    startUnilateralExitEngine(wallet, chain, driver);
    await vi.waitFor(() => expect(getUnilateralExitState().plan).toBeNull());
    expect(loadArchive(wallet)).toEqual([expect.objectContaining({ id: 's', deliveredSat: 99_000, txids: ['s'] })]);
    await vi.waitFor(() => expect(getUnilateralExitState().settledLeafIds).toContain('leaf-1'));
    expect(syncWallet).toHaveBeenCalledTimes(1);
    expect(getUnilateralExitState().accounting.unsettledLeaves).toEqual([]);
    expect(loadAccounting(wallet).unsettledLeaves).toEqual([]);
  });

  it('keeps hidden a leaf a rebuild found unrecoverable, once the exit ends having paid nothing', async () => {
    const skipped = [{ leafId: 'leaf-1', valueSats: 100_000, reason: { type: 'notRecoverable' as const, message: 'paid elsewhere' } }];
    const driver = sdk({
      checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: { type: 'redo', reason: 'onChainStateDiverged' } }),
      prepareRecoverFunds: async () => prepared({ leaves: [], skipped }),
    });
    setUnilateralExitPlan(wallet, plan([tx({ txid: 'a' })], { network: 'regtest' }));
    startUnilateralExitEngine(wallet, chain, driver);
    await vi.waitFor(() => expect(getUnilateralExitState().plan).toBeNull());
    expect(loadPlan(wallet)).toBeNull();
    expect(loadArchive(wallet)).toEqual([]);
    expect(loadAccounting(wallet).droppedLeaves).toEqual([{ leafId: 'leaf-1', valueSats: 100_000 }]);
    expect(excludedLeafIds(getUnilateralExitState())).toContain('leaf-1');
  });

  it('keeps a finished exit until what it accounted for is stored, then retires it', async () => {
    const skipped = [{ leafId: 'leaf-1', valueSats: 100_000, reason: { type: 'notRecoverable' as const, message: 'paid elsewhere' } }];
    const driver = sdk({
      checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: { type: 'redo', reason: 'onChainStateDiverged' } }),
      prepareRecoverFunds: async () => prepared({ leaves: [], skipped }),
    });
    await withAccountingUnsaved(async () => {
      setUnilateralExitPlan(wallet, plan([tx({ txid: 'a' })], { network: 'regtest' }));
      startUnilateralExitEngine(wallet, chain, driver);
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

  it('archives a finished plan it is handed', async () => {
    startUnilateralExitEngine(wallet, chain);
    setUnilateralExitPlan(wallet, done);
    await vi.waitFor(() => expect(getUnilateralExitState().plan).toBeNull());
    expect(loadPlan(wallet)).toBeNull();
    expect(getUnilateralExitState().archive.map(e => e.id)).toEqual(['s']);
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

  it('keeps trying to rebuild a diverged exit that waits on nothing from the user', async () => {
    const checkRecoverFunds = vi.fn(async ({ recovery }: { recovery: UnilateralExitPlan['exit'] }) => ({
      recovery,
      verdict: { type: 'redo' as const, reason: 'onChainStateDiverged' as const },
    }));
    const prepareRecoverFunds = vi.fn(async () => {
      throw new Error('chain service unavailable');
    });
    setUnilateralExitPlan(wallet, plan([tx({ txid: 'a' })], { network: 'regtest', status: { type: 'rebuilding' } }));
    startUnilateralExitEngine(wallet, chain, sdk({ checkRecoverFunds, prepareRecoverFunds }));
    await vi.waitFor(() => expect(prepareRecoverFunds).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(getUnilateralExitState().isAdvancing).toBe(false));
    await advanceNow();
    expect(prepareRecoverFunds).toHaveBeenCalledTimes(2);
    expect(getUnilateralExitState().plan?.status).toEqual({ type: 'rebuilding' });
  });
});

describe('an exit holding a leaf it left out', () => {
  const failure = { leafId: 'c-9', outputTxid: txidOf(5), outputVout: 2, error: { type: 'generic' as const, message: 'refused' } };
  const done = (over: Parameters<typeof sdk>[0] = {}) =>
    sdk({ checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: { type: 'done' } }), ...over });

  beforeEach(() => {
    localStorage.clear();
    stopUnilateralExitEngine();
    localStorage.setItem('walletMnemonic', MNEMONIC);
  });

  afterEach(() => {
    stopUnilateralExitEngine();
  });

  it('keeps it in its slot on the done verdict, archiving nothing, and syncs once for the leaf it landed', async () => {
    const syncWallet = vi.fn(async () => ({}));
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
    startUnilateralExitEngine(wallet, chain, done({ prepareRecoverFunds, syncWallet }));

    await vi.waitFor(() => expect(prepareRecoverFunds).toHaveBeenCalled());
    await vi.waitFor(() => expect(getUnilateralExitState().isAdvancing).toBe(false));
    expect(getUnilateralExitState().plan?.status).toEqual({ type: 'running' });
    expect(loadPlan(wallet)?.status).toEqual({ type: 'running' });
    expect(loadArchive(wallet)).toEqual([]);
    await vi.waitFor(() => expect(getUnilateralExitState().settledLeafIds).toContain('leaf-1'));
    expect(syncWallet).toHaveBeenCalledTimes(1);

    // Ending, it hands on no leaf that sync already recounted.
    setUnilateralExitPlan(wallet, { ...getUnilateralExitState().plan!, status: { type: 'done' } });
    await vi.waitFor(() => expect(getUnilateralExitState().plan).toBeNull());
    await advanceNow();
    expect(loadAccounting(wallet).unsettledLeaves).toEqual([]);
    expect(syncWallet).toHaveBeenCalledTimes(1);
  });

  it('reads the fee address of one waiting on more exit fee before each pass, and passes the coins in', async () => {
    const key = deriveFundingKey(MNEMONIC, 'regtest', 0);
    const addressUtxos = vi.fn(async () => [coin(3_000)]);
    const recoverFunds = vi.fn(async () =>
      checked([{ txid: 'refund-2', kind: 'refund', nodeId: 'leaf-2', status: { type: 'waitingForTimelock', spendableAtHeight: 900 } }], {
        leaves: [{ leafId: 'leaf-2', valueSats: 50_000, method: 'unilateral' }],
      }),
    );
    const prepareRecoverFunds = async () => prepared({ leaves: [{ leafId: 'leaf-2', valueSats: 50_000, method: 'unilateral' }] });
    const waiting = plan(swept(), {
      network: 'regtest',
      exitFeeAddress: key.address,
      retrySince: 90,
      retriedAt: 90,
      status: { type: 'needsExitFee', topUp: { required: { sat: 3_000, inputs: 1 }, heldSat: 0 } },
      namedLeaves: [
        { leafId: 'leaf-1', valueSats: 100_000 },
        { leafId: 'leaf-2', valueSats: 50_000 },
      ],
    });
    setUnilateralExitPlan(wallet, waiting);
    startUnilateralExitEngine(wallet, { ...chain, addressUtxos }, done({ prepareRecoverFunds, recoverFunds }));

    await vi.waitFor(() => expect(recoverFunds).toHaveBeenCalled());
    expect(addressUtxos).toHaveBeenCalledWith(key.address);
    expect(recoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ fundingInputs: [expect.objectContaining({ txid: 'coin-3000', pubkey: key.publicKeyHex })] }),
      expect.anything(),
    );
    await vi.waitFor(() => expect(getUnilateralExitState().plan?.status).toEqual({ type: 'running' }));
    expect(getUnilateralExitState().pendingCoins).toEqual([]);
  });

  it('hands the pass no coins when the read of the fee address fails, so what it held before the ask is not set too low', async () => {
    const key = deriveFundingKey(MNEMONIC, 'regtest', 0);
    const addressUtxos = vi.fn(async (): Promise<ChainUtxo[]> => {
      throw new Error('rate limited');
    });
    const waiting = plan(swept(), {
      network: 'regtest',
      exitFeeAddress: key.address,
      // No retry due, so the request stands.
      retrySince: 98,
      retriedAt: 98,
      status: { type: 'needsExitFee', topUp: { required: { sat: 3_000, inputs: 1 } } },
      namedLeaves: [
        { leafId: 'leaf-1', valueSats: 100_000 },
        { leafId: 'leaf-2', valueSats: 50_000 },
      ],
    });
    setUnilateralExitPlan(wallet, waiting);
    startUnilateralExitEngine(wallet, { ...chain, addressUtxos }, sdk());

    await vi.waitFor(() => expect(addressUtxos).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(getUnilateralExitState().isAdvancing).toBe(false));
    expect(getUnilateralExitState().plan?.status).toEqual({ type: 'needsExitFee', topUp: { required: { sat: 3_000, inputs: 1 } } });
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

describe('settling what landed', () => {
  /** Leaves an ended record landed that no sync has recounted, as a run before this one left them. */
  const leaveUnsettled = (target: typeof wallet, ...leafIds: string[]) =>
    localStorage.setItem(
      `unilateral-exit-accounting:${target.identityPubkey.slice(0, 16)}:${target.network}`,
      JSON.stringify({ droppedLeaves: [], unsettledLeaves: leafIds.map(leafId => ({ leafId, valueSats: 100_000 })) }),
    );
  const held = () => {
    let release: () => void = () => {};
    let refuse: (e: Error) => void = () => {};
    const promise = new Promise<object>((resolve, reject) => {
      release = () => resolve({});
      refuse = reject;
    });
    return { promise, release, refuse };
  };
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
  };
  const unsettledIds = (target = wallet) => loadAccounting(target).unsettledLeaves.map(leaf => leaf.leafId);

  beforeEach(() => {
    localStorage.clear();
    stopUnilateralExitEngine();
  });

  afterEach(() => {
    stopUnilateralExitEngine();
  });

  it('syncs once at start for what an ended record left unsettled, then forgets it', async () => {
    const syncWallet = vi.fn(async () => ({}));
    leaveUnsettled(wallet, 'leaf-1');
    startUnilateralExitEngine(wallet, chain, sdk({ syncWallet }));
    await vi.waitFor(() => expect(getUnilateralExitState().settledLeafIds).toContain('leaf-1'));
    expect(syncWallet).toHaveBeenCalledTimes(1);
    expect(unsettledIds()).toEqual([]);
  });

  it('settles on a sync that rejects while it runs, since the recount came first, and stops polling', async () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    const clearInterval = vi.spyOn(globalThis, 'clearInterval');
    try {
      const syncWallet = vi.fn(async () => {
        throw new Error('exit chain collection failed');
      });
      leaveUnsettled(wallet, 'leaf-1');
      startUnilateralExitEngine(wallet, chain, sdk({ syncWallet }));
      const timer = setInterval.mock.results[setInterval.mock.results.length - 1]?.value;
      await vi.waitFor(() => expect(getUnilateralExitState().settledLeafIds).toContain('leaf-1'));
      expect(unsettledIds()).toEqual([]);
      expect(clearInterval).toHaveBeenCalledWith(timer);

      await advanceNow();
      expect(syncWallet).toHaveBeenCalledTimes(1);
    } finally {
      setInterval.mockRestore();
      clearInterval.mockRestore();
    }
  });

  it('keeps what a sync the stop rejected was for, and syncs once more at the next start', async () => {
    const sync = held();
    leaveUnsettled(wallet, 'leaf-1');
    startUnilateralExitEngine(wallet, chain, sdk({ syncWallet: () => sync.promise }));
    await settle();
    stopUnilateralExitEngine();
    sync.refuse(new Error('disconnected'));
    await settle();
    expect(unsettledIds()).toEqual(['leaf-1']);

    const syncWallet = vi.fn(async () => ({}));
    startUnilateralExitEngine(wallet, chain, sdk({ syncWallet }));
    await vi.waitFor(() => expect(unsettledIds()).toEqual([]));
    expect(syncWallet).toHaveBeenCalledTimes(1);
  });

  it('settles only what landed before its sync, and the rest on the next pass', async () => {
    const sync = held();
    const syncWallet = vi.fn().mockReturnValueOnce(sync.promise).mockResolvedValue({});
    leaveUnsettled(wallet, 'leaf-1');
    startUnilateralExitEngine(wallet, chain, sdk({ syncWallet }));
    await settle();

    setUnilateralExitPlan(
      wallet,
      plan([], {
        network: 'regtest',
        status: { type: 'done' },
        landed: [{ leafIds: ['leaf-2'], valueSat: 50_000, txid: 's2', paidSat: 49_000, blockHeight: 9 }],
      }),
    );
    await vi.waitFor(() => expect(getUnilateralExitState().plan).toBeNull());
    expect(unsettledIds()).toEqual(['leaf-1', 'leaf-2']);
    expect(syncWallet).toHaveBeenCalledTimes(1);

    sync.release();
    await vi.waitFor(() => expect(unsettledIds()).toEqual(['leaf-2']));
    await advanceNow();
    expect(syncWallet).toHaveBeenCalledTimes(2);
    expect(unsettledIds()).toEqual([]);
  });

  it("settles a wallet's leaves when its sync ends after a switch, leaving the other wallet's state alone", async () => {
    const other = { identityPubkey: 'other', network: 'regtest' };
    const sync = held();
    leaveUnsettled(wallet, 'leaf-1');
    startUnilateralExitEngine(wallet, chain, sdk({ syncWallet: () => sync.promise }));
    await settle();
    stopUnilateralExitEngine();
    startUnilateralExitEngine(other, chain, sdk());

    sync.release();
    await vi.waitFor(() => expect(unsettledIds()).toEqual([]));
    expect(getUnilateralExitState().settledLeafIds.size).toBe(0);
  });

  it('reads the wallet again before it stops subtracting what landed', async () => {
    let reread: (ok: boolean) => void = () => {};
    const refresh = vi.fn(() => new Promise<boolean>(resolve => (reread = resolve)));
    const syncWallet = vi.fn(async () => ({}));
    leaveUnsettled(wallet, 'leaf-1');
    startUnilateralExitEngine(wallet, chain, sdk({ syncWallet }), refresh);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(syncWallet.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]);
    expect(unsettledIds()).toEqual(['leaf-1']);
    expect(getUnilateralExitState().settledLeafIds.size).toBe(0);

    reread(true);
    await vi.waitFor(() => expect(getUnilateralExitState().settledLeafIds).toContain('leaf-1'));
    expect(unsettledIds()).toEqual([]);
  });

  it('keeps what landed while the wallet cannot be read again, and tries once more on the next pass', async () => {
    const refresh = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true);
    const syncWallet = vi.fn(async () => ({}));
    leaveUnsettled(wallet, 'leaf-1');
    startUnilateralExitEngine(wallet, chain, sdk({ syncWallet }), refresh);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await settle();
    expect(unsettledIds()).toEqual(['leaf-1']);
    expect(getUnilateralExitState().settledLeafIds.size).toBe(0);

    await advanceNow();
    expect(syncWallet).toHaveBeenCalledTimes(2);
    expect(unsettledIds()).toEqual([]);
  });

  it("keeps what a replaced sdk's refused sync was for until the new sdk's sync recounts it", async () => {
    const old = held();
    leaveUnsettled(wallet, 'leaf-1');
    startUnilateralExitEngine(wallet, chain, sdk({ syncWallet: () => old.promise }));
    await settle();
    stopUnilateralExitEngine();
    const next = held();
    startUnilateralExitEngine(wallet, chain, sdk({ syncWallet: () => next.promise }));
    await settle();

    // Refused by the disconnect, after the restart for the same wallet.
    old.refuse(new Error('disconnected'));
    await settle();
    expect(unsettledIds()).toEqual(['leaf-1']);
    expect(getUnilateralExitState().settledLeafIds.size).toBe(0);

    next.release();
    await vi.waitFor(() => expect(unsettledIds()).toEqual([]));
  });

  it('polls at the usual pace while a landing waits on its sync, beside recoveries stuck unverified', async () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    try {
      const stuck = plan([tx({ txid: 'c-old', kind: 'cooperative', nodeId: 'c-1', status: { type: 'unverified' } })], {
        network: 'regtest',
        mode: 'recover',
        exit: { leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }] },
      });
      saveRecoveries(wallet, [stuck]);
      leaveUnsettled(wallet, 'leaf-1');
      startUnilateralExitEngine(wallet, chain, sdk({ syncWallet: () => held().promise }));
      await settle();
      expect(getUnilateralExitState().recoveries[0].retrySince).toBe(100);
      expect(setInterval.mock.lastCall?.[1]).toBe(5_000);
    } finally {
      setInterval.mockRestore();
    }
  });

  it('does not poll for what landed with no driver to sync it', async () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    try {
      leaveUnsettled(wallet, 'leaf-1');
      startUnilateralExitEngine(wallet, chain);
      await settle();
      expect(setInterval).not.toHaveBeenCalled();
    } finally {
      setInterval.mockRestore();
    }
  });

  it("does not hold a restart's sync behind one the old sdk still has out", async () => {
    leaveUnsettled(wallet, 'leaf-1');
    startUnilateralExitEngine(wallet, chain, sdk({ syncWallet: () => held().promise }));
    await settle();
    stopUnilateralExitEngine();

    const syncWallet = vi.fn(async () => ({}));
    startUnilateralExitEngine(wallet, chain, sdk({ syncWallet }));
    await vi.waitFor(() => expect(unsettledIds()).toEqual([]));
    expect(syncWallet).toHaveBeenCalledTimes(1);
  });
});
