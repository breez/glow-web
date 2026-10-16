import { archiveExit, droppedLeafIds, loadArchive } from './archive';
import type { Landing } from '../model/plan';
import { confirmed, plan, tx } from '../testFixtures';
import { beforeEach, describe, expect, it } from 'vitest';

const wallet = { identityPubkey: 'pubkey-0000000000000000', network: 'regtest' };

/** A transaction in a block that paid `paidSat` to the destination for `leafIds`. */
const paid = (txid: string, leafIds: string[], valueSat: number, paidSat: number, blockHeight = 10): Landing => ({
  leafIds,
  valueSat,
  txid,
  paidSat,
  blockHeight,
});

const finished = (txid: string, deliveredSat: number) =>
  plan([tx({ txid, kind: 'sweep', txHex: '00', status: confirmed(10) })], {
    status: { type: 'done' },
    destination: `bcrt1-${txid}`,
    quotedSweepFeeSat: 0,
    exit: { recoverableValueSats: deliveredSat },
    landed: [paid(txid, ['leaf-1'], deliveredSat, deliveredSat)],
  });

describe('archiveExit', () => {
  beforeEach(() => localStorage.clear());

  it('keeps what the exit delivered and where it went', () => {
    archiveExit(wallet, finished('sweep-a', 50_000));

    expect(loadArchive(wallet)).toMatchObject([
      { id: 'sweep-a', destination: 'bcrt1-sweep-a', deliveredSat: 50_000, network: 'mainnet', txids: ['sweep-a'] },
    ]);
  });

  it('counts each transaction once, lists them in block order, and keeps the last build as the key', () => {
    // An older build's sweep paid two leaves, and a co-signed recovery landed first.
    archiveExit(
      wallet,
      plan([tx({ txid: 'sweep-last', kind: 'sweep', txHex: '00', status: { type: 'ready' } })], {
        status: { type: 'done' },
        landed: [
          paid('sweep-old', ['leaf-1'], 180_000, 596_524, 120),
          paid('sweep-old', ['leaf-2'], 420_000, 596_524, 120),
          paid('coop', ['c-1'], 30_000, 29_100, 110),
        ],
      }),
    );

    expect(loadArchive(wallet)[0]).toMatchObject({
      id: 'sweep-last',
      deliveredSat: 625_624,
      exitedSat: 630_000,
      txids: ['coop', 'sweep-old'],
    });
  });

  it('keys an exit that ended with no transactions of its own on the first that landed', () => {
    archiveExit(wallet, plan([], { status: { type: 'done' }, landed: [paid('late', ['leaf-1'], 9_000, 8_800, 30), paid('early', ['leaf-2'], 9_000, 8_800, 20)] }));

    expect(loadArchive(wallet)[0]).toMatchObject({ id: 'early', txids: ['early', 'late'] });
  });

  it('leaves out a transaction that paid the destination nothing, and caps the recoverable part at what exited', () => {
    // A leaf recovered to another address: its own record carries it.
    archiveExit(
      wallet,
      plan([tx({ txid: 'sweep-a', kind: 'sweep', txHex: '00', status: confirmed(10) })], {
        status: { type: 'done' },
        recoverableFundsSat: 48_200,
        landed: [paid('sweep-a', ['leaf-1'], 40_000, 39_000), paid('elsewhere', ['c-1'], 48_200, 0)],
      }),
    );

    expect(loadArchive(wallet)[0]).toMatchObject({
      deliveredSat: 39_000,
      exitedSat: 40_000,
      recoverableFundsSat: 40_000,
      txids: ['sweep-a'],
    });
  });

  it('archives nothing for a plan whose ledger has no transaction that paid the destination', () => {
    archiveExit(
      wallet,
      plan([tx({ txid: 'sweep-a', kind: 'sweep', txHex: '00', status: confirmed(10) })], {
        status: { type: 'done' },
        landed: [{ leafIds: ['leaf-1'], valueSat: 50_000, outpoint: 'refund:0' }],
      }),
    );
    archiveExit(wallet, plan([tx({ txid: 'node-a' })], { status: { type: 'done' } }));

    expect(loadArchive(wallet)).toEqual([]);
  });

  it('keeps the leaves the exit dropped as unrecoverable, and no empty list', () => {
    const droppedLeaves = [{ leafId: 'd-1', valueSats: 5_000 }];
    archiveExit(wallet, { ...finished('sweep-a', 50_000), droppedLeaves });
    archiveExit(wallet, { ...finished('sweep-b', 70_000), droppedLeaves: [] });
    expect(loadArchive(wallet).map(entry => entry.droppedLeaves)).toEqual([undefined, droppedLeaves]);
  });

  it('keeps whether it was a recovery, and nothing for an exit the user started', () => {
    archiveExit(wallet, { ...finished('sweep-a', 50_000), mode: 'recover' });
    archiveExit(wallet, finished('sweep-b', 70_000));

    expect(loadArchive(wallet).map(entry => entry.mode)).toEqual([undefined, 'recover']);
  });

  it('records the same exit once, however many passes report it', () => {
    archiveExit(wallet, finished('sweep-a', 50_000));
    archiveExit(wallet, finished('sweep-a', 50_000));

    expect(loadArchive(wallet)).toHaveLength(1);
  });

  it('keeps an earlier exit when a later one finishes, newest first', () => {
    archiveExit(wallet, finished('sweep-a', 50_000));
    archiveExit(wallet, finished('sweep-b', 70_000));

    expect(loadArchive(wallet).map(entry => entry.id)).toEqual(['sweep-b', 'sweep-a']);
  });

  it('counts the fees of the builds a rebuild replaced, so the details add up to what arrived', () => {
    // A recovery was sent 1557 sats in three coins against a 1011 ask. The
    // first build's child spent 411 of it, then the watchtower's refund took 955
    // from the leaf, and the rebuilt sweep 99: that build reports only the last two.
    archiveExit(
      wallet,
      plan([tx({ txid: 'sweep-w', kind: 'sweep', txHex: '00', status: confirmed(10) })], {
        status: { type: 'done' },
        mode: 'recover',
        quotedExitFeeSat: 1_557,
        exitFeeAddress: 'bcrt1qfee',
        exit: { recoverableValueSats: 150_000, totalFeeSats: 1_054 },
        landed: [paid('sweep-w', ['leaf-1'], 150_000, 148_946)],
      }),
      1_146,
    );

    const [record] = loadArchive(wallet);
    expect(record).toMatchObject({ exitedSat: 150_000, exitFeePaidSat: 1_557, networkFeeSat: 1_465, unspentExitFeeSat: 1_146, deliveredSat: 148_946 });
    expect(record.exitedSat! + record.exitFeePaidSat! - record.networkFeeSat! - record.unspentExitFeeSat!).toBe(record.deliveredSat);
  });

  it('counts the exit fee its sweep sent on as received, so the details still add up', () => {
    const exit = plan([tx({ txid: 'exit', kind: 'sweep', txHex: '00', status: confirmed(10) })], {
      status: { type: 'done' },
      quotedSweepFeeSat: 0,
      quotedExitFeeSat: 1_500,
      exitFeeAddress: 'bcrt1qfee',
      exit: { recoverableValueSats: 100_000 },
      landed: [paid('exit', ['leaf-1'], 100_000, 98_800), paid('fee-sweep', [], 0, 1_200, 11)],
    });
    const [record] = archiveExit(wallet, exit, 0);
    expect(record).toMatchObject({
      deliveredSat: 100_000,
      exitedSat: 100_000,
      exitFeePaidSat: 1_500,
      networkFeeSat: 1_500,
      unspentExitFeeSat: 0,
      txids: ['exit', 'fee-sweep'],
    });
  });

  it('keeps a co-signed recovery, which has no sweep, under its first transaction', () => {
    archiveExit(
      wallet,
      plan(
        [
          tx({ txid: 'coop-a', kind: 'cooperative', nodeId: 'c-1', txHex: '00', status: confirmed(10) }),
          tx({ txid: 'coop-b', kind: 'cooperative', nodeId: 'c-2', txHex: '00', status: confirmed(10) }),
        ],
        {
          status: { type: 'done' },
          mode: 'recover',
          recoverableFundsSat: 48_200,
          exit: { recoverableValueSats: 48_200 },
          landed: [paid('coop-a', ['c-1'], 20_000, 19_500), paid('coop-b', ['c-2'], 28_200, 27_700)],
        },
      ),
    );

    const [record] = loadArchive(wallet);
    expect(record).toMatchObject({ id: 'coop-a', mode: 'recover', exitedSat: 48_200, deliveredSat: 47_200 });
    // All of a recovery was outside the balance, so none of it reads as a part.
    expect(record.recoverableFundsSat).toBeUndefined();
  });

  it('keeps what came off a co-signed recovery on the way as its network fees, the operators\' cut included', () => {
    archiveExit(
      wallet,
      plan(
        [
          tx({ txid: 'coop-a', kind: 'cooperative', nodeId: 'c-1', txHex: '00', status: confirmed(10) }),
          tx({ txid: 'coop-b', kind: 'cooperative', nodeId: 'c-2', txHex: '00', status: confirmed(10) }),
        ],
        {
          status: { type: 'done' },
          mode: 'recover',
          // Short of the operators' own fee, which no field reports.
          exit: { recoverableValueSats: 200_000, totalFeeSats: 600, cooperativeFeeSats: 600, cpfpFeeSats: 0, sweepFeeSats: 0 },
          landed: [paid('coop-a', ['c-1'], 120_000, 119_368), paid('coop-b', ['c-2'], 80_000, 79_578)],
        },
      ),
    );

    expect(loadArchive(wallet)[0]).toMatchObject({ exitedSat: 200_000, deliveredSat: 198_946, networkFeeSat: 1_054 });
  });

  it('keeps the last build\'s fees as the network fees of a recovery that paid an exit fee', () => {
    archiveExit(
      wallet,
      plan([tx({ txid: 'sweep-s', kind: 'sweep', txHex: '00', status: confirmed(10) })], {
        status: { type: 'done' },
        mode: 'recover',
        quotedExitFeeSat: 3_122,
        exitFeeAddress: 'bcrt1qfee',
        exit: { recoverableValueSats: 40_000, totalFeeSats: 2_240 },
        landed: [paid('sweep-s', ['s-1'], 40_000, 40_882)],
      }),
    );

    expect(loadArchive(wallet)[0].networkFeeSat).toBe(2_240);
  });

  it('counts only what landed of the leaves outside the balance, so one let go reduces nothing', () => {
    archiveExit(
      wallet,
      plan([tx({ txid: 'sweep-a', kind: 'sweep', txHex: '00', status: confirmed(10) })], {
        status: { type: 'done' },
        // c-1 was let go and never landed; c-2 landed on its own recovery.
        recoverableLeafIds: ['c-1', 'c-2'],
        landed: [paid('sweep-a', ['leaf-1'], 100_000, 99_000), paid('coop-2', ['c-2'], 18_200, 17_000)],
      }),
    );
    expect(loadArchive(wallet)[0]).toMatchObject({ exitedSat: 118_200, deliveredSat: 116_000, recoverableFundsSat: 18_200 });
  });

  it('does not count a leaf the watchtower moved mid-exit as recoverable funds', () => {
    const moved = plan(
      [
        tx({ txid: 'coop', kind: 'cooperative', nodeId: 'leaf-2', txHex: '00', status: confirmed(10) }),
        tx({ txid: 'sweep-g', kind: 'sweep', txHex: '00', status: confirmed(10) }),
      ],
      {
        status: { type: 'done' },
        // Both leaves were balance when the exit began.
        recoverableLeafIds: [],
        exit: {
          recoverableValueSats: 600_000,
          leaves: [
            { leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' },
            { leafId: 'leaf-2', valueSats: 420_000, method: 'cooperative' },
          ],
        },
        landed: [paid('sweep-g', ['leaf-1'], 180_000, 179_000), paid('coop', ['leaf-2'], 420_000, 418_000)],
      },
    );
    archiveExit(wallet, moved);
    expect(loadArchive(wallet)[0]).toMatchObject({ id: 'sweep-g', exitedSat: 600_000 });
    expect(loadArchive(wallet)[0].recoverableFundsSat).toBeUndefined();
  });

  it('keeps each wallet\'s exits apart', () => {
    archiveExit(wallet, finished('sweep-a', 50_000));

    expect(loadArchive({ ...wallet, network: 'mainnet' })).toEqual([]);
  });
});

describe('droppedLeafIds', () => {
  it('collects the dropped leaves of every record it is handed', () => {
    const records = [{ droppedLeaves: [{ leafId: 'd-1', valueSats: 5 }] }, {}, { droppedLeaves: [{ leafId: 'd-2', valueSats: 7 }] }];
    expect(droppedLeafIds(records)).toEqual(new Set(['d-1', 'd-2']));
  });
});
