import { rebuildExit } from './rebuild';
import { EmptyRecoveryError } from './building';
import { willReceiveSat } from './quote';
import { checked, MNEMONIC, plan, prepared, sdk, twoLeaves, tx } from './testFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkippedLeafReason } from '@breeztech/breez-sdk-spark';

describe('rebuildExit', () => {
  beforeEach(() => localStorage.setItem('walletMnemonic', MNEMONIC));

  const failedLeaf = { leafId: 'c-1', outputTxid: 'out', outputVout: 0, error: { type: 'generic' as const, message: 'refused' } };

  it('names the leaves whose co-signing failed too, so a rebuild tries them again', async () => {
    const prepareRecoverFunds = vi.fn(async () => prepared());
    const failing = plan([tx({ txid: 'a' })], { exit: { failed: [failedLeaf] } });
    await rebuildExit(failing, sdk({ prepareRecoverFunds }), '02abc');
    expect(prepareRecoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-1', 'c-1'] } }),
    );
  });

  it.each([
    ['its funds were not found yet', { type: 'unverified' }, []],
    ['the operators stopped it', { type: 'notRecoverable', message: 'stopped' }, ['leaf-2']],
  ] satisfies [string, SkippedLeafReason, string[]][])('keeps naming a leaf a quote skipped while %s', async (_, reason, stoppedLeafIds) => {
    const quote = prepared({
      skipped: [{ leafId: 'leaf-2', valueSats: 420_000, reason }],
      exitChainState: { ...prepared().exitChainState, stoppedLeafIds },
    });
    const prepareRecoverFunds = vi.fn(async () => quote);
    const first = await rebuildExit(twoLeaves([tx({ txid: 'a' })]), sdk({ prepareRecoverFunds }), '02abc');
    expect(first.namedLeaves).toEqual([
      { leafId: 'leaf-1', valueSats: 100_000, feeSat: 200 },
      { leafId: 'leaf-2', valueSats: 420_000 },
    ]);
    expect(first.droppedLeaves).toBeUndefined();
    await rebuildExit({ ...first, status: { type: 'rebuilding' } }, sdk({ prepareRecoverFunds }), '02abc');
    expect(prepareRecoverFunds).toHaveBeenLastCalledWith(
      expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-1', 'leaf-2'] } }),
    );
  });

  it('keeps the fee its last quote put on a leaf a rebuild skipped for now', async () => {
    const quote = prepared({ skipped: [{ leafId: 'leaf-2', valueSats: 420_000, reason: { type: 'unverified' } }] });
    const named = twoLeaves([tx({ txid: 'a' })], {
      namedLeaves: [
        { leafId: 'leaf-1', valueSats: 180_000, feeSat: 100 },
        { leafId: 'leaf-2', valueSats: 420_000, feeSat: 500 },
      ],
    });
    const next = await rebuildExit(named, sdk({ prepareRecoverFunds: async () => quote }), '02abc');
    expect(next.namedLeaves).toEqual([
      { leafId: 'leaf-1', valueSats: 100_000, feeSat: 200 },
      { leafId: 'leaf-2', valueSats: 420_000, feeSat: 500 },
    ]);
  });

  it('keeps the amount when a rebuild skips for now a leaf it built, taking its fee off once', async () => {
    const solo = { leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' as const };
    const start = twoLeaves([tx({ txid: 'a' })], {
      quotedSweepFeeSat: 400,
      namedLeaves: [
        { leafId: 'leaf-1', valueSats: 180_000, feeSat: 200 },
        { leafId: 'leaf-2', valueSats: 420_000, feeSat: 200 },
      ],
    });
    const quote = prepared({
      leaves: [solo],
      recoverableValueSats: 180_000,
      sweepFeeSats: 200,
      funding: undefined,
      skipped: [{ leafId: 'leaf-2', valueSats: 420_000, reason: { type: 'unverified' } }],
    });
    const recoverFunds = async () => checked([{ txid: 'b' }], { leaves: [solo], recoverableValueSats: 180_000 });
    const next = await rebuildExit({ ...start, status: { type: 'rebuilding' } }, sdk({ prepareRecoverFunds: async () => quote, recoverFunds }), '02abc');
    expect(willReceiveSat(start)).toBe(599_600);
    expect(willReceiveSat(next)).toBe(599_600);
  });

  it('keeps which leaves were outside the balance when the exit began, whatever a rebuild co-signs', async () => {
    // The watchtower moved leaf-2, so the rebuild co-signs it, though it was balance.
    const leaves = [
      { leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' as const },
      { leafId: 'leaf-2', valueSats: 420_000, method: 'cooperative' as const },
    ];
    const driver = sdk({
      prepareRecoverFunds: async () => prepared({ leaves, recoverableValueSats: 600_000, cooperativeFeeSats: 1_000 }),
      recoverFunds: async () => checked([{ txid: 'b' }], { leaves, recoverableValueSats: 600_000 }),
    });
    const rebuilt = await rebuildExit(twoLeaves([tx({ txid: 'a' })], { recoverableLeafIds: [] }), driver, '02abc');
    expect(rebuilt.recoverableLeafIds).toEqual([]);

    // One from before the IDs keeps its first build's figure.
    const legacy = await rebuildExit(twoLeaves([tx({ txid: 'a' })], { recoverableFundsSat: 48_200 }), driver, '02abc');
    expect(legacy.recoverableLeafIds).toBeUndefined();
    expect(legacy.recoverableFundsSat).toBe(48_200);
  });

  it('lets a leaf go once a quote names it nowhere, since it landed', async () => {
    const rebuilt = await rebuildExit(twoLeaves([tx({ txid: 'a' })]), sdk({ prepareRecoverFunds: async () => prepared() }), '02abc');
    expect(rebuilt.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['leaf-1']);
  });

  it('passes on a build that came back empty because co-signing failed', async () => {
    const driver = sdk({ prepareRecoverFunds: async () => prepared(), recoverFunds: async () => checked([], { failed: [failedLeaf] }) });
    await expect(rebuildExit(plan([tx({ txid: 'a' })]), driver, '02abc')).rejects.toBeInstanceOf(EmptyRecoveryError);
  });

  it('finishes when the build comes back empty because everything landed meanwhile', async () => {
    const driver = sdk({ prepareRecoverFunds: async () => prepared(), recoverFunds: async () => checked([]) });
    expect((await rebuildExit(plan([tx({ txid: 'a' })]), driver, '02abc')).status).toEqual({ type: 'done' });
  });

  it('finishes without quoting when the plan names no leaf', async () => {
    const prepareRecoverFunds = vi.fn(async () => prepared());
    const empty = plan([tx({ txid: 'a' })], { exit: { leaves: [] } });
    expect((await rebuildExit(empty, sdk({ prepareRecoverFunds }), '02abc')).status).toEqual({ type: 'done' });
    expect(prepareRecoverFunds).not.toHaveBeenCalled();
  });
});
