import {
  advanceUnilateralExit,
  applyExitCheck,
  blocksToFinish,
  broadcastReadyTransactions,
  checkExit,
  clearPlan,
  exitStages,
  hasFixedFeeBudget,
  isReady,
  loadPlan,
  nextAction,
  planFromExitResponse,
  requiredFundingOf,
  planProgress,
  quotedSweepFeeSat,
  savePlan,
  willReceiveSat,
} from './driver';
import { blocked, checked, confirmed, locked, plan, prepared, ready, sdk, tx } from './testFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckUnilateralExitRequest, UnilateralExitVerdict } from '@breeztech/breez-sdk-spark';
import type { ChainClient } from '@/services/chain';

const meta = {
  network: 'mainnet',
  destination: 'bc1qdest',
  feeRateSatPerVbyte: 3,
  fundingAddressIndex: 0,
  quotedSweepFeeSat: 200,
};

describe('planFromExitResponse', () => {
  it('keeps the sdk response whole, for the check to read back', () => {
    const exit = checked([{ txid: 'node-1' }], {
      fundingInputs: [{ type: 'p2wpkh', txid: 'fund', vout: 0, value: 50_000, pubkey: '02ab' }],
    });
    const built = planFromExitResponse(exit, meta);
    expect(built.exit).toBe(exit);
    expect(built).toMatchObject({ ...meta, phase: 'active', refusals: {} });
  });
});

describe('applyExitCheck', () => {
  it('takes the sdk word on the whole exit', () => {
    const exit = checked([{ txid: 'a', status: confirmed(812_345) }], { sweepFeeSat: 250 });
    expect(applyExitCheck(plan([tx({ txid: 'a' })]), exit, 'active').exit).toBe(exit);
  });

  it('keeps the refusal on a step that is still out there', () => {
    const next = applyExitCheck(
      plan([tx({ txid: 'a' })], { refusals: { a: 'txn-mempool-conflict' } }),
      checked([{ txid: 'a', status: ready }]),
      'active',
    );
    expect(next.refusals).toEqual({ a: 'txn-mempool-conflict' });
  });

  it('drops the refusal once the step has confirmed, or is no longer in the set', () => {
    const next = applyExitCheck(
      plan([tx({ txid: 'a' }), tx({ txid: 'b' })], { refusals: { a: 'conflict', b: 'conflict' } }),
      checked([{ txid: 'a', status: confirmed(1) }]),
      'active',
    );
    expect(next.refusals).toEqual({});
  });

  it('sets the phase', () => {
    const next = applyExitCheck(plan([tx({ txid: 'a' })]), checked([{ txid: 'a' }]), 'complete');
    expect(next.phase).toBe('complete');
  });
});

describe('storing a plan', () => {
  beforeEach(() => localStorage.clear());

  const wallet = { identityPubkey: '02abcdef0123456789', network: 'mainnet' };
  const key = `recovery-plan:${wallet.identityPubkey.slice(0, 16)}:mainnet`;

  it('returns null when no plan was ever saved', () => {
    expect(loadPlan(wallet)).toBeNull();
  });

  it('round-trips a saved plan', () => {
    const built = plan([tx({ txid: 'a' })]);
    savePlan(wallet, built);
    expect(loadPlan(wallet)).toEqual(built);
  });

  it('keeps plans of different wallets and networks apart', () => {
    savePlan(wallet, plan([tx({ txid: 'a' })]));
    expect(loadPlan({ identityPubkey: '03999999', network: 'mainnet' })).toBeNull();
    expect(loadPlan({ ...wallet, network: 'regtest' })).toBeNull();
  });

  it('forgets a cleared plan', () => {
    savePlan(wallet, plan([tx({ txid: 'a' })]));
    clearPlan(wallet);
    expect(loadPlan(wallet)).toBeNull();
  });

  it('ignores a stored plan of another version', () => {
    localStorage.setItem(key, JSON.stringify({ ...plan([tx({ txid: 'a' })]), version: 3 }));
    expect(loadPlan(wallet)).toBeNull();
  });

  it('ignores unparseable stored data', () => {
    localStorage.setItem(key, '{oops');
    expect(loadPlan(wallet)).toBeNull();
  });
});

// one input, one 596 524 sat output
const sweepHex =
  '0200000001' + '00'.repeat(32) + '00000000' + '00' + 'ffffffff' +
  '01' + '2c1a090000000000' + '160014' + 'ab'.repeat(20) + '00000000';

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

