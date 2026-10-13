import { buildLeftover, isStalled, releaseDue, retryDue } from './leftovers';
import { planFromBuild, RebuildLaterError } from './building';
import { leftoverTopUp } from './exitFee';
import { deriveFundingKey, MnemonicUnavailableError } from './funding';
import { asKeptRecovery, isLanded, leftoverIdsOf, topUpOf, type Landing, type UnilateralExitPlan } from './model/plan';
import { exitStages, planProgress } from './model/progress';
import { advanceUnilateralExit } from './pass';
import { willReceiveSat } from './quote';
import type { ExitSdk } from './quoting';
import { rebuildExit } from './rebuild';
import { recoveryTxid } from './storage/archive';
import {
  blocked,
  checked,
  chain,
  coin as feeCoin,
  confirmed,
  funding,
  locked,
  MNEMONIC,
  plan,
  prepared,
  rawTx,
  ready,
  sdk,
  tx,
  txidOf,
} from './testFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecoveryTransaction, SkippedLeafReason } from '@breeztech/breez-sdk-spark';
import { logger } from '@/services/logger';

describe('a co-signed recovery stuck unverified', () => {
  const unverified = { type: 'unverified' } as const;
  const stuckHex = rawTx([`${txidOf(7)}:0`], [29_000]);
  const freshHex = rawTx([`${txidOf(8)}:1`], [28_500]);
  const coLeaf = (leafId: string) => ({ leafId, valueSats: 30_000, method: 'cooperative' as const });
  const stuckTx = (over: Partial<Parameters<typeof tx>[0]> = {}) =>
    tx({ txid: 'c-old', kind: 'cooperative', nodeId: 'c-2', txHex: stuckHex, status: unverified, ...over });
  // A swept leaf and a co-signed one landed; the second co-signed one is stuck.
  const exit = (over: Parameters<typeof plan>[1] = {}) =>
    plan(
      [
        tx({ txid: 'refund', kind: 'refund', nodeId: 'leaf-1', status: confirmed(90) }),
        tx({ txid: 'sweep', kind: 'sweep', dependsOn: ['refund'], status: confirmed(91) }),
        tx({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: confirmed(90) }),
        stuckTx(),
      ],
      {
        feeRateSatPerVbyte: 4,
        destination: 'bc1qmine',
        quotedSweepFeeSat: 2_200,
        retrySince: 94,
        namedLeaves: [
          { leafId: 'leaf-1', valueSats: 100_000 },
          { leafId: 'c-1', valueSats: 30_000 },
          { leafId: 'c-2', valueSats: 30_000 },
        ],
        ...over,
        exit: {
          leaves: [{ leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' }, coLeaf('c-1'), coLeaf('c-2')],
          recoverableValueSats: 160_000,
          ...over.exit,
        },
      },
    );
  const quoteFor = (over: Parameters<typeof prepared>[0] = {}) =>
    prepared({ leaves: [coLeaf('c-2')], funding: undefined, feeRateSatPerVbyte: 4, destination: 'bc1qmine', ...over });
  const builtAs = (txid: string, txHex: string) =>
    checked([{ txid, kind: 'cooperative', nodeId: 'c-2', txHex, status: unverified }], { leaves: [coLeaf('c-2')] });
  const skipping = (reason: SkippedLeafReason) => quoteFor({ leaves: [], skipped: [{ leafId: 'c-2', valueSats: 30_000, reason }] });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('walletMnemonic', MNEMONIC);
  });

  describe('its retry clock', () => {
    it('starts the first pass that reads one unverified, and keeps that height', async () => {
      const prepareRecoverFunds = vi.fn(async () => quoteFor());
      const started = await advanceUnilateralExit(exit({ retrySince: undefined }), chain(), sdk({ prepareRecoverFunds }));
      expect(started.plan.retrySince).toBe(100);
      const kept = await advanceUnilateralExit(exit({ retrySince: 95 }), chain(), sdk({ prepareRecoverFunds }));
      expect(kept.plan.retrySince).toBe(95);
      expect(prepareRecoverFunds).not.toHaveBeenCalled();
    });

    it('stops once the check finds its input in a block', async () => {
      const inBlock = sdk({
        checkRecoverFunds: async ({ recovery }) => ({
          recovery: { ...recovery, transactions: recovery.transactions.map(t => (t.txid === 'c-old' ? { ...t, status: ready } : t)) },
          verdict: { type: 'valid' },
        }),
      });
      const { plan: next } = await advanceUnilateralExit(exit({ retrySince: 90, retriedAt: 96 }), chain(), inBlock);
      expect(next.retrySince).toBeUndefined();
      expect(next.retriedAt).toBeUndefined();
    });

    it('does not start on a pass whose check failed', async () => {
      const failing = sdk({
        checkRecoverFunds: async () => {
          throw new Error('chain service unavailable');
        },
      });
      expect((await advanceUnilateralExit(exit({ retrySince: undefined }), chain(), failing)).plan.retrySince).toBeUndefined();
    });

    it('makes a retry due six blocks after it starts, then at doubling gaps up to a day', () => {
      const at = (retriedAt: number | undefined, tip: number) => retryDue(exit({ retrySince: 100, retriedAt }), tip);
      expect([at(undefined, 105), at(undefined, 106)]).toEqual([false, true]);
      expect([at(106, 111), at(106, 112)]).toEqual([false, true]);
      expect([at(112, 123), at(112, 124)]).toEqual([false, true]);
      expect([at(1_000, 1_143), at(1_000, 1_144)]).toEqual([false, true]);
      expect(retryDue(exit({ retrySince: undefined }), 10_000)).toBe(false);
    });

    it('lets go after about a week', () => {
      expect(releaseDue(exit({ retrySince: 100 }), 1_107)).toBe(false);
      expect(releaseDue(exit({ retrySince: 100 }), 1_108)).toBe(true);
      expect(releaseDue(exit({ retrySince: undefined }), 10_000)).toBe(false);
    });
  });

  describe('as a stall', () => {
    it('is one only when all that is open is co-signed recoveries stuck unverified', () => {
      expect(isStalled(exit())).toBe(true);
      const beside = (open: RecoveryTransaction) => exit({ exit: { transactions: [...exit().exit.transactions, open] } });
      expect(isStalled(beside(tx({ txid: 'refund-2', kind: 'refund', nodeId: 'leaf-3', status: locked(900) })))).toBe(false);
      expect(isStalled(exit({ exit: { transactions: [stuckTx({ status: ready })] } }))).toBe(false);
    });

    it('is not one while what landed waits on a read, or once it is complete', () => {
      expect(isStalled(exit({ landed: [{ leafIds: ['c-1'], valueSat: 30_000, outpoint: `${txidOf(6)}:0` }] }))).toBe(false);
      expect(isStalled(exit({ status: { type: 'done' } }))).toBe(false);
    });
  });

  it("prepares only the stuck leaf again by name, at the plan's rate and destination, and swaps the new recovery in place", async () => {
    const prepareRecoverFunds = vi.fn(async () => quoteFor());
    const recoverFunds = vi.fn(async () => builtAs('c-new', freshHex));
    const broadcast = vi.fn(async () => undefined);
    const before = exit();
    const { plan: next } = await advanceUnilateralExit(before, chain({ broadcast }), sdk({ prepareRecoverFunds, recoverFunds }));

    expect(prepareRecoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ feeRateSatPerVbyte: 4, destination: 'bc1qmine', selection: { type: 'specific', leafIds: ['c-2'] } }),
    );
    expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: expect.anything() }]);
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['refund', 'sweep', 'c1', 'c-new']);
    expect(next.exit.transactions.slice(0, 3)).toEqual(before.exit.transactions.slice(0, 3));
    expect(next.exit.leaves).toEqual(before.exit.leaves);
    expect(next.exit.recoverableValueSats).toBe(160_000);
    // The new recovery pays 500 less than the stuck one.
    expect(next.quotedSweepFeeSat).toBe(2_700);
    expect(next).toMatchObject({ status: { type: 'running' }, retrySince: 94, retriedAt: 100 });
    expect(broadcast).toHaveBeenCalledWith(freshHex);
  });

  it('keeps the plan as it stands, and paces the next try, when the SDK hands back the same transaction', async () => {
    const before = exit();
    const driver = sdk({ prepareRecoverFunds: async () => quoteFor(), recoverFunds: async () => builtAs('c-old', stuckHex) });
    const { plan: next } = await advanceUnilateralExit(before, chain(), driver);
    expect(next.exit).toEqual(before.exit);
    expect(next.quotedSweepFeeSat).toBe(2_200);
    expect(next.retriedAt).toBe(100);
  });

  it.each([{ type: 'unverified' }, { type: 'fundsNotFound' }] satisfies SkippedLeafReason[])(
    'keeps the stuck recovery while the quote skips its leaf for now ($type)',
    async reason => {
      const recoverFunds = vi.fn(async () => builtAs('c-new', freshHex));
      const { plan: next } = await advanceUnilateralExit(exit(), chain(), sdk({ prepareRecoverFunds: async () => skipping(reason), recoverFunds }));
      expect(recoverFunds).not.toHaveBeenCalled();
      expect(next.exit).toEqual(exit().exit);
      expect(next.retriedAt).toBe(100);
    },
  );

  it('keeps the stuck recovery, and paces the next try, when the operators do not co-sign the new one', async () => {
    const failed = [{ leafId: 'c-2', outputTxid: txidOf(8), outputVout: 1, error: { type: 'generic' as const, message: 'refused' } }];
    const driver = sdk({ prepareRecoverFunds: async () => quoteFor(), recoverFunds: async () => checked([], { failed }) });
    const { plan: next } = await advanceUnilateralExit(exit(), chain(), driver);
    expect(next.exit).toEqual(exit().exit);
    expect(next.retriedAt).toBe(100);
  });

  it('keeps the stuck recovery, and paces the next try, when the quote fails', async () => {
    const failing = sdk({
      prepareRecoverFunds: async () => {
        throw new Error('operators unreachable');
      },
    });
    const { plan: next } = await advanceUnilateralExit(exit(), chain(), failing);
    expect(next.exit).toEqual(exit().exit);
    expect(next.retriedAt).toBe(100);
  });

  it('takes a leaf the quote finds unrecoverable out of the exit, and hides it from then on', async () => {
    const driver = sdk({ prepareRecoverFunds: async () => skipping({ type: 'notRecoverable', message: 'paid elsewhere' }) });
    const { plan: next } = await advanceUnilateralExit(exit(), chain(), driver);
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['refund', 'sweep', 'c1']);
    expect(next.exit.leaves.map(leaf => leaf.leafId)).toEqual(['leaf-1', 'c-1']);
    expect(next.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['leaf-1', 'c-1']);
    expect(next.exit.recoverableValueSats).toBe(130_000);
    expect(next.quotedSweepFeeSat).toBe(1_200);
    expect(next.droppedLeaves).toEqual([{ leafId: 'c-2', valueSats: 30_000 }]);
    expect(next.status).toEqual({ type: 'running' });
  });

  it("takes a leaf too dear at the exit's rate out of the exit, still offering it as Recoverable Funds", async () => {
    const driver = sdk({ prepareRecoverFunds: async () => skipping({ type: 'feeExceedsValue' }) });
    const { plan: next } = await advanceUnilateralExit(exit(), chain(), driver);
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['refund', 'sweep', 'c1']);
    expect(next.exit.recoverableValueSats).toBe(130_000);
    expect(next.droppedLeaves).toBeUndefined();
  });

  it('takes a leaf the quote names nowhere out of the exit, recording it as waiting on what spent its input', async () => {
    const { plan: next } = await advanceUnilateralExit(exit(), chain(), sdk({ prepareRecoverFunds: async () => quoteFor({ leaves: [] }) }));
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['refund', 'sweep', 'c1']);
    expect(next.landed).toEqual([expect.objectContaining({ leafIds: ['c-2'], valueSat: 30_000, outpoint: `${txidOf(7)}:0` })]);
    expect(next.droppedLeaves).toBeUndefined();
  });

  it('finishes a recovery left with nothing once its only leaf is taken out', async () => {
    const lone = plan([stuckTx()], { mode: 'recover', retrySince: 94, exit: { leaves: [coLeaf('c-2')], recoverableValueSats: 30_000 } });
    const driver = sdk({ prepareRecoverFunds: async () => skipping({ type: 'notRecoverable', message: 'paid elsewhere' }) });
    const { plan: next } = await advanceUnilateralExit(lone, chain(), driver);
    expect(next.status).toEqual({ type: 'done' });
    expect(next.exit.transactions).toEqual([]);
  });

  it('lets a leaf still stuck after about a week go, without hiding it, so the exit can finish', async () => {
    const prepareRecoverFunds = vi.fn(async () => quoteFor());
    const late = chain({ tipHeight: async () => 1_102 });
    const { plan: next } = await advanceUnilateralExit(exit(), late, sdk({ prepareRecoverFunds }));
    expect(prepareRecoverFunds).not.toHaveBeenCalled();
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['refund', 'sweep', 'c1']);
    expect(next.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['leaf-1', 'c-1']);
    expect(next.droppedLeaves).toBeUndefined();
    expect(next.retrySince).toBeUndefined();

    const lone = plan([stuckTx()], { mode: 'recover', retrySince: 94, exit: { leaves: [coLeaf('c-2')] } });
    expect((await advanceUnilateralExit(lone, late, sdk())).plan.status).toEqual({ type: 'done' });
  });

  it('retries mid-exit without the phrase, while unilateral steps wait', async () => {
    localStorage.removeItem('walletMnemonic');
    localStorage.setItem('passkeyLabel', 'Default');
    const prepareRecoverFunds = vi.fn(async () => quoteFor());
    const midway = plan(
      [tx({ txid: 'refund', kind: 'refund', nodeId: 'leaf-1', status: locked(900) }), stuckTx()],
      { feeRateSatPerVbyte: 4, destination: 'bc1qmine', retrySince: 94, exit: { leaves: [coLeaf('c-2')] } },
    );
    const driver = sdk({ prepareRecoverFunds, recoverFunds: async () => builtAs('c-new', freshHex) });
    const { plan: next } = await advanceUnilateralExit(midway, chain(), driver, '02abc');
    expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
    expect(prepareRecoverFunds).toHaveBeenCalledWith(expect.objectContaining({ selection: { type: 'specific', leafIds: ['c-2'] } }));
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['refund', 'c-new']);
    expect(next.exit.transactions[0]).toEqual(midway.exit.transactions[0]);
    expect(next.status).toEqual({ type: 'running' });
    localStorage.removeItem('passkeyLabel');
  });

  it('prepares nothing again in a pass that rebuilt the exit', async () => {
    const prepareRecoverFunds = vi.fn(async () => quoteFor({ leaves: [{ leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' }] }));
    const both = plan([tx({ txid: 'node', status: unverified }), stuckTx()], {
      retrySince: 90,
      exit: { leaves: [{ leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' }, coLeaf('c-2')] },
    });
    const driver = sdk({ prepareRecoverFunds, recoverFunds: async () => checked([{ txid: 'fresh' }]) });
    const { plan: next } = await advanceUnilateralExit(both, chain(), driver, '02abc');
    expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
    expect(prepareRecoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-1', 'c-2'] } }),
    );
    expect(next.retriedAt).toBeUndefined();
  });

  it('carries the leaves it dropped and its clock across a rebuild', () => {
    const resuming = exit({ retriedAt: 98, droppedLeaves: [{ leafId: 'gone', valueSats: 700 }] });
    const next = planFromBuild(quoteFor(), builtAs('c-2-again', freshHex), resuming, { network: 'mainnet', fundingAddressIndex: 0 });
    expect(next).toMatchObject({ retrySince: 94, retriedAt: 98, droppedLeaves: [{ leafId: 'gone', valueSats: 700 }] });
  });
});

describe('a leaf the exit left out', () => {
  const key = deriveFundingKey(MNEMONIC, 'mainnet', 0);
  const stored = { type: 'p2wpkh' as const, txid: 'f', vout: 0, valueSats: 5_000, pubkey: key.publicKeyHex };
  const coLeaf = { leafId: 'c-9', valueSats: 30_000, method: 'cooperative' as const };
  const soloLeaf = { leafId: 'leaf-2', valueSats: 50_000, method: 'unilateral' as const };
  const failure = { leafId: 'c-9', outputTxid: txidOf(5), outputVout: 2, error: { type: 'generic' as const, message: 'refused' } };
  const sweepTx = (status: RecoveryTransaction['status']) =>
    tx({ txid: 'sweep', kind: 'sweep', txHex: rawTx([`${txidOf(1)}:0`], [99_000]), dependsOn: [txidOf(1)], status });
  const sweepEntry: Landing = { leafIds: ['leaf-1'], valueSat: 100_000, txid: 'sweep', paidSat: 99_000, blockHeight: 91 };
  // leaf-1 swept; c-9's co-signing failed and leaf-2 waited on the chain when it was built.
  const exit = (sweep: RecoveryTransaction['status'] = ready, over: Parameters<typeof plan>[1] = {}) =>
    plan([tx({ txid: txidOf(1), kind: 'refund', nodeId: 'leaf-1', status: confirmed(90) }), sweepTx(sweep)], {
      feeRateSatPerVbyte: 4,
      destination: 'bc1qmine',
      quotedSweepFeeSat: 1_000,
      quotedExitFeeSat: 5_000,
      exitFeeAddress: key.address,
      exitStateSnapshot: 'frozen',
      namedLeaves: [
        { leafId: 'leaf-1', valueSats: 100_000 },
        { leafId: 'c-9', valueSats: 30_000 },
        { leafId: 'leaf-2', valueSats: 50_000 },
      ],
      ...over,
      exit: { fundingInputs: [stored], failed: [failure], ...over.exit },
    });
  /** Landed and checked before: the sweep is in the ledger. */
  const landedExit = (over: Parameters<typeof plan>[1] = {}) =>
    exit(confirmed(91), { landed: [sweepEntry], retrySince: 100, retriedAt: 100, ...over });
  // Whatever it is handed, every transaction in a block.
  const done = (over: Partial<ExitSdk> = {}) =>
    sdk({
      checkRecoverFunds: async ({ recovery }) => ({
        recovery: { ...recovery, transactions: recovery.transactions.map(t => ({ ...t, status: t.status.type === 'confirmed' ? t.status : confirmed(91) })) },
        verdict: { type: 'done' },
      }),
      ...over,
    });
  const quoting = (...quotes: ReturnType<typeof prepared>[]) => {
    const fn = vi.fn<ExitSdk['prepareRecoverFunds']>();
    quotes.forEach(q => fn.mockResolvedValueOnce(q));
    return fn.mockResolvedValue(quotes[quotes.length - 1]);
  };
  const leftoverQuote = (over: Parameters<typeof prepared>[0] = {}) =>
    prepared({ leaves: [coLeaf], funding: undefined, feeRateSatPerVbyte: 4, destination: 'bc1qmine', ...over });
  const cosignedBuild = () =>
    checked([{ txid: 'c9', kind: 'cooperative', nodeId: 'c-9', txHex: rawTx([`${txidOf(5)}:2`], [29_000]), status: { type: 'unverified' } }], {
      leaves: [coLeaf],
    });
  const passkeyWallet = () => {
    localStorage.removeItem('walletMnemonic');
    localStorage.setItem('passkeyLabel', 'Default');
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('walletMnemonic', MNEMONIC);
  });

  it('names what no build holds as a leftover', () => {
    expect(leftoverIdsOf(exit())).toEqual(['c-9', 'leaf-2']);
    expect(leftoverIdsOf(plan([tx({ txid: 'a' })], { exit: { failed: [failure] } }))).toEqual(['c-9']);
    expect(isLanded(exit().exit)).toBe(false);
    expect(isLanded(landedExit().exit)).toBe(true);
  });

  it("stays part of the exit on the done verdict, which covers only the set, and is tried at once by name at the plan's rate and destination", async () => {
    const prepareRecoverFunds = quoting(leftoverQuote({ leaves: [], skipped: [{ ...coLeaf, reason: { type: 'unverified' } }, { ...soloLeaf, reason: { type: 'fundsNotFound' } }] }));
    const importUnilateralExitState = vi.fn(sdk().importUnilateralExitState);
    const { plan: next } = await advanceUnilateralExit(exit(ready, { retrySince: 10, retriedAt: 50 }), chain(), done({ prepareRecoverFunds, importUnilateralExitState }), '02abc');

    expect(prepareRecoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ feeRateSatPerVbyte: 4, destination: 'bc1qmine', selection: { type: 'specific', leafIds: ['c-9', 'leaf-2'] } }),
    );
    expect(importUnilateralExitState).toHaveBeenCalledWith({ exitState: 'frozen' });
    expect(importUnilateralExitState.mock.invocationCallOrder[0]).toBeLessThan(prepareRecoverFunds.mock.invocationCallOrder[0]);
    // The set just landed, so the clock starts over.
    expect(next).toMatchObject({ status: { type: 'running' }, retrySince: 100, retriedAt: 100 });
    expect(next.landed).toEqual([sweepEntry]);
  });

  it('lets a kept recovery with a failed leaf finish on the done verdict, since it names none as a leftover', async () => {
    const kept = asKeptRecovery(
      plan([tx({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: ready })], {
        mode: 'recover',
        exit: { leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }], failed: [failure] },
      }),
    );
    const prepareRecoverFunds = vi.fn(async () => leftoverQuote());
    const { plan: next } = await advanceUnilateralExit(kept, chain(), done({ prepareRecoverFunds }));
    expect(next.status).toEqual({ type: 'done' });
    expect(prepareRecoverFunds).not.toHaveBeenCalled();
  });

  it('builds a co-signed leftover into the same plan, with no inputs, no signer and no phrase read', async () => {
    passkeyWallet();
    const recoverFunds = vi.fn(async () => cosignedBuild());
    const broadcast = vi.fn(async () => undefined);
    const prepareRecoverFunds = quoting(leftoverQuote({ skipped: [{ ...soloLeaf, reason: { type: 'unverified' } }] }));
    const { plan: next } = await advanceUnilateralExit(exit(), chain({ broadcast }), done({ prepareRecoverFunds, recoverFunds }), '02abc');

    expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: expect.anything() }]);
    expect(next.exit.transactions.map(t => t.txid)).toEqual([txidOf(1), 'sweep', 'c9']);
    expect(next.exit.leaves.map(leaf => leaf.leafId)).toEqual(['leaf-1', 'c-9']);
    expect(next.exit.recoverableValueSats).toBe(130_000);
    expect(next.exit.failed).toEqual([]);
    // The recovery pays 1 000 less than its leaf.
    expect(next.quotedSweepFeeSat).toBe(2_000);
    expect(recoveryTxid(next)).toBe('sweep');
    expect(next.landed).toEqual([sweepEntry]);
    expect(leftoverIdsOf(next)).toEqual(['leaf-2']);
    expect(next.status).toEqual({ type: 'running' });
    expect(broadcast).toHaveBeenCalledWith(cosignedBuild().transactions[0].txHex);
    localStorage.removeItem('passkeyLabel');
  });

  it('counts a co-signed leftover at its value less its estimated fee, so building it moves neither the amount nor the total', async () => {
    const start = exit(ready, { namedLeaves: [{ leafId: 'leaf-1', valueSats: 100_000 }, { leafId: 'c-9', valueSats: 30_000, feeSat: 1_000 }] });
    const recoverFunds = vi.fn(async () => cosignedBuild());
    const { plan: next } = await advanceUnilateralExit(start, chain(), done({ prepareRecoverFunds: quoting(leftoverQuote()), recoverFunds }), '02abc');
    const total = ({ inSpark, onChain, delivered }: ReturnType<typeof exitStages>) => inSpark + onChain + delivered;

    expect(recoverFunds).toHaveBeenCalledTimes(1);
    expect(leftoverIdsOf(next)).toEqual([]);
    // The recovery pays 29 000, which the estimate already counted.
    expect(willReceiveSat(start)).toBe(128_000);
    expect(willReceiveSat(next)).toBe(128_000);
    expect(total(exitStages(start))).toBe(130_000);
    expect(total(exitStages(next))).toBe(130_000);
  });

  it("quotes a mixed leftover's co-signed leaves again on their own, and asks for the fee only once the rest has landed", async () => {
    const mixed = leftoverQuote({ leaves: [coLeaf, soloLeaf], funding: funding(3_000) });
    const run = async (start: UnilateralExitPlan, driver: (over: Partial<ExitSdk>) => ExitSdk) => {
      const prepareRecoverFunds = quoting(mixed, leftoverQuote());
      const recoverFunds = vi.fn(async () => cosignedBuild());
      const { plan: next } = await advanceUnilateralExit(start, chain(), driver({ prepareRecoverFunds, recoverFunds }), '02abc');
      expect(prepareRecoverFunds).toHaveBeenLastCalledWith(expect.objectContaining({ selection: { type: 'specific', leafIds: ['c-9'] } }));
      expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: leftoverQuote() }]);
      expect(leftoverIdsOf(next)).toEqual(['leaf-2']);
      return next;
    };

    const landing = await run(exit(), done);
    expect(topUpOf(landing)).toEqual({ required: { sat: 3_000, inputs: 1 }, heldSat: 0 });

    const midway = await run(exit(locked(900), { retrySince: 94 }), sdk);
    expect(topUpOf(midway)).toBeUndefined();
  });

  it('keeps the rest of a retry when the operators refuse its co-signed part', async () => {
    const mixed = leftoverQuote({
      leaves: [coLeaf, soloLeaf],
      funding: funding(3_000),
      skipped: [{ leafId: 'leaf-4', valueSats: 7_000, reason: { type: 'notRecoverable', message: 'paid elsewhere' } }],
    });
    const prepareRecoverFunds = quoting(mixed, leftoverQuote());
    const recoverFunds = vi.fn(async () => checked([], { leaves: [], failed: [failure] }));
    const start = exit(ready, { namedLeaves: [...exit().namedLeaves!, { leafId: 'leaf-4', valueSats: 7_000 }] });
    const { plan: next } = await advanceUnilateralExit(start, chain(), done({ prepareRecoverFunds, recoverFunds }), '02abc');

    expect(recoverFunds).toHaveBeenCalledTimes(1);
    expect(topUpOf(next)).toEqual({ required: { sat: 3_000, inputs: 1 }, heldSat: 0 });
    expect(next.droppedLeaves).toEqual([{ leafId: 'leaf-4', valueSats: 7_000 }]);
    expect(leftoverIdsOf(next)).toEqual(['c-9', 'leaf-2']);
  });

  it('takes a leftover the quote names nowhere out of the exit, as waiting on the output its co-signing failed to spend', async () => {
    const { plan: next } = await advanceUnilateralExit(
      exit(ready, { namedLeaves: exit().namedLeaves?.slice(0, 2) }),
      chain(),
      done({ prepareRecoverFunds: quoting(leftoverQuote({ leaves: [] })) }),
      '02abc',
    );
    expect(next.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['leaf-1']);
    expect(next.exit.failed).toEqual([]);
    expect(next.landed).toEqual([sweepEntry, { leafIds: ['c-9'], valueSat: 30_000, outpoint: `${txidOf(5)}:2`, unreadSince: 100 }]);
    expect(next.status).toEqual({ type: 'done' });
  });

  it('names no leftover still to go once a rebuild finds it landed, though the finished plan still lists it', async () => {
    const finished = await rebuildExit(
      exit(ready, { namedLeaves: exit().namedLeaves?.slice(0, 2) }),
      sdk({ prepareRecoverFunds: quoting(leftoverQuote({ leaves: [] })) }),
      '02abc',
    );
    expect(finished.status).toEqual({ type: 'done' });
    expect(finished.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['leaf-1', 'c-9']);
    expect(leftoverIdsOf(finished)).toEqual([]);
    expect(planProgress(finished).total).toBe(2);
  });

  it.each([
    [{ type: 'notRecoverable', message: 'paid elsewhere' }, [{ leafId: 'c-9', valueSats: 30_000 }]],
    [{ type: 'feeExceedsValue' }, undefined],
  ] satisfies [SkippedLeafReason, unknown][])(
    'takes a leftover the quote skips for good (%o) out of the exit, hiding only an unrecoverable one, and finishes',
    async (reason, dropped) => {
      const quote = leftoverQuote({ leaves: [], skipped: [{ ...coLeaf, reason }] });
      const { plan: next } = await advanceUnilateralExit(
        exit(ready, { namedLeaves: exit().namedLeaves?.slice(0, 2) }),
        chain(),
        done({ prepareRecoverFunds: quoting(quote) }),
        '02abc',
      );
      expect(next.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['leaf-1']);
      expect(next.droppedLeaves).toEqual(dropped);
      expect(next.status).toEqual({ type: 'done' });
    },
  );

  it.each([{ type: 'unverified' }, { type: 'fundsNotFound' }] satisfies SkippedLeafReason[])(
    'keeps a leftover the chain has yet to show ($type), trying it again on the paced schedule',
    async reason => {
      const prepareRecoverFunds = quoting(leftoverQuote({ leaves: [], skipped: [{ ...coLeaf, reason }, { ...soloLeaf, reason }] }));
      const at = (tip: number) => chain({ tipHeight: async () => tip });
      const first = await advanceUnilateralExit(exit(), at(100), done({ prepareRecoverFunds }), '02abc');
      expect(first.plan).toMatchObject({ status: { type: 'running' }, retrySince: 100, retriedAt: 100 });
      expect(leftoverIdsOf(first.plan)).toEqual(['c-9', 'leaf-2']);

      const next = await advanceUnilateralExit(first.plan, at(101), done({ prepareRecoverFunds }), '02abc');
      expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
      expect(next.plan.status).toEqual({ type: 'running' });
      await advanceUnilateralExit(next.plan, at(106), done({ prepareRecoverFunds }), '02abc');
      expect(prepareRecoverFunds).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps a leftover the operators stopped and tries it again, building it into the exit once it quotes co-signed', async () => {
    const notRecoverable = { type: 'notRecoverable' as const, message: 'paid elsewhere' };
    const stopped = leftoverQuote({
      leaves: [],
      skipped: [{ ...coLeaf, reason: notRecoverable }, { ...soloLeaf, reason: notRecoverable }],
      exitChainState: { ...prepared().exitChainState, stoppedLeafIds: ['c-9'] },
    });
    const prepareRecoverFunds = quoting(stopped, leftoverQuote());
    const recoverFunds = vi.fn(async () => cosignedBuild());
    const at = (tip: number) => chain({ tipHeight: async () => tip });
    const first = await advanceUnilateralExit(exit(), at(100), done({ prepareRecoverFunds, recoverFunds }), '02abc');
    expect(first.plan.status).toEqual({ type: 'running' });
    expect(leftoverIdsOf(first.plan)).toEqual(['c-9']);
    // Only the leaf no stop explains is gone for good.
    expect(first.plan.droppedLeaves).toEqual([{ leafId: 'leaf-2', valueSats: 50_000 }]);
    expect(recoverFunds).not.toHaveBeenCalled();

    const { plan: next } = await advanceUnilateralExit(first.plan, at(106), done({ prepareRecoverFunds, recoverFunds }), '02abc');
    expect(prepareRecoverFunds).toHaveBeenLastCalledWith(expect.objectContaining({ selection: { type: 'specific', leafIds: ['c-9'] } }));
    expect(next.exit.leaves.map(leaf => leaf.leafId)).toEqual(['leaf-1', 'c-9']);
    expect(next.exit.transactions.map(t => t.txid)).toContain('c9');
    expect(leftoverIdsOf(next)).toEqual([]);
    expect(next.droppedLeaves).toEqual([{ leafId: 'leaf-2', valueSats: 50_000 }]);
  });

  it('keeps an exit with nothing built while a leftover waits, without reading it back', async () => {
    const checkRecoverFunds = vi.fn(sdk().checkRecoverFunds);
    const prepareRecoverFunds = quoting(leftoverQuote({ leaves: [], skipped: [{ ...coLeaf, reason: { type: 'unverified' } }] }));
    const idle = plan([], { retrySince: 94, namedLeaves: [{ leafId: 'c-9', valueSats: 30_000 }], exit: { leaves: [], failed: [failure] } });
    const { plan: next } = await advanceUnilateralExit(idle, chain(), sdk({ checkRecoverFunds, prepareRecoverFunds }), '02abc');
    expect(checkRecoverFunds).not.toHaveBeenCalled();
    expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
    expect(next).toMatchObject({ status: { type: 'running' }, retriedAt: 100 });
  });

  it('builds a unilateral leftover that needs no funding as the next part, once the rest has landed', async () => {
    passkeyWallet();
    const quote = leftoverQuote({ leaves: [soloLeaf], sweepFeeSats: 300 });
    const recoverFunds = vi.fn(async () => checked([{ txid: 'sweep-2', kind: 'sweep' }], { leaves: [soloLeaf] }));
    const { plan: next } = await advanceUnilateralExit(
      exit(ready, { namedLeaves: [exit().namedLeaves![0], exit().namedLeaves![2]], exit: { failed: [] } }),
      chain(),
      done({ prepareRecoverFunds: quoting(quote), recoverFunds }),
      '02abc',
    );
    expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: quote }]);
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['sweep-2']);
    expect(next).toMatchObject({ status: { type: 'running' }, quotedSweepFeeSat: 300, quotedExitFeeSat: 5_000, exitFeeAddress: key.address, exitStateSnapshot: 'frozen' });
    expect(next.namedLeaves).toEqual([{ leafId: 'leaf-2', valueSats: 50_000, feeSat: 300 }]);
    expect(next.landed).toEqual([sweepEntry]);
    localStorage.removeItem('passkeyLabel');
  });

  it('builds no next part over a co-signed recovery in flight that its quote did not name, which the build would drop', async () => {
    const inFlight = tx({ txid: 'c5', kind: 'cooperative', nodeId: 'c-5', txHex: rawTx([`${txidOf(6)}:0`], [19_000]), status: ready });
    const recoverFunds = vi.fn(async () => checked([{ txid: 'sweep-2', kind: 'sweep' }], { leaves: [soloLeaf] }));
    const start = landedExit({
      namedLeaves: [exit().namedLeaves![0], { leafId: 'c-5', valueSats: 20_000 }, exit().namedLeaves![2]],
      exit: {
        failed: [],
        leaves: [{ leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' }, { leafId: 'c-5', valueSats: 20_000, method: 'cooperative' }],
        transactions: [tx({ txid: txidOf(1), kind: 'refund', nodeId: 'leaf-1', status: confirmed(90) }), sweepTx(confirmed(91)), inFlight],
      },
    });
    const prepareRecoverFunds = quoting(leftoverQuote({ leaves: [soloLeaf] }));
    const { plan: next } = await advanceUnilateralExit(start, chain({ tipHeight: async () => 106 }), sdk({ prepareRecoverFunds, recoverFunds }), '02abc');
    expect(prepareRecoverFunds).toHaveBeenCalledWith(expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-2'] } }));
    expect(recoverFunds).not.toHaveBeenCalled();
    expect(next.exit.transactions.map(t => t.txid)).toContain('c5');
    expect(leftoverIdsOf(next)).toEqual(['leaf-2']);
  });

  describe('that needs more exit fee', () => {
    const askQuote = () => leftoverQuote({ leaves: [soloLeaf], funding: funding(3_000), sweepFeeSats: 300 });
    const waiting = (over: Parameters<typeof plan>[1] = {}) =>
      landedExit({
        namedLeaves: [exit().namedLeaves![0], exit().namedLeaves![2]],
        status: { type: 'needsExitFee', topUp: { required: { sat: 3_000, inputs: 1 }, heldSat: 1_000 } },
        ...over,
        exit: { failed: [], ...over.exit },
      });
    const nextPart = () =>
      checked(
        [
          { txid: 'refund-2', kind: 'refund', nodeId: 'leaf-2', status: locked(900) },
          { txid: 'sweep-2', kind: 'sweep', dependsOn: ['refund-2'], status: blocked },
        ],
        { leaves: [soloLeaf] },
      );
    const tip = (height: number) => chain({ tipHeight: async () => height });

    it('asks once the rest has landed, reading no phrase and building nothing, and keeps what the address held when asked', async () => {
      passkeyWallet();
      const recoverFunds = vi.fn(async () => nextPart());
      const prepareRecoverFunds = quoting(askQuote());
      const addressUtxos = vi.fn(async () => [feeCoin(1_000), feeCoin(800, false)]);
      const start = exit(ready, { namedLeaves: [exit().namedLeaves![0], exit().namedLeaves![2]], exit: { failed: [] } });
      const first = await advanceUnilateralExit(start, chain({ addressUtxos }), done({ prepareRecoverFunds, recoverFunds }), '02abc');
      // Read in the pass that asks: a later first read could already hold the payment.
      expect(addressUtxos).toHaveBeenCalledWith(key.address);
      expect(topUpOf(first.plan)).toEqual({ required: { sat: 3_000, inputs: 1 }, heldSat: 1_000 });
      expect(recoverFunds).not.toHaveBeenCalled();
      expect(isStalled(first.plan)).toBe(false);

      const next = await advanceUnilateralExit(first.plan, tip(101), done({ prepareRecoverFunds, recoverFunds }), '02abc', [feeCoin(1_000), feeCoin(2_000, false)]);
      expect(topUpOf(next.plan)).toEqual({ required: { sat: 3_000, inputs: 1 }, heldSat: 1_000 });
      expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
      localStorage.removeItem('passkeyLabel');
    });

    it('leaves what the address held unread when the read in the pass that asks fails, for the next read to fill', async () => {
      const addressUtxos = vi.fn(async (): Promise<ReturnType<typeof feeCoin>[]> => {
        throw new Error('rate limited');
      });
      const start = exit(ready, { namedLeaves: [exit().namedLeaves![0], exit().namedLeaves![2]], exit: { failed: [] } });
      const first = await advanceUnilateralExit(start, chain({ addressUtxos }), done({ prepareRecoverFunds: quoting(askQuote()) }), '02abc');
      expect(topUpOf(first.plan)).toEqual({ required: { sat: 3_000, inputs: 1 } });

      const next = await advanceUnilateralExit(first.plan, tip(101), done(), '02abc', [feeCoin(1_000)]);
      expect(topUpOf(next.plan)?.heldSat).toBe(1_000);
    });

    it('asks for the tap when the exit has no fee address yet, which only the key can say', async () => {
      const start = exit(ready, { exitFeeAddress: undefined, namedLeaves: [exit().namedLeaves![0], exit().namedLeaves![2]], exit: { failed: [], fundingInputs: [] } });
      const { plan: next } = await advanceUnilateralExit(start, chain(), done({ prepareRecoverFunds: quoting(askQuote()) }), '02abc');
      expect(topUpOf(next)).toEqual({ required: { sat: 3_000, inputs: 1 }, needsSignIn: true });
    });

    it('builds the next part from the funding it had and the coins sent, with a signer, once they confirm', async () => {
      const recoverFunds = vi.fn<ExitSdk['recoverFunds']>(async () => nextPart());
      const coins = [feeCoin(3_000)];
      expect(leftoverTopUp(waiting(), coins).stillToSendSat).toBe(0);
      const { plan: next } = await advanceUnilateralExit(waiting(), tip(101), done({ prepareRecoverFunds: quoting(askQuote()), recoverFunds }), '02abc', coins);

      expect(recoverFunds).toHaveBeenCalledWith(
        { prepared: askQuote(), fundingInputs: [stored, { type: 'p2wpkh', txid: 'coin-3000', vout: 0, valueSats: 3_000, pubkey: key.publicKeyHex }] },
        expect.anything(),
      );
      expect(topUpOf(next)).toBeUndefined();
      // What the address held before the ask was not sent for this part.
      expect(next).toMatchObject({ quotedExitFeeSat: 7_000, exitFeeAddress: key.address, quotedSweepFeeSat: 300, exitStateSnapshot: 'frozen', status: { type: 'running' } });
      expect(next.exit.transactions.map(t => t.txid)).toEqual(['refund-2', 'sweep-2']);
      expect(next.landed).toEqual([sweepEntry]);
    });

    it('counts the leftover at the fee of the quote that asks, so building it does not move the amount', async () => {
      const recoverFunds = vi.fn<ExitSdk['recoverFunds']>(async () => ({ ...nextPart(), recoverableValueSats: 50_000 }));
      const prepareRecoverFunds = quoting(askQuote());
      // Its fee is the share an earlier quote of more leaves put on it.
      const stale = exit(ready, { namedLeaves: [exit().namedLeaves![0], { leafId: 'leaf-2', valueSats: 50_000, feeSat: 150 }], exit: { failed: [] } });
      const first = await advanceUnilateralExit(stale, chain(), done({ prepareRecoverFunds, recoverFunds }), '02abc');
      expect(topUpOf(first.plan)).toBeDefined();
      expect(recoverFunds).not.toHaveBeenCalled();

      const { plan: next } = await advanceUnilateralExit(first.plan, tip(101), done({ prepareRecoverFunds, recoverFunds }), '02abc', [feeCoin(3_000)]);
      expect(recoverFunds).toHaveBeenCalledTimes(1);
      expect(willReceiveSat(first.plan)).toBe(99_000 + 50_000 - 300);
      expect(willReceiveSat(next)).toBe(willReceiveSat(first.plan));
    });

    it('waits while what it asked for has not confirmed', async () => {
      const recoverFunds = vi.fn(async () => nextPart());
      const { plan: next } = await advanceUnilateralExit(waiting(), tip(101), done({ recoverFunds }), '02abc', [feeCoin(3_000, false)]);
      expect(recoverFunds).not.toHaveBeenCalled();
      expect(topUpOf(next)).toEqual(topUpOf(waiting()));
    });

    it('waits for the tap on a passkey wallet, building nothing', async () => {
      passkeyWallet();
      const recoverFunds = vi.fn(async () => nextPart());
      const prepareRecoverFunds = quoting(askQuote());
      const first = await advanceUnilateralExit(waiting(), tip(101), done({ prepareRecoverFunds, recoverFunds }), '02abc', [feeCoin(3_000)]);
      expect(topUpOf(first.plan)).toEqual({ ...topUpOf(waiting()), needsSignIn: true });
      expect(recoverFunds).not.toHaveBeenCalled();

      await advanceUnilateralExit(first.plan, tip(102), done({ prepareRecoverFunds, recoverFunds }), '02abc', [feeCoin(3_000)]);
      expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
      localStorage.removeItem('passkeyLabel');
    });

    it('tries a build that failed again only in a later block', async () => {
      const prepareRecoverFunds = vi.fn(async () => askQuote());
      const recoverFunds = vi.fn(async () => {
        throw new Error('operators unreachable');
      });
      const driver = done({ prepareRecoverFunds, recoverFunds });
      const first = await advanceUnilateralExit(waiting(), tip(101), driver, '02abc', [feeCoin(3_000)]);
      expect(first.plan).toMatchObject({ retriedAt: 101, status: waiting().status });
      await advanceUnilateralExit(first.plan, tip(101), driver, '02abc', [feeCoin(3_000)]);
      expect(recoverFunds).toHaveBeenCalledTimes(1);
      await advanceUnilateralExit(first.plan, tip(102), driver, '02abc', [feeCoin(3_000)]);
      expect(recoverFunds).toHaveBeenCalledTimes(2);
    });

    it('asks for what the build says it needs, sized on the coins it had', async () => {
      const recoverFunds = vi.fn(async () => {
        throw new Error('Insufficient CPFP funding: need at least 6400 sats');
      });
      const coins = [feeCoin(2_000), feeCoin(1_500, true, 'b')];
      const { plan: next } = await advanceUnilateralExit(waiting(), tip(101), done({ prepareRecoverFunds: quoting(askQuote()), recoverFunds }), '02abc', coins);
      expect(topUpOf(next)).toEqual({ required: { sat: 6_400, inputs: 2 }, heldSat: 1_000 });
      expect(next.exit.transactions.map(t => t.txid)).toEqual([txidOf(1), 'sweep']);
    });

    it('lets go of the leftover after about a week, without hiding it, and finishes', async () => {
      const prepareRecoverFunds = vi.fn(async () => askQuote());
      const start = waiting({ namedLeaves: [exit().namedLeaves![0], { leafId: 'leaf-2', valueSats: 50_000, feeSat: 300 }] });
      const { plan: next } = await advanceUnilateralExit(start, tip(1_108), done({ prepareRecoverFunds }), '02abc');
      expect(prepareRecoverFunds).not.toHaveBeenCalled();
      // The amount drops by what the leaf was counted at: its value less its fee.
      expect(willReceiveSat(start) - willReceiveSat(next)).toBe(49_700);
      expect(next.namedLeaves).toEqual([{ leafId: 'leaf-1', valueSats: 100_000 }]);
      expect(topUpOf(next)).toBeUndefined();
      expect(next.droppedLeaves).toBeUndefined();
      expect(next.status).toEqual({ type: 'done' });
    });

    it('lets nothing go while a unilateral step is in flight', () => {
      expect(releaseDue(exit(locked(900), { retrySince: 100 }), 2_000)).toBe(false);
      expect(releaseDue(waiting(), 1_108)).toBe(true);
    });

    it('lets go of a paid leftover whose build keeps failing once the week is up, logging an empty build', async () => {
      const warn = vi.spyOn(logger, 'warn');
      const recoverFunds = vi.fn(async () => checked([]));
      const driver = done({ prepareRecoverFunds: vi.fn(async () => askQuote()), recoverFunds });
      const before = await advanceUnilateralExit(waiting(), tip(1_107), driver, '02abc', [feeCoin(3_000)]);
      expect(leftoverIdsOf(before.plan)).toEqual(['leaf-2']);
      expect(warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('came back empty'));

      const { plan: next } = await advanceUnilateralExit(before.plan, tip(1_108), driver, '02abc', [feeCoin(3_000)]);
      expect(recoverFunds).toHaveBeenCalledTimes(2);
      expect(leftoverIdsOf(next)).toEqual([]);
      expect(topUpOf(next)).toBeUndefined();
      expect(next.droppedLeaves).toBeUndefined();
      expect(next.status).toEqual({ type: 'done' });
      warn.mockRestore();
    });

    it('keeps its request and retries on schedule while a unilateral step is back in flight, building nothing', async () => {
      const prepareRecoverFunds = vi.fn(async () => askQuote());
      const recoverFunds = vi.fn(async () => nextPart());
      const inFlight = waiting({ exit: { transactions: [tx({ txid: txidOf(1), kind: 'refund', nodeId: 'leaf-1', status: confirmed(90) }), sweepTx(ready)] } });
      const { plan: next } = await advanceUnilateralExit(inFlight, tip(106), sdk({ prepareRecoverFunds, recoverFunds }), '02abc', [feeCoin(3_000)]);
      expect(prepareRecoverFunds).toHaveBeenCalledWith(expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-2'] } }));
      expect(recoverFunds).not.toHaveBeenCalled();
      expect(topUpOf(next)).toEqual(topUpOf(waiting()));
    });

    describe('beside a co-signed recovery stuck unverified', () => {
      const stuckTx = () =>
        tx({ txid: 'c9', kind: 'cooperative', nodeId: 'c-9', txHex: rawTx([`${txidOf(5)}:2`], [29_000]), status: { type: 'unverified' } });
      const leafOne = { leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' as const };
      const beside = (sweep: RecoveryTransaction['status'], over: Parameters<typeof plan>[1] = {}) =>
        landedExit({
          retrySince: 10,
          retriedAt: 50,
          ...over,
          exit: {
            failed: [],
            leaves: [leafOne, coLeaf],
            transactions: [tx({ txid: txidOf(1), kind: 'refund', nodeId: 'leaf-1', status: confirmed(90) }), sweepTx(sweep), stuckTx()],
            ...over.exit,
          },
        });
      const mixed = () => leftoverQuote({ leaves: [coLeaf, soloLeaf], funding: funding(3_000), sweepFeeSats: 300 });
      // The check confirms the sweep and reads the recovery unverified still.
      const stillStuck = (over: Partial<ExitSdk> = {}) =>
        sdk({
          checkRecoverFunds: async ({ recovery }) => ({
            recovery: { ...recovery, transactions: recovery.transactions.map(t => (t.txid === 'sweep' ? { ...t, status: confirmed(95) } : t)) },
            verdict: { type: 'valid' },
          }),
          ...over,
        });

      it('asks for the fee on the pass the last unilateral step lands, and starts the week over from there', async () => {
        const prepareRecoverFunds = quoting(mixed(), leftoverQuote());
        const recoverFunds = vi.fn(async () => cosignedBuild());
        const { plan: next } = await advanceUnilateralExit(beside(ready), chain(), stillStuck({ prepareRecoverFunds, recoverFunds }), '02abc');
        expect(prepareRecoverFunds).toHaveBeenCalledWith(expect.objectContaining({ selection: { type: 'specific', leafIds: ['c-9', 'leaf-2'] } }));
        expect(topUpOf(next)).toEqual({ required: { sat: 3_000, inputs: 1 }, heldSat: 0 });
        expect(next).toMatchObject({ retrySince: 100, retriedAt: 100 });
        expect(releaseDue(next, 1_107)).toBe(false);
      });

      it('builds the paid leftover without waiting on it, naming it too so the next part carries it', async () => {
        const prepareRecoverFunds = quoting(mixed());
        const carried = checked(
          [
            { txid: 'c9', kind: 'cooperative', nodeId: 'c-9', txHex: rawTx([`${txidOf(5)}:2`], [29_000]), status: { type: 'unverified' } },
            ...nextPart().transactions,
          ],
          { leaves: [coLeaf, soloLeaf] },
        );
        const recoverFunds = vi.fn<ExitSdk['recoverFunds']>(async () => carried);
        const start = beside(confirmed(91), {
          namedLeaves: exit().namedLeaves,
          status: { type: 'needsExitFee', topUp: { required: { sat: 3_000, inputs: 1 }, heldSat: 1_000 } },
          retrySince: 100,
          retriedAt: 100,
        });
        const { plan: next } = await advanceUnilateralExit(start, tip(101), stillStuck({ prepareRecoverFunds, recoverFunds }), '02abc', [feeCoin(3_000)]);

        expect(prepareRecoverFunds).toHaveBeenCalledWith(expect.objectContaining({ selection: { type: 'specific', leafIds: ['c-9', 'leaf-2'] } }));
        expect(recoverFunds).toHaveBeenCalledWith(expect.objectContaining({ fundingInputs: expect.any(Array) }), expect.anything());
        expect(topUpOf(next)).toBeUndefined();
        expect(next.exit.transactions.map(t => t.txid)).toEqual(['c9', 'refund-2', 'sweep-2']);
        expect(next.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['c-9', 'leaf-2']);
        expect(next.landed).toEqual([sweepEntry]);
      });
    });

    describe('buildLeftover', () => {
      it('reads the phrase before anything else from the tap, and passes on a failure', async () => {
        localStorage.removeItem('walletMnemonic');
        const prepareRecoverFunds = vi.fn(async () => askQuote());
        const tap = buildLeftover(waiting(), sdk({ prepareRecoverFunds }), '02abc', [feeCoin(3_000)], { interactive: true });
        await expect(tap).rejects.toBeInstanceOf(MnemonicUnavailableError);
        expect(prepareRecoverFunds).not.toHaveBeenCalled();
      });

      it('builds nothing over a transaction still in flight', async () => {
        await expect(buildLeftover(waiting({ exit: { transactions: [sweepTx(ready)] } }), sdk(), '02abc', [])).rejects.toBeInstanceOf(RebuildLaterError);
      });

      it('needs no key once the quote needs no funding, and asks for nothing more', async () => {
        passkeyWallet();
        const recoverFunds = vi.fn(async () => nextPart());
        const quote = leftoverQuote({ leaves: [soloLeaf] });
        const next = await buildLeftover(waiting(), sdk({ prepareRecoverFunds: quoting(quote), recoverFunds }), '02abc', []);
        expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: quote }]);
        expect(topUpOf(next)).toBeUndefined();
        expect(next.quotedExitFeeSat).toBe(5_000);
        localStorage.removeItem('passkeyLabel');
      });
    });
  });

  it('counts each leftover as one transaction still to go, and its value as not yet moving', () => {
    const landed = landedExit({ landed: undefined });
    expect(planProgress(landed)).toEqual({ confirmed: 2, total: 4, isComplete: false });
    expect(exitStages(landed)).toMatchObject({ inSpark: 80_000, onChain: 0 });
    expect(exitStages(exit(locked(900)))).toMatchObject({ inSpark: 80_000 + 0, onChain: 100_000 });
  });

  it('polls slowly while all that is left waits on a retry, but not while it waits on the exit fee', () => {
    expect(isStalled(landedExit())).toBe(true);
    expect(isStalled(landedExit({ status: { type: 'needsExitFee', topUp: { required: { sat: 3_000, inputs: 1 } } } }))).toBe(false);
  });

  it('drops a leaf a rebuild found unrecoverable or too dear from what the exit names, hiding only the unrecoverable one', () => {
    const quote = prepared({
      leaves: [{ leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' }],
      skipped: [
        { ...coLeaf, reason: { type: 'notRecoverable', message: 'paid elsewhere' } },
        { ...soloLeaf, reason: { type: 'feeExceedsValue' } },
        { leafId: 'leaf-3', valueSats: 7_000, reason: { type: 'unverified' } },
      ],
    });
    const resuming = exit(ready, {
      droppedLeaves: [{ leafId: 'gone', valueSats: 700 }],
      namedLeaves: [...exit().namedLeaves!, { leafId: 'leaf-3', valueSats: 7_000 }],
    });
    const next = planFromBuild(quote, checked([{ txid: 'fresh' }]), resuming, { network: 'mainnet', fundingAddressIndex: 0 });
    expect(next.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['leaf-1', 'leaf-3']);
    expect(next.droppedLeaves).toEqual([{ leafId: 'gone', valueSats: 700 }, { leafId: 'c-9', valueSats: 30_000 }]);
  });
});
