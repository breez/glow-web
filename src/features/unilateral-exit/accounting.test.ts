import { beforeEach, describe, expect, it } from 'vitest';
import { landedLeavesOf, loadAccounting, recordDropped, retireRecord, settleLeaves } from './accounting';
import { plan } from './testFixtures';

const wallet = { identityPubkey: 'pubkey-0000000000000000', network: 'regtest' };
const key = `unilateral-exit-accounting:${wallet.identityPubkey.slice(0, 16)}:${wallet.network}`;
const leaf = (leafId: string, valueSats: number) => ({ leafId, valueSats });
const empty = { droppedLeaves: [], unsettledLeaves: [] };

describe('the Recoverable Funds accounting', () => {
  beforeEach(() => localStorage.clear());

  it('reads as empty when missing or unreadable, and keeps only well-formed leaves', () => {
    expect(loadAccounting(wallet)).toEqual(empty);
    localStorage.setItem(key, '{oops');
    expect(loadAccounting(wallet)).toEqual(empty);
    localStorage.setItem(
      key,
      JSON.stringify({ droppedLeaves: 'd-1', unsettledLeaves: [leaf('a', 1), { leafId: 2, valueSats: 3 }, { leafId: 'b' }, null] }),
    );
    expect(loadAccounting(wallet)).toEqual({ droppedLeaves: [], unsettledLeaves: [leaf('a', 1)] });
  });

  it('is kept per wallet and per network', () => {
    recordDropped(wallet, [leaf('d-1', 5_000)]);
    expect(loadAccounting({ ...wallet, identityPubkey: 'other-0000000000000000' })).toEqual(empty);
    expect(loadAccounting({ ...wallet, network: 'mainnet' })).toEqual(empty);
    expect(loadAccounting(wallet).droppedLeaves).toEqual([leaf('d-1', 5_000)]);
  });

  it('takes over what an ended record dropped and landed, less what a sync settled, each leaf once at its larger value', () => {
    localStorage.setItem(key, JSON.stringify({ droppedLeaves: [leaf('d-1', 0)], unsettledLeaves: [leaf('other', 7_000)] }));
    const ended = plan([], {
      phase: 'complete',
      droppedLeaves: [leaf('d-1', 5_000)],
      landed: [
        { leafIds: ['leaf-1'], valueSat: 100_000, outpoint: 'o:0' },
        { leafIds: ['c-2'], valueSat: 20_000, outpoint: 'o:1' },
      ],
    });
    retireRecord(wallet, ended, new Set(['c-2']));
    expect(loadAccounting(wallet)).toEqual({
      droppedLeaves: [leaf('d-1', 5_000)],
      unsettledLeaves: [leaf('other', 7_000), leaf('leaf-1', 100_000)],
    });
  });

  it('settles only the leaves it is handed', () => {
    localStorage.setItem(key, JSON.stringify({ droppedLeaves: [leaf('d-1', 5_000)], unsettledLeaves: [leaf('a', 1), leaf('b', 2)] }));
    expect(settleLeaves(wallet, ['a'])).toEqual({ droppedLeaves: [leaf('d-1', 5_000)], unsettledLeaves: [leaf('b', 2)] });
    expect(loadAccounting(wallet).unsettledLeaves).toEqual([leaf('b', 2)]);
  });

  it('puts what the leaves of known value leave of an entry on its first leaf without one', () => {
    const swept = plan([], {
      namedLeaves: [leaf('leaf-1', 100_000)],
      landed: [{ leafIds: ['old-1', 'leaf-1', 'old-2'], valueSat: 109_000, txid: 's', paidSat: 108_000 }],
    });
    expect(landedLeavesOf(swept)).toEqual([leaf('old-1', 9_000), leaf('leaf-1', 100_000), leaf('old-2', 0)]);
  });
});