describe('willReceiveSat', () => {
  it('is the balance less the sweep fee: the other fees come out of the funding', () => {
    const quote = prepared({ recoverableValueSat: 600_000, totalFeeSat: 3_122, cpfpFeeSat: 2_907, sweepFeeSat: 215 });
    expect(willReceiveSat(quote)).toBe(599_785);
  });

  it('says the same thing on the quote and on the exit built from it', () => {
    const quote = prepared({ recoverableValueSat: 600_000, totalFeeSat: 3_122, cpfpFeeSat: 2_907, sweepFeeSat: 215 });
    // A fresh build carries no sweep yet, so the sdk reports its fee as zero there.
    const built = planFromExitResponse(
      checked([{ txid: 'r', kind: 'refund' }], { recoverableValueSat: 600_000, sweepFeeSat: 0 }),
      { ...meta, quotedSweepFeeSat: quotedSweepFeeSat(quote, null) },
    );
    expect(willReceiveSat(built)).toBe(willReceiveSat(quote));
    expect(willReceiveSat(built)).toBe(599_785);
  });

  it('does not move when a check or rebuild reprices the exit', () => {
    expect(willReceiveSat(twoLeaves([tx({ txid: 'r', kind: 'refund' })], { exit: { totalFeeSat: 214, sweepFeeSat: 214 } }))).toBe(599_785);
  });

  it('holds a resumed quote to the sweep fee the exit was first quoted at', () => {
    const resuming = twoLeaves([]);
    expect(quotedSweepFeeSat(prepared({ sweepFeeSat: 180 }), resuming)).toBe(215);
    expect(willReceiveSat(prepared({ recoverableValueSat: 600_000, sweepFeeSat: 180 }), resuming)).toBe(599_785);
  });

  it('lets a quote at a higher rate cost more', () => {
    expect(quotedSweepFeeSat(prepared({ sweepFeeSat: 900 }), twoLeaves([]))).toBe(900);
  });

  it('reports what a confirmed sweep actually paid', () => {
    expect(willReceiveSat(twoLeaves([tx({ txid: 's', kind: 'sweep', txHex: sweepHex, status: confirmed(1) })]))).toBe(596_524);
  });

  it('ignores an unconfirmed sweep, which may still be rebuilt', () => {
    expect(willReceiveSat(twoLeaves([tx({ txid: 's', kind: 'sweep', txHex: sweepHex })]))).toBe(599_785);
  });
});

