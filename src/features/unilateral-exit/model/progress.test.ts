import { blocksToFinish, exitStages, movedSat, nextAction, planProgress } from './progress';
import { blocked, confirmed, locked, plan, ready, sweepHex, twoLeaves, tx } from '../testFixtures';
import { describe, expect, it } from 'vitest';
import type { RecoveryTransaction } from '@breeztech/breez-sdk-spark';
import type { Landing } from './plan';

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

  it('delivers a co-signed leaf once its own recovery confirms', () => {
    const stages = exitStages(
      twoLeaves([
        tx({ txid: 'c1', kind: 'cooperative', nodeId: 'leaf-1', status: confirmed(900) }),
        tx({ txid: 'r2', kind: 'refund', nodeId: 'leaf-2' }),
      ]),
    );
    expect(stages).toMatchObject({ inSpark: 420_000, onChain: 0, delivered: 180_000 });
  });

  it('does not credit a leaf whose refund is only in the mempool', () => {
    expect(exitStages(twoLeaves([tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1', status: ready })])).onChain).toBe(0);
  });

  it('moves everything to the destination at its value once the sweep confirms, and moves what it set out to', () => {
    const stages = exitStages(
      twoLeaves([
        tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1', status: confirmed(900) }),
        tx({ txid: 'r2', kind: 'refund', nodeId: 'leaf-2', status: confirmed(900) }),
        tx({ txid: 's', kind: 'sweep', txHex: sweepHex, status: confirmed(900) }),
      ]),
    );
    expect(stages).toEqual({ inSpark: 0, onChain: 0, delivered: 600_000, moved: 600_000 });
  });

  it('delivers a co-signed leaf only once its own recovery confirms, though the sweep did, so the total holds', () => {
    const exit = (sweep: RecoveryTransaction['status']) =>
      twoLeaves([
        tx({ txid: 'c1', kind: 'cooperative', nodeId: 'leaf-1', status: ready }),
        tx({ txid: 'r2', kind: 'refund', nodeId: 'leaf-2', status: confirmed(900) }),
        tx({ txid: 's', kind: 'sweep', txHex: sweepHex, status: sweep }),
      ]);
    const total = ({ inSpark, onChain, delivered }: ReturnType<typeof exitStages>) => inSpark + onChain + delivered;
    const swept = exitStages(exit(confirmed(901)));
    expect(swept).toMatchObject({ inSpark: 180_000, onChain: 0, delivered: 420_000 });
    expect(total(exitStages(exit(ready)))).toBe(600_000);
    expect(total(swept)).toBe(600_000);
  });

  it('counts what replaced builds paid out as delivered, though this build never held it', () => {
    const stages = exitStages(
      twoLeaves([tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1' }), tx({ txid: 'r2', kind: 'refund', nodeId: 'leaf-2' })], {
        landed: [
          { leafIds: ['old-1'], valueSat: 50_000, txid: 'old-sweep', paidSat: 49_000 },
          { leafIds: ['old-2'], valueSat: 7_000, outpoint: 'refund:0' },
        ],
      }),
    );
    expect(stages).toMatchObject({ inSpark: 600_000, onChain: 0, delivered: 50_000 });
  });

  it('counts a leaf the plan still names once, as delivered, when a ledger entry covers it', () => {
    const stages = exitStages(
      plan([tx({ txid: 's', kind: 'sweep' })], {
        namedLeaves: [
          { leafId: 'leaf-1', valueSats: 100_000 },
          { leafId: 'c-9', valueSats: 30_000, feeSat: 1_000 },
        ],
        landed: [{ leafIds: ['c-9'], valueSat: 30_000, txid: 'c9', paidSat: 29_000, blockHeight: 9 }],
      }),
    );
    expect(stages).toMatchObject({ inSpark: 100_000, onChain: 0, delivered: 30_000 });
  });
});

describe('movedSat', () => {
  // An earlier build landed c-1's co-signed recovery; this one holds the two balance leaves.
  const withLanding = (landing: Partial<Landing>) =>
    twoLeaves([tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1' })], {
      landed: [{ leafIds: ['c-1'], valueSat: 30_000, outpoint: 'out:0', ...landing }],
    });

  it('holds still while an earlier landing waits on its read, and once it is read', () => {
    expect(movedSat(withLanding({}))).toBe(630_000);
    expect(movedSat(withLanding({ txid: 'coop', paidSat: 29_000, blockHeight: 90 }))).toBe(630_000);
  });

  it('drops a leaf whose landing paid the destination nothing, which left the exit', () => {
    expect(movedSat(withLanding({ txid: 'elsewhere', paidSat: 0, blockHeight: 90 }))).toBe(600_000);
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

describe('planProgress', () => {
  it('counts confirmed transactions against the total', () => {
    const p = plan([tx({ txid: 'a', status: confirmed(1) }), tx({ txid: 'b' }), tx({ txid: 'c' })]);
    expect(planProgress(p)).toEqual({ confirmed: 1, total: 3, isComplete: false });
  });

  it('is complete on the sdk done verdict', () => {
    const p = plan([tx({ txid: 's', kind: 'sweep', status: confirmed(2) })], { status: { type: 'done' } });
    expect(planProgress(p).isComplete).toBe(true);
  });

  it('is not complete just because every step confirmed, without a verdict to say so', () => {
    expect(planProgress(plan([tx({ txid: 'n', status: confirmed(1) })])).isComplete).toBe(false);
  });

  it('is not complete when the exit has to be rebuilt', () => {
    expect(planProgress(plan([tx({ txid: 'a' })], { status: { type: 'rebuilding' } })).isComplete).toBe(false);
  });

  it('counts each transaction a replaced build landed once, as done', () => {
    const p = plan([tx({ txid: 'a', status: confirmed(1) }), tx({ txid: 'b' })], {
      landed: [
        { leafIds: ['old-1'], valueSat: 20_000, txid: 'old-sweep', paidSat: 39_000 },
        { leafIds: ['old-2'], valueSat: 20_000, txid: 'old-sweep', paidSat: 39_000 },
        { leafIds: ['c-9'], valueSat: 9_000, txid: 'old-coop', paidSat: 8_700 },
      ],
    });
    expect(planProgress(p)).toEqual({ confirmed: 3, total: 4, isComplete: false });
  });

  it('counts a fee sweep still out as one step to go, and as done once it lands', () => {
    const sweep = tx({ txid: 's', kind: 'sweep', status: confirmed(9) });
    const out = plan([sweep], { status: { type: 'done' }, feeSweep: { txid: 'fee-sweep', txHex: '00', outpoint: 'f:0', sentAt: 10 } });
    expect(planProgress(out)).toEqual({ confirmed: 1, total: 2, isComplete: true });
    const landed = plan([sweep], {
      status: { type: 'done' },
      landed: [{ leafIds: [], valueSat: 0, txid: 'fee-sweep', paidSat: 2_000, blockHeight: 11 }],
    });
    expect(planProgress(landed)).toEqual({ confirmed: 2, total: 2, isComplete: true });
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

describe('blocksToFinish for a matured step', () => {
  it("does not count a ready step's timelock again", () => {
    // Ready means the sdk has already seen the timelock pass: one block to confirm is left.
    expect(blocksToFinish([tx({ txid: 'r', kind: 'refund', csvTimelockBlocks: 2000 })], 100)).toBe(1);
  });
});
