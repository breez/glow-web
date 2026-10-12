import {
  advanceNow,
  cancelPendingExit,
  dismissUnilateralExitPlan,
  getUnilateralExitState,
  keepRecovery,
  pollIntervalMs,
  setPendingExit,
  setUnilateralExitPlan,
  startPendingExit,
  startUnilateralExitEngine,
  stopUnilateralExitEngine,
} from './engine';
import { loadPendingExit, loadPlan, loadRecoveries, saveRecoveries, type UnilateralExitPlan } from './driver';
import { loadArchive } from './archive';
import { deriveFundingKey } from './funding';
import { checked, coin, confirmed, MNEMONIC, pendingExit, plan, prepared, rawTx, ready, sdk, tx, txidOf } from './testFixtures';
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

const done = plan(swept(), { network: 'regtest', phase: 'complete' });

describe('the plan the engine holds', () => {
  beforeEach(() => {
    localStorage.clear();
    stopUnilateralExitEngine();
  });

  it('keeps a completed plan on disk so the outcome survives a reload', () => {
    startUnilateralExitEngine(wallet, chain);
    setUnilateralExitPlan(wallet, done);
    expect(loadPlan(wallet)?.phase).toBe('complete');
    expect(getUnilateralExitState().plan?.phase).toBe('complete');
  });

  it('stores a plan even when it is not running for that wallet, for when it does', () => {
    setUnilateralExitPlan(wallet, done);
    expect(getUnilateralExitState().plan).toBeNull();
    startUnilateralExitEngine(wallet, chain);
    expect(getUnilateralExitState().plan?.phase).toBe('complete');
  });

  it('drops the plan once the user acknowledges it, freeing the next exit', () => {
    startUnilateralExitEngine(wallet, chain);
    setUnilateralExitPlan(wallet, done);
    dismissUnilateralExitPlan();
    expect(loadPlan(wallet)).toBeNull();
    expect(getUnilateralExitState().plan).toBeNull();
  });
});

describe('pollIntervalMs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('polls fast on regtest, where blocks come from a keyboard', () => {
    expect(pollIntervalMs('regtest')).toBe(5_000);
  });

  it('leaves a live chain on the slow default', () => {
    expect(pollIntervalMs('mainnet')).toBe(30_000);
  });

  it('lets the environment override any network', () => {
    vi.stubEnv('VITE_UNILATERAL_EXIT_POLL_SECS', '2');
    expect(pollIntervalMs('mainnet')).toBe(2_000);
  });

  it('ignores an override that is not a positive number', () => {
    vi.stubEnv('VITE_UNILATERAL_EXIT_POLL_SECS', 'soon');
    expect(pollIntervalMs('regtest')).toBe(5_000);
    vi.stubEnv('VITE_UNILATERAL_EXIT_POLL_SECS', '0');
    expect(pollIntervalMs('regtest')).toBe(5_000);
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
    expect(syncWallet).toHaveBeenCalledTimes(1);
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

    await vi.waitFor(() => expect(getUnilateralExitState().recoveries[0]?.phase).toBe('complete'));
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
    expect(syncWallet).toHaveBeenCalledTimes(1);
  });

  it('keeps a finished exit until what paid it out is read, and archives it on the pass that reads it', async () => {
    const confirmedSpender = vi
      .fn<ChainClient['confirmedSpender']>()
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValue({ txid: 'replacement', blockHeight: 90, outputs: [{ address: 'bc1qdest', value: 29_000 }] });
    const finished = plan([tx({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: confirmed(90) })], {
      network: 'regtest',
      phase: 'complete',
      landed: [{ leafIds: ['c-1'], valueSat: 30_000, outpoint: `${txidOf(7)}:0` }],
    });
    setUnilateralExitPlan(wallet, finished);
    startUnilateralExitEngine(wallet, { ...chain, confirmedSpender }, sdk());
    await vi.waitFor(() => expect(getUnilateralExitState().tipHeight).toBe(100));
    expect(getUnilateralExitState().plan?.phase).toBe('complete');
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
    setUnilateralExitPlan(wallet, plan([tx({ txid: 'a' })], { network: 'regtest', phase: 'redo', needsSignIn: true }));
    startUnilateralExitEngine(wallet, chain, sdk({ checkRecoverFunds }));
    await advanceNow();
    expect(checkRecoverFunds).not.toHaveBeenCalled();
  });

  it('keeps sending the other steps of an exit whose tap waits on a step it could not read', async () => {
    const broadcastPackage = vi.fn(async () => undefined);
    const waiting = plan(
      [tx({ txid: 'stuck', status: { type: 'unverified' } }), tx({ txid: 'due', cpfpTxHex: 'bb', status: ready })],
      { network: 'regtest', needsSignIn: true, redoCause: 'unverified' },
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
    setUnilateralExitPlan(wallet, plan([tx({ txid: 'a' })], { network: 'regtest', phase: 'redo' }));
    startUnilateralExitEngine(wallet, chain, sdk({ checkRecoverFunds, prepareRecoverFunds }));
    await vi.waitFor(() => expect(prepareRecoverFunds).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(getUnilateralExitState().isAdvancing).toBe(false));
    await advanceNow();
    expect(prepareRecoverFunds).toHaveBeenCalledTimes(2);
    expect(getUnilateralExitState().plan?.phase).toBe('redo');
  });
});