describe('exitStages', () => {
  it('holds everything in Spark before any refund lands', () => {
    const stages = exitStages(
      twoLeaves([tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1' }), tx({ txid: 'r2', kind: 'refund', nodeId: 'leaf-2' })]),
    );
    expect(stages).toMatchObject({ inSpark: 600_000, onChain: 0, delivered: 0 });
  });

  it('counts a leaf as out of Spark once its refund confirms', () => {
    const stages = exitStages(
      twoLeaves([
        tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1', status: confirmed(900) }),
        tx({ txid: 'r2', kind: 'refund', nodeId: 'leaf-2' }),
      ]),
    );
    expect(stages).toMatchObject({ inSpark: 420_000, onChain: 180_000, delivered: 0 });
  });

  it('does not credit a leaf whose refund is only in the mempool', () => {
    expect(exitStages(twoLeaves([tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1', status: ready })])).onChain).toBe(0);
  });

  it('moves everything to the destination once the sweep confirms', () => {
    const stages = exitStages(
      twoLeaves([
        tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1', status: confirmed(900) }),
        tx({ txid: 's', kind: 'sweep', txHex: sweepHex, status: confirmed(900) }),
      ]),
    );
    expect(stages).toEqual({ inSpark: 0, onChain: 0, delivered: 596_524, willReceive: 596_524 });
  });
});

describe('blocksToFinish', () => {
  it('is null once every step has confirmed', () => {
    expect(blocksToFinish([tx({ txid: 'a', status: confirmed(90) })], 100)).toBeNull();
  });

  it('is a block for a single step that can go out now', () => {
    expect(blocksToFinish([tx({ txid: 'a' })], 100)).toBe(1);
  });

  it('uses the height the sdk says a started timelock matures at', () => {
    const parent = tx({ txid: 'p', status: confirmed(100) });
    const refund = tx({ txid: 'r', kind: 'refund', dependsOn: ['p'], csvTimelockBlocks: 2000, status: locked(2100) });
    expect(blocksToFinish([parent, refund], 500)).toBe(1601);
  });

  it('counts the whole timelock while the parent is still unconfirmed', () => {
    const parent = tx({ txid: 'p', status: ready });
    const refund = tx({ txid: 'r', kind: 'refund', dependsOn: ['p'], csvTimelockBlocks: 2000, status: blocked });
    expect(blocksToFinish([parent, refund], 500)).toBe(2002);
  });

  it('follows the longest path rather than the first', () => {
    const parent = tx({ txid: 'p', status: confirmed(100) });
    const quick = tx({ txid: 'q', dependsOn: ['p'], csvTimelockBlocks: 144, status: locked(244) });
    const slow = tx({ txid: 's', dependsOn: ['p'], csvTimelockBlocks: 2000, status: locked(2100) });
    const sweep = tx({ txid: 'w', kind: 'sweep', dependsOn: ['q', 's'], status: blocked });
    expect(blocksToFinish([parent, quick, slow, sweep], 100)).toBe(2002);
  });

  it('reports the sweep alone once the refunds are in', () => {
    const refund = tx({ txid: 'r', kind: 'refund', status: confirmed(50) });
    const sweep = tx({ txid: 'w', kind: 'sweep', dependsOn: ['r'], status: ready });
    expect(blocksToFinish([refund, sweep], 60)).toBe(1);
  });
});

const chain = (over: Partial<ChainClient> = {}): ChainClient => ({
  feeRates: async () => ({ slow: 1, medium: 2, fast: 3 }),
  addressUtxos: async () => [],
  tipHeight: async () => 100,
  broadcast: async () => undefined,
  broadcastPackage: async () => undefined,
  ...over,
});

const redo: UnilateralExitVerdict = { type: 'redo', reason: 'onChainStateDiverged' };

const checking = (exit: ReturnType<typeof checked>, verdict: UnilateralExitVerdict = { type: 'valid' }) =>
  sdk({ checkUnilateralExit: async () => ({ exit, verdict }) });

describe('broadcastReadyTransactions', () => {
  it('sends a package when the step has a cpfp child', async () => {
    const broadcastPackage = vi.fn(async () => undefined);
    await broadcastReadyTransactions(plan([tx({ txid: 'a', cpfpTxHex: 'bb' })]), chain({ broadcastPackage }));
    expect(broadcastPackage).toHaveBeenCalledWith('aa', 'bb');
  });

  it('leaves a step the sdk is still waiting on alone', async () => {
    const broadcast = vi.fn(async () => undefined);
    await broadcastReadyTransactions(plan([tx({ txid: 'a', status: blocked })]), chain({ broadcast }));
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('sends a ready step on every pass, so one the mempool dropped is put back', async () => {
    const broadcast = vi.fn(async () => undefined);
    const client = chain({ broadcast });
    const once = await broadcastReadyTransactions(plan([tx({ txid: 'a' })]), client);
    await broadcastReadyTransactions(once, client);
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('keeps a refusal on the step without giving up on it', async () => {
    const client = chain({
      broadcast: async () => {
        throw new Error('bad-txns-inputs-missingorspent');
      },
    });
    const after = await broadcastReadyTransactions(plan([tx({ txid: 'a' })]), client);
    expect(after.refusals.a).toMatch(/missingorspent/);
    expect(isReady(after.exit.transactions[0])).toBe(true);
  });

  it('clears the refusal once the network takes the step', async () => {
    const after = await broadcastReadyTransactions(plan([tx({ txid: 'a' })], { refusals: { a: 'min relay fee not met' } }), chain());
    expect(after.refusals).toEqual({});
  });
});

describe('advanceUnilateralExit', () => {
  // A rebuild derives the fee key from the phrase the wallet is unlocked with.
  beforeEach(() => {
    localStorage.setItem(
      'walletMnemonic',
      'legal winner thank year wave sausage worth useful legal winner thank yellow',
    );
  });

  it('adopts what the check found on-chain, so a step settled elsewhere counts as done', async () => {
    const { plan: next } = await advanceUnilateralExit(
      plan([tx({ txid: 'refund', kind: 'refund' })]),
      chain(),
      checking(checked([{ txid: 'refund', kind: 'refund', status: confirmed(812_345) }])),
    );
    expect(next.exit.transactions[0].status).toEqual({ type: 'confirmed', blockHeight: 812_345 });
  });

  it('finishes the exit on the done verdict', async () => {
    const { plan: next } = await advanceUnilateralExit(
      plan([tx({ txid: 's', kind: 'sweep' })]),
      chain(),
      checking(checked([{ txid: 's', kind: 'sweep', status: confirmed(9) }]), { type: 'done' }),
    );
    expect(next.phase).toBe('complete');
  });

  it('stops sending once the chain has diverged and nothing can be rebuilt', async () => {
    const broadcast = vi.fn(async () => undefined);
    const { plan: next } = await advanceUnilateralExit(
      plan([tx({ txid: 'a' })]),
      chain({ broadcast }),
      checking(checked([{ txid: 'a' }]), redo),
      '02abc',
    );
    expect(next.phase).toBe('redo');
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('rebuilds itself when the chain diverges, rather than waiting on the user', async () => {
    const driver = sdk({
      checkUnilateralExit: async () => ({ exit: checked([{ txid: 'a' }]), verdict: redo }),
      prepareUnilateralExit: async () => prepared(),
      unilateralExit: async () => checked([{ txid: 'fresh', status: ready }]),
    });
    const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), driver, '02abc');
    expect(next.phase).toBe('active');
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['fresh']);
  });

  it('names the leaves it is rebuilding rather than letting them be reselected', async () => {
    const prepareUnilateralExit = vi.fn(async () => prepared());
    const driver = sdk({
      checkUnilateralExit: async () => ({ exit: checked([{ txid: 'a' }]), verdict: redo }),
      prepareUnilateralExit,
      unilateralExit: async () => checked([{ txid: 'fresh', status: ready }]),
    });
    await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), driver, '02abc');
    expect(prepareUnilateralExit).toHaveBeenCalledWith(
      expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-1'] } }),
    );
  });

  it('hands the funding it was built from back, for the sdk to follow', async () => {
    const unilateralExit = vi.fn(async () => checked([{ txid: 'fresh', status: ready }]));
    const funding = [{ type: 'p2wpkh' as const, txid: 'f', vout: 0, value: 40_000, pubkey: '02ab' }];
    const driver = sdk({
      checkUnilateralExit: async () => ({ exit: checked([{ txid: 'a' }], { fundingInputs: funding }), verdict: redo }),
      prepareUnilateralExit: async () => prepared(),
      unilateralExit,
    });
    await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), driver, '02abc');
    expect(unilateralExit).toHaveBeenCalledWith(expect.objectContaining({ fundingInputs: funding }), expect.anything());
  });

  it('keeps the sweep fee the exit was first quoted at across a rebuild', async () => {
    const driver = sdk({
      checkUnilateralExit: async () => ({ exit: checked([{ txid: 'a' }]), verdict: redo }),
      prepareUnilateralExit: async () => prepared({ sweepFeeSat: 180 }),
      unilateralExit: async () => checked([{ txid: 'fresh', status: ready }], { sweepFeeSat: 180 }),
    });
    const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })], { quotedSweepFeeSat: 215 }), chain(), driver, '02abc');
    expect(next.quotedSweepFeeSat).toBe(215);
    expect(next.exit.sweepFeeSat).toBe(180);
  });

  it('waits for the user rather than prompting for a passkey in the background', async () => {
    // A wallet that keeps no phrase on the device: the rebuild needs a
    // ceremony, which only a button press can ask for.
    localStorage.removeItem('walletMnemonic');
    localStorage.setItem('passkeyLabel', 'Default');
    const { plan: next } = await advanceUnilateralExit(
      plan([tx({ txid: 'a' })]),
      chain(),
      checking(checked([{ txid: 'a' }]), redo),
      '02abc',
    );
    expect(next.phase).toBe('redo');
    localStorage.removeItem('passkeyLabel');
  });

  it('leaves the exit for the user to rebuild when it cannot do it unattended', async () => {
    const driver = sdk({
      checkUnilateralExit: async () => ({ exit: checked([{ txid: 'a' }]), verdict: redo }),
      prepareUnilateralExit: async () => {
        throw new Error('no recovery phrase on this device');
      },
    });
    const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), driver, '02abc');
    expect(next.phase).toBe('redo');
  });

  it('keeps going on the set it holds when the check fails', async () => {
    const failing = sdk({
      checkUnilateralExit: async () => {
        throw new Error('sdk unavailable');
      },
    });
    const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), failing);
    expect(next.exit.transactions).toHaveLength(1);
  });

  it('sends nothing once the exit is complete', async () => {
    const broadcast = vi.fn(async () => undefined);
    await advanceUnilateralExit(
      plan([tx({ txid: 's', kind: 'sweep', status: confirmed(9) })], { phase: 'complete' }),
      chain({ broadcast }),
    );
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('checkExit', () => {
  it('hands the sdk the exit it stored, untouched', async () => {
    const stored = plan([tx({ txid: 'a', cpfpTxHex: 'bb', dependsOn: ['x'] })], { refusals: { a: 'refused' } });
    const checkUnilateralExit = vi.fn(async (_request: CheckUnilateralExitRequest) => ({
      exit: checked([{ txid: 'a' }]),
      verdict: { type: 'valid' as const },
    }));
    await checkExit(stored, sdk({ checkUnilateralExit }));
    expect(checkUnilateralExit.mock.calls[0][0].exit).toBe(stored.exit);
  });

  it.each([
    [{ type: 'valid' } as const, 'active'],
    [{ type: 'done' } as const, 'complete'],
    [redo, 'redo'],
  ])('turns the %o verdict into the %s phase', async (verdict, phase) => {
    expect((await checkExit(plan([tx({ txid: 'a' })]), checking(checked([{ txid: 'a' }]), verdict))).phase).toBe(phase);
  });
});

describe('isReady', () => {
  it('takes the sdk word that a step can go out now', () => {
    expect(isReady(tx({ txid: 'a', status: ready }))).toBe(true);
  });

  it('holds a step back while the sdk is waiting on something', () => {
    expect(isReady(tx({ txid: 'a', status: blocked }))).toBe(false);
    expect(isReady(tx({ txid: 'b', status: locked(244) }))).toBe(false);
    expect(isReady(tx({ txid: 'c', status: { type: 'unverified' } }))).toBe(false);
    expect(isReady(tx({ txid: 'd', status: confirmed(90) }))).toBe(false);
  });
});

describe('planProgress', () => {
  it('counts confirmed transactions against the total', () => {
    const p = plan([tx({ txid: 'a', status: confirmed(1) }), tx({ txid: 'b' }), tx({ txid: 'c' })]);
    expect(planProgress(p)).toEqual({ confirmed: 1, total: 3, isComplete: false });
  });

  it('is complete on the sdk done verdict', () => {
    const p = plan([tx({ txid: 's', kind: 'sweep', status: confirmed(2) })], { phase: 'complete' });
    expect(planProgress(p).isComplete).toBe(true);
  });

  it('is not complete just because every step confirmed, without a verdict to say so', () => {
    expect(planProgress(plan([tx({ txid: 'n', status: confirmed(1) })])).isComplete).toBe(false);
  });

  it('is not complete when the exit has to be rebuilt', () => {
    expect(planProgress(plan([tx({ txid: 'a' })], { phase: 'redo' })).isComplete).toBe(false);
  });
});

describe('nextAction', () => {
  it('treats a ready step as already on its way, not as something to wait for', () => {
    expect(nextAction([tx({ txid: 'c', status: ready })], 20)).toBeNull();
  });

  it('waits on the soonest timelock, and says how many it releases', () => {
    const all = [
      tx({ txid: 's', status: locked(2100) }),
      tx({ txid: 'f', status: locked(244) }),
      tx({ txid: 'g', status: locked(244) }),
    ];
    expect(nextAction(all, 100)).toEqual({ blocks: 144, transactions: 2 });
  });

  it('reports no wait once the tip has passed the spendable height', () => {
    expect(nextAction([tx({ txid: 'c', status: locked(100) })], 244)).toEqual({ blocks: 0, transactions: 1 });
  });

  it('is null when nothing is left to do', () => {
    expect(nextAction([tx({ txid: 'a', status: confirmed(1) })], 100)).toBeNull();
  });

  it('ignores transactions blocked behind an unconfirmed parent', () => {
    expect(nextAction([tx({ txid: 'p' }), tx({ txid: 'c', status: blocked })], 100)).toBeNull();
  });

  it('ignores a timelock whose starting height could not be read', () => {
    expect(nextAction([tx({ txid: 'c', status: locked() })], 100)).toBeNull();
  });
});

describe('requiredFundingOf', () => {
  it("reads the amount out of the sdk's shortfall error", () => {
    expect(requiredFundingOf('Insufficient CPFP funding: need at least 5898 sats')).toBe(5898);
  });

  it('is null for any other failure', () => {
    expect(requiredFundingOf('signing failed')).toBeNull();
  });
});

describe('hasFixedFeeBudget', () => {
  it('holds once the fan-out that splits the exit fee has confirmed', () => {
    expect(hasFixedFeeBudget(plan([tx({ txid: 'f', kind: 'fanOut', status: confirmed(10) })]))).toBe(true);
  });

  it('does not while the fan-out is still to confirm, or there is none', () => {
    expect(hasFixedFeeBudget(plan([tx({ txid: 'f', kind: 'fanOut' })]))).toBe(false);
    expect(hasFixedFeeBudget(plan([tx({ txid: 'n', kind: 'node', status: confirmed(10) })]))).toBe(false);
  });
});
