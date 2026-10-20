import { rebuildExit } from './rebuild';
import { EmptyRecoveryError } from './building';
import { awaitsUpdate } from './model/plan';
import { advanceUnilateralExit } from './pass';
import { willReceiveSat } from './quote';
import { checked, chain, MNEMONIC, plan, prepared, ready, sdk, twoLeaves, tx } from './testFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkippedLeafReason } from '@breeztech/breez-sdk-spark';
import { logger } from '@/services/logger';

beforeEach(() => localStorage.setItem('walletMnemonic', MNEMONIC));

describe('an exit holding a step the SDK could not read', () => {
  // Glow never sends an Unverified unilateral step, and a check never settles one.
  const stuck = (over: Parameters<typeof plan>[1] = {}) =>
    plan([tx({ txid: 'node', status: { type: 'unverified' } })], { feeRateSatPerVbyte: 4, destination: 'bc1qmine', ...over });
  const rebuilt = checked([{ txid: 'fresh', status: { type: 'ready' } }]);
  const quote = prepared({ feeRateSatPerVbyte: 4, destination: 'bc1qmine' });

  it('rebuilds by name at its own rate once nothing is in flight, and marks the block', async () => {
    const prepareRecoverFunds = vi.fn(async () => quote);
    const recoverFunds = vi.fn(async () => rebuilt);
    const { plan: next } = await advanceUnilateralExit(stuck(), chain(), sdk({ prepareRecoverFunds, recoverFunds }), '02abc');
    expect(prepareRecoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ feeRateSatPerVbyte: 4, destination: 'bc1qmine', selection: { type: 'specific', leafIds: ['leaf-1'] } }),
    );
    expect(next.exit).toBe(rebuilt);
    expect(next.unverifiedRebuiltAt).toBe(100);
  });

  it('tries once a block, so a failing chain service is not asked on every pass', async () => {
    const prepareRecoverFunds = vi.fn(async () => quote);
    await advanceUnilateralExit(stuck({ unverifiedRebuiltAt: 100 }), chain(), sdk({ prepareRecoverFunds }), '02abc');
    expect(prepareRecoverFunds).not.toHaveBeenCalled();
    await advanceUnilateralExit(stuck({ unverifiedRebuiltAt: 99 }), chain(), sdk({ prepareRecoverFunds }), '02abc');
    expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
  });

  it('sends what is in flight rather than rebuilding over it', async () => {
    const prepareRecoverFunds = vi.fn(async () => quote);
    const broadcastPackage = vi.fn(async () => undefined);
    const mixed = plan([
      tx({ txid: 'node', status: { type: 'unverified' } }),
      tx({ txid: 'other', cpfpTxHex: 'bb', status: { type: 'ready' } }),
    ]);
    await advanceUnilateralExit(mixed, chain({ broadcastPackage }), sdk({ prepareRecoverFunds }), '02abc');
    expect(prepareRecoverFunds).not.toHaveBeenCalled();
    expect(broadcastPackage).toHaveBeenCalledWith('aa', 'bb');
  });

  it('rebuilds over a step it could not read beside a co-signed recovery in the mempool, which a rebuild hands back', async () => {
    const prepareRecoverFunds = vi.fn(async () => quote);
    const beside = plan(
      [tx({ txid: 'node', status: { type: 'unverified' } }), tx({ txid: 'rec', kind: 'cooperative', nodeId: 'c-1', status: ready })],
      {
        feeRateSatPerVbyte: 4,
        destination: 'bc1qmine',
        exit: {
          leaves: [
            { leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' },
            { leafId: 'c-1', valueSats: 30_000, method: 'cooperative' },
          ],
        },
      },
    );
    await advanceUnilateralExit(beside, chain(), sdk({ prepareRecoverFunds, recoverFunds: async () => rebuilt }), '02abc');
    expect(prepareRecoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-1', 'c-1'] } }),
    );
  });

  it('asks a passkey wallet for the tap, and keeps sending the other steps meanwhile', async () => {
    localStorage.removeItem('walletMnemonic');
    localStorage.setItem('passkeyLabel', 'Default');
    const prepareRecoverFunds = vi.fn(async () => quote);
    const recoverFunds = vi.fn(async () => rebuilt);
    const driver = sdk({ prepareRecoverFunds, recoverFunds });
    const { plan: next } = await advanceUnilateralExit(stuck(), chain(), driver, '02abc');
    expect(next).toMatchObject({ status: { type: 'needsUpdate', why: 'signIn', cause: 'unverified' }, unverifiedRebuiltAt: 100 });
    expect(awaitsUpdate(next)).toBe(true);
    expect(recoverFunds).not.toHaveBeenCalled();

    // Another leaf's step comes due while the tap waits.
    const due = { ...next, exit: { ...next.exit, transactions: [...next.exit.transactions, tx({ txid: 'other', cpfpTxHex: 'bb' })] } };
    const broadcastPackage = vi.fn(async () => undefined);
    const { plan: after } = await advanceUnilateralExit(due, chain({ tipHeight: async () => 101, broadcastPackage }), driver, '02abc');
    expect(broadcastPackage).toHaveBeenCalledWith('aa', 'bb');
    expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
    expect(after.status).toEqual({ type: 'needsUpdate', why: 'signIn', cause: 'unverified' });
  });

  // The SDK's wasm can throw a value that is not an Error.
  const throwing = (thrown: unknown) => async (): Promise<ReturnType<typeof prepared>> => {
    throw thrown;
  };
  const warned = ['Failed to rebuild over an unverified step: chain service unavailable'];
  it.each([
    ['fails', throwing(new Error('chain service unavailable')), warned],
    ['fails with something other than an Error', throwing('chain service unavailable'), warned],
    [
      'finds a leaf that may yet move, which is no failure',
      async () => prepared({ leaves: [], skipped: [{ leafId: 'leaf-1', valueSats: 100_000, reason: { type: 'unverified' } }] }),
      [],
    ],
  ])('keeps the exit and marks the block when the rebuild %s', async (_, prepareRecoverFunds, warnings) => {
    const warn = vi.spyOn(logger, 'warn');
    const { plan: next } = await advanceUnilateralExit(stuck(), chain(), sdk({ prepareRecoverFunds }), '02abc');
    expect(next).toMatchObject({ status: { type: 'running' }, unverifiedRebuiltAt: 100 });
    expect(next.exit.transactions[0].txid).toBe('node');
    expect(warn.mock.calls.map(([, message]) => message)).toEqual(warnings);
  });
});

describe('rebuildExit', () => {
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
