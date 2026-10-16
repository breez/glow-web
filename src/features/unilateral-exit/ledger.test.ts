import { hasWaitingLanding, recordLanded, settleLanded, withLanded } from './ledger';
import { planFromBuild } from './building';
import { applyExitCheck } from './check';
import type { Landing, UnilateralExitPlan } from './model/plan';
import { advanceUnilateralExit } from './pass';
import { willReceiveSat } from './quote';
import { rebuildExit } from './rebuild';
import {
  checked,
  chain,
  confirmed,
  MNEMONIC,
  plan,
  prepared,
  rawTx,
  ready,
  redo,
  sdk,
  twoLeaves,
  tx,
  txidOf,
} from './testFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainClient } from '@/services/chain';

describe('the ledger of what landed', () => {
  const refund = (n: number, leafId: string, status = confirmed(100)) =>
    tx({ txid: txidOf(n), kind: 'refund', nodeId: leafId, status });
  const sweep = (txid: string, refunds: number[], paidSat: number, status = ready) =>
    tx({
      txid,
      kind: 'sweep',
      txHex: rawTx(refunds.map(n => `${txidOf(n)}:0`), [paidSat]),
      dependsOn: refunds.map(txidOf),
      status,
    });
  const cosigned = (txid: string, leafId: string, spends: string, status = ready) =>
    tx({ txid, kind: 'cooperative', nodeId: leafId, txHex: rawTx([spends], [29_000]), status });
  const coLeaf = (leafId: string, valueSats = 30_000) => ({ leafId, valueSats, method: 'cooperative' as const });
  const confirmedAs = (p: UnilateralExitPlan, txid: string, blockHeight = 120) => ({
    ...p.exit,
    transactions: p.exit.transactions.map(t => (t.txid === txid ? { ...t, status: confirmed(blockHeight) } : t)),
  });

  describe('as a check records it', () => {
    it('records a confirmed sweep from its own hex: what it paid, its block, and the leaves of the refunds it spends', () => {
      const swept = twoLeaves([refund(1, 'leaf-1'), refund(2, 'leaf-2'), sweep('sweep', [1, 2], 596_524)]);
      const next = applyExitCheck(swept, confirmedAs(swept, 'sweep'), 'done');
      expect(next.landed).toEqual([
        { leafIds: ['leaf-1', 'leaf-2'], valueSat: 600_000, txid: 'sweep', paidSat: 596_524, blockHeight: 120 },
      ]);
      expect(hasWaitingLanding(next)).toBe(false);
    });

    it('records a confirmed co-signed recovery as waiting on the outpoint it spends, and nothing before it confirms', () => {
      const recovery = plan([cosigned('c1', 'c-1', `${txidOf(9)}:1`)], { exit: { leaves: [coLeaf('c-1')] } });
      expect(applyExitCheck(recovery, recovery.exit, 'valid').landed).toBeUndefined();

      const next = applyExitCheck(recovery, confirmedAs(recovery, 'c1'), 'done');
      expect(next.landed).toEqual([{ leafIds: ['c-1'], valueSat: 30_000, outpoint: `${txidOf(9)}:1` }]);
      expect(hasWaitingLanding(next)).toBe(true);
    });

    it('records nothing twice: a sweep it holds, or a replacement built for a leaf already recorded', () => {
      const swept = twoLeaves([refund(1, 'leaf-1'), sweep('sweep', [1], 179_000, confirmed(120))], {
        landed: [{ leafIds: ['leaf-1'], valueSat: 180_000, txid: 'sweep', paidSat: 179_000, blockHeight: 120 }],
      });
      expect(recordLanded(swept)).toBe(swept);

      const replaced = plan([cosigned('c1-again', 'c-1', `${txidOf(9)}:1`, confirmed(120))], {
        exit: { leaves: [coLeaf('c-1')] },
        landed: [{ leafIds: ['c-1'], valueSat: 30_000, outpoint: `${txidOf(9)}:1` }],
      });
      expect(recordLanded(replaced)).toBe(replaced);
    });

    it('keeps what a sweep paid without counting a leaf already waiting on a read twice', () => {
      const waiting: Landing = { leafIds: ['leaf-1'], valueSat: 180_000, outpoint: `${txidOf(1)}:0` };
      const swept = twoLeaves([refund(1, 'leaf-1'), sweep('sweep', [1], 179_000, confirmed(120))], { landed: [waiting] });
      expect(recordLanded(swept).landed).toEqual([
        waiting,
        { leafIds: [], valueSat: 0, txid: 'sweep', paidSat: 179_000, blockHeight: 120 },
      ]);
      // That entry names no leaf, so only its txid says it is this build's own and not an earlier one's.
      expect(willReceiveSat(recordLanded(swept))).toBe(179_000);
    });

    it('skips a transaction whose hex does not parse', () => {
      const unreadable = plan([
        tx({ txid: 's', kind: 'sweep', txHex: 'zz', status: confirmed(1) }),
        tx({ txid: 'c', kind: 'cooperative', nodeId: 'c-1', txHex: '00', status: confirmed(1) }),
      ]);
      expect(recordLanded(unreadable)).toBe(unreadable);
    });
  });

  describe('across a rebuild', () => {
    // A co-signed leaf, two swept leaves, and two named leaves with nothing built.
    const replaced = (over: Parameters<typeof plan>[1] = {}) =>
      plan([cosigned('c1', 'c-1', `${txidOf(9)}:1`), refund(1, 'leaf-1'), refund(2, 'leaf-2'), sweep('sweep', [1, 2], 596_524)], {
        namedLeaves: [
          { leafId: 'c-1', valueSats: 30_000 },
          { leafId: 'leaf-1', valueSats: 180_000 },
          { leafId: 'leaf-2', valueSats: 420_000 },
          { leafId: 'leaf-3', valueSats: 5_000 },
          { leafId: 'leaf-4', valueSats: 600 },
        ],
        ...over,
        exit: {
          leaves: [coLeaf('c-1'), { leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' }, { leafId: 'leaf-2', valueSats: 420_000, method: 'unilateral' }],
          ...over.exit,
        },
      });
    const earlier: Landing = { leafIds: ['old'], valueSat: 5, txid: 'old-tx', paidSat: 4 };

    it('carries the ledger, and records a leaf the quote lists nowhere by the outpoint the replaced build spends', () => {
      const quote = prepared({
        leaves: [{ leafId: 'leaf-2', valueSats: 420_000, method: 'unilateral' }],
        skipped: [{ leafId: 'leaf-4', valueSats: 600, reason: { type: 'feeExceedsValue' } }],
      });
      const next = planFromBuild(quote, checked([{ txid: 'fresh' }]), replaced({ landed: [earlier] }), { network: 'mainnet', fundingAddressIndex: 0 });
      // leaf-3 had nothing built, so the replaced build holds no outpoint for it.
      expect(next.landed).toEqual([
        earlier,
        { leafIds: ['c-1'], valueSat: 30_000, outpoint: `${txidOf(9)}:1` },
        { leafIds: ['leaf-1'], valueSat: 180_000, outpoint: `${txidOf(1)}:0` },
      ]);
    });

    it('records only the leaves it is asked about', () => {
      expect(withLanded(replaced(), null, ['leaf-1'])).toEqual([{ leafIds: ['leaf-1'], valueSat: 180_000, outpoint: `${txidOf(1)}:0` }]);
    });

    it('records a leaf whose co-signing failed by the output it failed to spend', () => {
      const failing = replaced({
        exit: { failed: [{ leafId: 'leaf-3', outputTxid: txidOf(5), outputVout: 2, error: { type: 'generic', message: 'refused' } }] },
      });
      expect(withLanded(failing, null, ['leaf-3'])).toEqual([{ leafIds: ['leaf-3'], valueSat: 5_000, outpoint: `${txidOf(5)}:2` }]);
    });

    it('records a co-signed leaf the build left out, its recovery already in a block, and names it no more', () => {
      const soloTwo = { leafId: 'leaf-2', valueSats: 420_000, method: 'unilateral' as const };
      const quote = prepared({ leaves: [coLeaf('c-1'), soloTwo] });
      const built = checked([{ txid: 'fresh' }], { leaves: [soloTwo] });
      const next = planFromBuild(quote, built, replaced(), { network: 'mainnet', fundingAddressIndex: 0 });
      expect(next.landed).toContainEqual({ leafIds: ['c-1'], valueSat: 30_000, outpoint: `${txidOf(9)}:1` });
      expect(next.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['leaf-2']);

      // One the operators refused is still to come, so it stays named and unrecorded.
      const failure = { leafId: 'c-1', outputTxid: txidOf(9), outputVout: 1, error: { type: 'generic' as const, message: 'refused' } };
      const refused = planFromBuild(quote, { ...built, failed: [failure] }, replaced(), { network: 'mainnet', fundingAddressIndex: 0 });
      expect(refused.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['c-1', 'leaf-2']);
      expect(refused.landed?.flatMap(entry => entry.leafIds)).not.toContain('c-1');
    });

    it("starts no ledger for a first build", () => {
      expect(planFromBuild(prepared(), checked([{ txid: 'fresh' }]), null, { network: 'mainnet', fundingAddressIndex: 0 }).landed).toBeUndefined();
    });
  });

  describe('when a rebuild finishes the exit', () => {
    beforeEach(() => localStorage.setItem('walletMnemonic', MNEMONIC));
    const swept = () => twoLeaves([refund(1, 'leaf-1'), refund(2, 'leaf-2'), sweep('own-sweep', [1, 2], 596_524)]);

    it('records every leaf the empty quote lists nowhere as waiting, and not its own sweep as landed', async () => {
      const finished = await rebuildExit(swept(), sdk({ prepareRecoverFunds: async () => prepared({ leaves: [] }) }), '02abc');
      expect(finished.status).toEqual({ type: 'done' });
      expect(finished.landed).toEqual([
        { leafIds: ['leaf-1'], valueSat: 180_000, outpoint: `${txidOf(1)}:0` },
        { leafIds: ['leaf-2'], valueSat: 420_000, outpoint: `${txidOf(2)}:0` },
      ]);
    });

    it('records what landed between the quote and the build, leaving out what the quote skipped', async () => {
      const driver = sdk({
        prepareRecoverFunds: async () =>
          prepared({
            leaves: [{ leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' }],
            skipped: [{ leafId: 'leaf-2', valueSats: 420_000, reason: { type: 'feeExceedsValue' } }],
          }),
        recoverFunds: async () => checked([]),
      });
      const finished = await rebuildExit(swept(), driver, '02abc');
      expect(finished.status).toEqual({ type: 'done' });
      expect(finished.landed).toEqual([{ leafIds: ['leaf-1'], valueSat: 180_000, outpoint: `${txidOf(1)}:0` }]);
    });
  });

  describe('reading what paid a waiting entry out', () => {
    const outpoint = `${txidOf(9)}:1`;
    const settled: Landing = { leafIds: ['leaf-1'], valueSat: 180_000, txid: 'sweep', paidSat: 179_000 };
    const waiting = (over: Partial<Landing> = {}) =>
      plan([], { destination: 'bc1qDest', landed: [{ leafIds: ['c-1'], valueSat: 30_000, outpoint, ...over }, settled] });

    it('reads nothing when no entry waits', async () => {
      const confirmedSpender = vi.fn(async () => null);
      const done = plan([], { landed: [settled] });
      expect(await settleLanded(done, chain({ confirmedSpender }), 100)).toBe(done);
      expect(confirmedSpender).not.toHaveBeenCalled();
    });

    it('takes the transaction that spent the outpoint, a replacement included, and only what it paid the destination', async () => {
      const confirmedSpender = vi.fn(async () => ({
        txid: 'replacement',
        blockHeight: 99,
        outputs: [{ address: 'BC1QDEST', value: 28_000 }, { address: 'bc1qother', value: 1_000 }, { value: 0 }],
      }));
      const next = await settleLanded(waiting({ unreadSince: 98 }), chain({ confirmedSpender }), 100);
      expect(confirmedSpender).toHaveBeenCalledWith(txidOf(9), 1);
      expect(next.landed).toEqual([
        { leafIds: ['c-1'], valueSat: 30_000, outpoint, txid: 'replacement', blockHeight: 99, paidSat: 28_000 },
        settled,
      ]);
    });

    it('keeps an entry whose read failed, however long it has waited', async () => {
      const failing = chain({
        confirmedSpender: async () => {
          throw new Error('rate limited');
        },
      });
      const stale = waiting({ unreadSince: 10 });
      expect((await settleLanded(stale, failing, 1_000)).landed).toEqual(stale.landed);
    });

    it('drops an entry nothing spent in a block for six blocks, so the exit still finishes', async () => {
      const unspent = chain({ confirmedSpender: async () => null });
      const first = await settleLanded(waiting(), unspent, 100);
      expect(first.landed?.[0].unreadSince).toBe(100);
      expect((await settleLanded(first, unspent, 105)).landed).toHaveLength(2);
      expect((await settleLanded(first, unspent, 106)).landed).toEqual([settled]);
    });
  });

  describe('on a pass', () => {
    const outpoint = `${txidOf(1)}:0`;
    const paidBy = (txid: string) =>
      vi.fn<ChainClient['confirmedSpender']>(async () => ({ txid, blockHeight: 110, outputs: [{ address: 'bc1qdest', value: 99_000 }] }));

    beforeEach(() => {
      localStorage.clear();
      localStorage.setItem('walletMnemonic', MNEMONIC);
    });

    it('finishes a diverged exit whose older sweep landed, naming that sweep and what it paid', async () => {
      const confirmedSpender = paidBy('old-sweep');
      const broadcast = vi.fn(async () => undefined);
      const driver = sdk({
        checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: redo }),
        prepareRecoverFunds: async () => prepared({ leaves: [] }),
      });
      const current = plan([refund(1, 'leaf-1'), sweep('new-sweep', [1], 99_500)]);
      const { plan: next } = await advanceUnilateralExit(current, chain({ broadcast, confirmedSpender }), driver, '02abc');
      expect(next.status).toEqual({ type: 'done' });
      expect(next.landed).toEqual([
        { leafIds: ['leaf-1'], valueSat: 100_000, outpoint, txid: 'old-sweep', blockHeight: 110, paidSat: 99_000 },
      ]);
      expect(broadcast).not.toHaveBeenCalled();
    });

    it('reads again for a finished exit still waiting on its ledger', async () => {
      const confirmedSpender = paidBy('sweep');
      const finished = plan([], { status: { type: 'done' }, landed: [{ leafIds: ['leaf-1'], valueSat: 100_000, outpoint }] });
      const { plan: next } = await advanceUnilateralExit(finished, chain({ confirmedSpender }));
      expect(confirmedSpender).toHaveBeenCalledTimes(1);
      expect(hasWaitingLanding(next)).toBe(false);
    });

    it('sends what is ready even when the read fails', async () => {
      const broadcast = vi.fn(async () => undefined);
      const failing = chain({
        broadcast,
        confirmedSpender: async () => {
          throw new Error('rate limited');
        },
      });
      const running = plan([tx({ txid: 'a' })], { landed: [{ leafIds: ['old'], valueSat: 9_000, outpoint }] });
      const { plan: next } = await advanceUnilateralExit(running, failing, sdk(), '02abc');
      expect(broadcast).toHaveBeenCalledWith('aa');
      expect(hasWaitingLanding(next)).toBe(true);
    });

    it('still reads on the pass a diverged exit stops to wait for the passkey', async () => {
      localStorage.removeItem('walletMnemonic');
      localStorage.setItem('passkeyLabel', 'Default');
      const confirmedSpender = paidBy('c1');
      const recovering = plan([cosigned('c1', 'c-1', outpoint)], { exit: { leaves: [coLeaf('c-1')] } });
      const driver = sdk({
        checkRecoverFunds: async () => ({ recovery: confirmedAs(recovering, 'c1'), verdict: redo }),
        prepareRecoverFunds: async () => prepared(),
      });
      const { plan: next } = await advanceUnilateralExit(recovering, chain({ confirmedSpender }), driver, '02abc');
      expect(next.status).toEqual({ type: 'needsUpdate', why: 'signIn' });
      expect(next.landed).toEqual([expect.objectContaining({ leafIds: ['c-1'], txid: 'c1', paidSat: 99_000 })]);
      localStorage.removeItem('passkeyLabel');
    });
  });
});
