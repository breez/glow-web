import { beforeEach, describe, expect, it } from 'vitest';
import { landedLeavesOf, loadAccounting, recordDropped, recordStopped, retireRecord } from './accounting';
import { plan, prepared } from '../testFixtures';

const wallet = { identityPubkey: 'pubkey-0000000000000000', network: 'regtest' };
const key = `unilateral-exit-accounting:${wallet.identityPubkey.slice(0, 16)}:${wallet.network}`;
const leaf = (leafId: string, valueSats: number) => ({ leafId, valueSats });
const empty = { droppedLeaves: [] };

describe('the Recoverable Funds accounting', () => {
  beforeEach(() => localStorage.clear());

  it('reads as empty when missing or unreadable, and keeps only well-formed leaves', () => {
    expect(loadAccounting(wallet)).toEqual(empty);
    localStorage.setItem(key, '{oops');
    expect(loadAccounting(wallet)).toEqual(empty);
    // Landed leaves an older version kept until a sync are left behind.
    localStorage.setItem(
      key,
      JSON.stringify({ droppedLeaves: [leaf('a', 1), { leafId: 2, valueSats: 3 }, { leafId: 'b' }, null], unsettledLeaves: [leaf('c', 4)] }),
    );
    expect(loadAccounting(wallet)).toEqual({ droppedLeaves: [leaf('a', 1)] });
  });

  it('is kept per wallet and per network', () => {
    recordDropped(wallet, [leaf('d-1', 5_000)]);
    expect(loadAccounting({ ...wallet, identityPubkey: 'other-0000000000000000' })).toEqual(empty);
    expect(loadAccounting({ ...wallet, network: 'mainnet' })).toEqual(empty);
    expect(loadAccounting(wallet).droppedLeaves).toEqual([leaf('d-1', 5_000)]);
  });

  it('takes over what an ended record dropped, each leaf once at its larger value, and nothing it landed', () => {
    localStorage.setItem(key, JSON.stringify({ droppedLeaves: [leaf('d-1', 0), leaf('d-2', 3_000)] }));
    const ended = plan([], {
      status: { type: 'done' },
      droppedLeaves: [leaf('d-1', 5_000)],
      landed: [{ leafIds: ['leaf-1'], valueSat: 100_000, outpoint: 'o:0' }],
    });
    retireRecord(wallet, ended);
    expect(loadAccounting(wallet)).toEqual({ droppedLeaves: [leaf('d-1', 5_000), leaf('d-2', 3_000)] });
  });

  it('dates each stopped leaf when a quote first shows it, keeping that date through what follows', () => {
    const stopping = (...stoppedLeafIds: string[]) => prepared({ exitChainState: { ...prepared().exitChainState, stoppedLeafIds } });
    recordStopped(wallet, stopping('s-1'), 100);
    recordStopped(wallet, stopping('s-1', 's-2'), 104);
    recordDropped(wallet, [leaf('d-1', 5_000)]);
    retireRecord(wallet, plan([], { status: { type: 'done' } }));
    expect(loadAccounting(wallet).stoppedSince).toEqual({ 's-1': 100, 's-2': 104 });

    localStorage.setItem(key, JSON.stringify({ ...empty, stoppedSince: { 's-1': 'soon', 's-2': 104 } }));
    expect(loadAccounting(wallet).stoppedSince).toEqual({ 's-2': 104 });
  });

  it('puts what the leaves of known value leave of an entry on its first leaf without one', () => {
    const swept = plan([], {
      namedLeaves: [leaf('leaf-1', 100_000)],
      landed: [{ leafIds: ['old-1', 'leaf-1', 'old-2'], valueSat: 109_000, txid: 's', paidSat: 108_000 }],
    });
    expect(landedLeavesOf(swept)).toEqual([leaf('old-1', 9_000), leaf('leaf-1', 100_000), leaf('old-2', 0)]);
  });
});
