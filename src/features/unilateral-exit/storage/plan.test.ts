import { clearPlan, loadPlan, savePlan } from './plan';
import { loadRecoveries, saveRecoveries } from './recoveries';
import { asKeptRecovery } from '../model/plan';
import { plan, tx } from '../testFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('keeps co-signed recoveries apart from the plan slot', () => {
    const recovery = plan([tx({ txid: 'c', kind: 'cooperative' })], { mode: 'recover' });
    saveRecoveries(wallet, [recovery]);
    expect(loadPlan(wallet)).toBeNull();
    expect(loadRecoveries(wallet)).toEqual([{ ...recovery, namedLeaves: [{ leafId: 'leaf-1', valueSats: 100_000 }] }]);
    expect(loadRecoveries({ ...wallet, network: 'regtest' })).toEqual([]);
  });

  it('names only what a kept recovery built, leaving a leaf whose co-signing failed to the Recoverable Funds row', () => {
    const failed = [{ leafId: 'c-9', outputTxid: 'o', outputVout: 0, error: { type: 'generic' as const, message: 'refused' } }];
    const recovery = plan([tx({ txid: 'c', kind: 'cooperative', nodeId: 'leaf-1' })], {
      mode: 'recover',
      namedLeaves: [
        { leafId: 'leaf-1', valueSats: 100_000 },
        { leafId: 'c-9', valueSats: 30_000 },
      ],
      exit: { failed },
    });
    saveRecoveries(wallet, [recovery]);
    expect(loadRecoveries(wallet)[0].namedLeaves).toEqual([{ leafId: 'leaf-1', valueSats: 100_000 }]);
    expect(asKeptRecovery(recovery).namedLeaves).toEqual([{ leafId: 'leaf-1', valueSats: 100_000 }]);
  });
});

describe('savePlan when the snapshot outgrows storage', () => {
  it('keeps the plan without the snapshot rather than losing the exit', () => {
    // The first write, the whole plan, is the one that does not fit.
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const owner = { identityPubkey: 'snapshot-owner', network: 'regtest' };
    savePlan(owner, plan([tx({ txid: 'a' })], { exitStateSnapshot: 'huge-snapshot' }));

    const kept = loadPlan(owner);
    expect(kept?.exit.transactions[0].txid).toBe('a');
    expect(kept?.exitStateSnapshot).toBeUndefined();
  });
});
