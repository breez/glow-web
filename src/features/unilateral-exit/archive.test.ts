import { archiveExit, loadArchive } from './archive';
import type { Landing } from './driver';
import { deriveFundingKey } from './funding';
import { confirmed, plan, tx } from './testFixtures';
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
    phase: 'complete',
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
        phase: 'complete',
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
    archiveExit(wallet, plan([], { phase: 'complete', landed: [paid('late', ['leaf-1'], 9_000, 8_800, 30), paid('early', ['leaf-2'], 9_000, 8_800, 20)] }));

    expect(loadArchive(wallet)[0]).toMatchObject({ id: 'early', txids: ['early', 'late'] });
  });

  it('leaves out a transaction that paid the destination nothing, and caps the recoverable part at what exited', () => {
    // A leaf recovered to another address: its own record carries it.
    archiveExit(
      wallet,
      plan([tx({ txid: 'sweep-a', kind: 'sweep', txHex: '00', status: confirmed(10) })], {
        phase: 'complete',
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
        phase: 'complete',
        landed: [{ leafIds: ['leaf-1'], valueSat: 50_000, outpoint: 'refund:0' }],
      }),
    );
    archiveExit(wallet, plan([tx({ txid: 'node-a' })], { phase: 'complete' }));

    expect(loadArchive(wallet)).toEqual([]);
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
        phase: 'complete',
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
        phase: 'complete',
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
        phase: 'complete',
        quotedExitFeeSat: 14_350,
        exitFeeAddress: 'bcrt1qfee',
        exit: { recoverableValueSats: 120_000, fundingInputs: [] },
        landed: [paid('sweep-d', ['leaf-1'], 120_000, 118_900)],
      }),
    );

    expect(loadArchive(wallet)[0]).toMatchObject({ exitFeePaidSat: 14_350, exitFeeAddress: 'bcrt1qfee' });
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
          phase: 'complete',
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

  it('keeps the part of an exit that was outside the balance when it began', () => {
    archiveExit(wallet, { ...finished('sweep-f', 150_000), recoverableFundsSat: 48_200 });
    expect(loadArchive(wallet)[0].recoverableFundsSat).toBe(48_200);
  });

  it('does not count a leaf the watchtower moved mid-exit as recoverable funds', () => {
    const moved = plan(
      [
        tx({ txid: 'coop', kind: 'cooperative', nodeId: 'leaf-2', txHex: '00', status: confirmed(10) }),
        tx({ txid: 'sweep-g', kind: 'sweep', txHex: '00', status: confirmed(10) }),
      ],
      {
        phase: 'complete',
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
