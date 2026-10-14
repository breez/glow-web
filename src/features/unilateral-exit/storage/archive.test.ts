import { archiveExit, droppedLeafIds, loadArchive } from './archive';
import { topUpOf, type Landing, type UnilateralExitPlan } from '../model/plan';
import { advanceUnilateralExit } from '../pass';
import type { ExitSdk } from '../quoting';
import { deriveFundingKey } from '../funding';
import { checked, coin, confirmed, funding, MNEMONIC, plan, prepared, rawTx, sdk, tx, txidOf } from '../testFixtures';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChainClient } from '@/services/chain';

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

  it('has nothing before an exit finishes', () => {
    expect(loadArchive(wallet)).toEqual([]);
  });

  it('keeps what the exit delivered and where it went', () => {
    archiveExit(wallet, finished('sweep-a', 50_000));

    expect(loadArchive(wallet)).toMatchObject([
      { id: 'sweep-a', destination: 'bcrt1-sweep-a', deliveredSat: 50_000, txids: ['sweep-a'] },
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

  it('keeps what left Spark and the exit fee, with the address it was paid to', () => {
    const key = deriveFundingKey(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      'regtest',
      0,
    );
    const input = { txid: 'fund', vout: 0, valueSats: 12_000, pubkey: key.publicKeyHex };
    archiveExit(
      wallet,
      plan([tx({ txid: 'sweep-a', kind: 'sweep', txHex: '00', status: confirmed(10) })], {
        status: { type: 'done' },
        network: 'regtest',
        exit: {
          recoverableValueSats: 600_000,
          fundingInputs: [
            { type: 'p2wpkh', ...input },
            { type: 'p2wpkh', ...input, txid: 'fund-2', valueSats: 8_000 },
          ],
        },
        landed: [paid('sweep-a', ['leaf-1', 'leaf-2'], 600_000, 596_524)],
      }),
    );

    expect(loadArchive(wallet)[0]).toMatchObject({
      network: 'regtest',
      exitedSat: 600_000,
      exitFeePaidSat: 20_000,
      exitFeeAddress: key.address,
    });
  });

  it('reports what the exit was quoted, not the coins a rebuild swept up', () => {
    const key = deriveFundingKey(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      'regtest',
      0,
    );
    const coin = (txid: string, valueSats: number) => ({
      type: 'p2wpkh' as const,
      txid,
      vout: 0,
      valueSats,
      pubkey: key.publicKeyHex,
    });
    archiveExit(
      wallet,
      plan([tx({ txid: 'sweep-c', kind: 'sweep', txHex: '00', status: confirmed(10) })], {
        status: { type: 'done' },
        network: 'regtest',
        quotedExitFeeSat: 58_534,
        exit: {
          recoverableValueSats: 600_000,
          // The fee, the top-up, and change the exit's own transactions
          // returned to the address: summing these counts sats twice.
          fundingInputs: [coin('fee', 3_122), coin('top-up', 55_412), coin('change', 31_939)],
        },
        landed: [paid('sweep-c', ['leaf-1'], 600_000, 596_524)],
      }),
    );

    expect(loadArchive(wallet)[0].exitFeePaidSat).toBe(58_534);
  });

  it('keeps the fee and its address through a rebuild that spent no funding', () => {
    archiveExit(
      wallet,
      plan([tx({ txid: 'sweep-d', kind: 'sweep', txHex: '00', status: confirmed(10) })], {
        status: { type: 'done' },
        quotedExitFeeSat: 14_350,
        exitFeeAddress: 'bcrt1qfee',
        exit: { recoverableValueSats: 120_000, fundingInputs: [] },
        landed: [paid('sweep-d', ['leaf-1'], 120_000, 118_900)],
      }),
    );

    expect(loadArchive(wallet)[0]).toMatchObject({ exitFeePaidSat: 14_350, exitFeeAddress: 'bcrt1qfee' });
  });

  it('keeps the network fees beside what moved, the exit fee and what arrived', () => {
    archiveExit(
      wallet,
      plan([tx({ txid: 'sweep-r', kind: 'sweep', txHex: '00', status: confirmed(10) })], {
        status: { type: 'done' },
        quotedExitFeeSat: 3_122,
        exitFeeAddress: 'bcrt1qfee',
        exit: { recoverableValueSats: 600_000, totalFeeSats: 2_240 },
        // What the funding had left came back through the sweep.
        landed: [paid('sweep-r', ['leaf-1', 'leaf-2'], 600_000, 600_882)],
      }),
      0,
    );

    expect(loadArchive(wallet)[0]).toMatchObject({
      exitedSat: 600_000,
      exitFeePaidSat: 3_122,
      networkFeeSat: 2_240,
      unspentExitFeeSat: 0,
      deliveredSat: 600_882,
    });
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

  it('records no exit fee for an exit that never needed one', () => {
    archiveExit(wallet, finished('sweep-e', 118_900));

    expect(loadArchive(wallet)[0].exitFeePaidSat).toBeUndefined();
    expect(loadArchive(wallet)[0].exitFeeAddress).toBeUndefined();
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

  it('keeps the part a plan from before recoverableLeafIds recorded as outside the balance', () => {
    archiveExit(wallet, { ...finished('sweep-f', 150_000), recoverableFundsSat: 48_200 });
    expect(loadArchive(wallet)[0].recoverableFundsSat).toBe(48_200);
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

describe('an exit that built what it left out', () => {
  const key = deriveFundingKey(MNEMONIC, 'mainnet', 0);
  const coLeaf = { leafId: 'c-9', valueSats: 30_000, method: 'cooperative' as const };
  const soloLeaf = { leafId: 'leaf-2', valueSats: 50_000, method: 'unilateral' as const };
  const chain = (over: Partial<ChainClient> = {}): ChainClient => ({
    feeRates: async () => ({ slow: 1, medium: 2, fast: 3 }),
    addressUtxos: async () => [],
    tipHeight: async () => 100,
    broadcast: async () => undefined,
    broadcastPackage: async () => undefined,
    confirmedSpender: async () => null,
    ...over,
  });
  // Every transaction in a block at `height`, whatever it is handed.
  const done = (height: number, over: Partial<ExitSdk> = {}) =>
    sdk({
      checkRecoverFunds: async ({ recovery }) => ({
        recovery: { ...recovery, transactions: recovery.transactions.map(t => ({ ...t, status: t.status.type === 'confirmed' ? t.status : confirmed(height) })) },
        verdict: { type: 'done' },
      }),
      ...over,
    });
  // leaf-1 swept for 99 000; the leftover is named but not built.
  const exit = (leftover: string, over: Parameters<typeof plan>[1] = {}) =>
    plan(
      [
        tx({ txid: txidOf(1), kind: 'refund', nodeId: 'leaf-1', status: confirmed(90) }),
        tx({ txid: 'sweep', kind: 'sweep', txHex: rawTx([`${txidOf(1)}:0`], [99_000]), dependsOn: [txidOf(1)], status: { type: 'ready' } }),
      ],
      {
        destination: 'bc1qmine',
        quotedExitFeeSat: 5_000,
        exitFeeAddress: key.address,
        recoverableLeafIds: leftover === 'c-9' ? ['c-9'] : [],
        namedLeaves: [
          { leafId: 'leaf-1', valueSats: 100_000 },
          { leafId: leftover, valueSats: leftover === 'c-9' ? 30_000 : 50_000 },
        ],
        ...over,
      },
    );
  const archived = async (finished: UnilateralExitPlan) => {
    expect(finished.status).toEqual({ type: 'done' });
    archiveExit(wallet, finished);
    return loadArchive(wallet)[0];
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('walletMnemonic', MNEMONIC);
  });

  it('keeps a co-signed leftover built into it as part of one record, under the sweep and as recoverable funds', async () => {
    const recoverFunds = async () =>
      checked([{ txid: 'c9', kind: 'cooperative', nodeId: 'c-9', txHex: rawTx([`${txidOf(5)}:2`], [29_000]), status: { type: 'unverified' } }], {
        leaves: [coLeaf],
      });
    const prepareRecoverFunds = async () => prepared({ leaves: [coLeaf], funding: undefined, destination: 'bc1qmine' });
    const first = await advanceUnilateralExit(exit('c-9'), chain(), done(91, { prepareRecoverFunds, recoverFunds }), '02abc');
    const paid = chain({ confirmedSpender: async () => ({ txid: 'c9', blockHeight: 95, outputs: [{ address: 'bc1qmine', value: 29_000 }] }) });
    const second = await advanceUnilateralExit(first.plan, paid, done(95), '02abc');

    // Outside the balance when the exit began, though built only on a retry.
    expect(await archived(second.plan)).toMatchObject({
      id: 'sweep',
      txids: ['sweep', 'c9'],
      deliveredSat: 128_000,
      exitedSat: 130_000,
      recoverableFundsSat: 30_000,
      exitFeePaidSat: 5_000,
    });
  });

  it('keeps an exit continued by a unilateral leftover as one record, both sweeps listed and the top-up in its fee', async () => {
    const asking = prepared({ leaves: [soloLeaf], funding: funding(3_000), destination: 'bc1qmine' });
    const nextPart = () =>
      checked(
        [
          { txid: txidOf(2), kind: 'refund', nodeId: 'leaf-2', status: { type: 'waitingForTimelock', spendableAtHeight: 900 } },
          { txid: 'sweep-2', kind: 'sweep', txHex: rawTx([`${txidOf(2)}:0`], [49_500]), dependsOn: [txidOf(2)], status: { type: 'waitingForDependencies' } },
        ],
        { leaves: [soloLeaf] },
      );
    const driver = (height: number) => done(height, { prepareRecoverFunds: async () => asking, recoverFunds: async () => nextPart() });
    const asked = await advanceUnilateralExit(exit('leaf-2'), chain(), driver(91), '02abc');
    expect(topUpOf(asked.plan)?.required).toEqual({ sat: 3_000, inputs: 1 });
    const held = await advanceUnilateralExit(asked.plan, chain({ tipHeight: async () => 101 }), driver(91), '02abc', []);
    const built = await advanceUnilateralExit(held.plan, chain({ tipHeight: async () => 102 }), driver(91), '02abc', [coin(3_000)]);
    expect(built.plan.exit.transactions.map(t => t.txid)).toEqual([txidOf(2), 'sweep-2']);
    const landed = await advanceUnilateralExit(built.plan, chain({ tipHeight: async () => 120 }), driver(120), '02abc');

    expect(await archived(landed.plan)).toMatchObject({
      id: 'sweep-2',
      txids: ['sweep', 'sweep-2'],
      deliveredSat: 148_500,
      exitedSat: 150_000,
      exitFeePaidSat: 8_000,
      exitFeeAddress: key.address,
    });
  });
});

describe('droppedLeafIds', () => {
  it('collects the dropped leaves of every record it is handed', () => {
    const records = [{ droppedLeaves: [{ leafId: 'd-1', valueSats: 5 }] }, {}, { droppedLeaves: [{ leafId: 'd-2', valueSats: 7 }] }];
    expect(droppedLeafIds(records)).toEqual(new Set(['d-1', 'd-2']));
  });
});
