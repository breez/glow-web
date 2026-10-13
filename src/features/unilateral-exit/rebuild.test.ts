import { rebuildExit } from './rebuild';
import { EmptyRecoveryError } from './building';
import { deriveFundingKey } from './funding';
import { awaitsUpdate } from './model/plan';
import { advanceUnilateralExit } from './pass';
import { exitFeeRecordOf, willReceiveSat } from './quote';
import { loadPlan } from './storage/plan';
import {
  blocked,
  checked,
  chain,
  confirmed,
  locked,
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
  v4Plan,
} from './testFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkippedLeafReason } from '@breeztech/breez-sdk-spark';

describe('an exit holding a step the SDK could not read', () => {
  // Glow never sends an Unverified unilateral step, and a check never settles one.
  const stuck = (over: Parameters<typeof plan>[1] = {}) =>
    plan([tx({ txid: 'node', status: { type: 'unverified' } })], { feeRateSatPerVbyte: 4, destination: 'bc1qmine', ...over });
  const rebuilt = checked([{ txid: 'fresh', status: { type: 'ready' } }]);
  const quote = prepared({ feeRateSatPerVbyte: 4, destination: 'bc1qmine' });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('walletMnemonic', MNEMONIC);
  });

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

  it('leaves an unverified co-signed recovery to the network for its first six blocks', async () => {
    const prepareRecoverFunds = vi.fn(async () => quote);
    const cosigned = plan([tx({ txid: 'rec', kind: 'cooperative', nodeId: 'c-1', status: { type: 'unverified' } })]);
    const { plan: next } = await advanceUnilateralExit(cosigned, chain(), sdk({ prepareRecoverFunds }), '02abc');
    expect(prepareRecoverFunds).not.toHaveBeenCalled();
    expect(next.retrySince).toBe(100);
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
    localStorage.removeItem('passkeyLabel');
  });

  it('keeps the exit and marks the block when the rebuild fails', async () => {
    const failing = sdk({
      prepareRecoverFunds: async () => {
        throw new Error('chain service unavailable');
      },
    });
    const { plan: next } = await advanceUnilateralExit(stuck(), chain(), failing, '02abc');
    expect(next).toMatchObject({ status: { type: 'running' }, unverifiedRebuiltAt: 100 });
    expect(next.exit.transactions[0].txid).toBe('node');
  });
});

describe('a converted plan on its next passes', () => {
  const wallet = { identityPubkey: '02abcdef0123456789', network: 'mainnet' };
  const converted = (over: Record<string, unknown> = {}) => {
    localStorage.setItem(`recovery-plan:${wallet.identityPubkey.slice(0, 16)}:mainnet`, JSON.stringify(v4Plan(over)));
    return loadPlan(wallet)!;
  };
  const rebuilt = checked([{ txid: 'fresh', kind: 'refund', status: locked(900) }], { fundingInputs: [] });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('walletMnemonic', MNEMONIC);
  });

  it('keeps sending what is in flight rather than rebuilding over it', async () => {
    const broadcastPackage = vi.fn(async () => undefined);
    const prepareRecoverFunds = vi.fn(async () => prepared());
    const ready = converted();
    ready.exit.transactions[0].status = { type: 'ready' };
    const { plan: next } = await advanceUnilateralExit(ready, chain({ broadcastPackage }), sdk({ prepareRecoverFunds }), '02abc');
    expect(prepareRecoverFunds).not.toHaveBeenCalled();
    expect(broadcastPackage).toHaveBeenCalledWith('aa', 'bb');
    expect(next.status).toEqual({ type: 'running', converted: true });
  });

  it('rebuilds by name once nothing is in flight, passing back the funding it was built from', async () => {
    // The quote echoes the rate and destination it was asked for.
    const quote = prepared({ leaves: [{ leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' }], feeRateSatPerVbyte: 3, destination: 'bc1qold' });
    const prepareRecoverFunds = vi.fn(async () => quote);
    const recoverFunds = vi.fn(async () => rebuilt);
    const { plan: next } = await advanceUnilateralExit(converted(), chain(), sdk({ prepareRecoverFunds, recoverFunds }), '02abc');

    expect(prepareRecoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        feeRateSatPerVbyte: 3,
        destination: 'bc1qold',
        selection: { type: 'specific', leafIds: ['leaf-1', 'leaf-2'] },
      }),
    );
    expect(recoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ fundingInputs: [expect.objectContaining({ txid: 'fund', valueSats: 14_350 })] }),
      expect.anything(),
    );
    expect(next).toMatchObject({ destination: 'bc1qold', feeRateSatPerVbyte: 3, exitStateSnapshot: 'frozen' });
    expect(next.status).toEqual({ type: 'running' });
    expect(next.exit).toBe(rebuilt);
    expect(exitFeeRecordOf(next)).toEqual({ quotedExitFeeSat: 14_350, exitFeeAddress: deriveFundingKey(MNEMONIC, 'mainnet', 1).address });
  });

  it('rebuilds with no inputs and no signer, and without the phrase, when nothing needs funding', async () => {
    localStorage.removeItem('walletMnemonic');
    localStorage.setItem('passkeyLabel', 'Default');
    const recoverFunds = vi.fn(async () => rebuilt);
    const driver = sdk({ prepareRecoverFunds: async () => prepared({ funding: undefined }), recoverFunds });
    const { plan: next } = await advanceUnilateralExit(converted(), chain(), driver, '02abc');
    expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: expect.anything() }]);
    expect(next.status).toEqual({ type: 'running' });
    localStorage.removeItem('passkeyLabel');
  });

  it('keeps running as converted on a passkey wallet that would need to sign, and stops asking', async () => {
    localStorage.removeItem('walletMnemonic');
    localStorage.setItem('passkeyLabel', 'Default');
    const recoverFunds = vi.fn(async () => rebuilt);
    const broadcast = vi.fn(async () => undefined);
    const prepareRecoverFunds = vi.fn(async () => prepared());
    const driver = sdk({ prepareRecoverFunds, recoverFunds });
    const { plan: next } = await advanceUnilateralExit(converted(), chain({ broadcast }), driver, '02abc');
    expect(next.status).toEqual({ type: 'running' });
    expect(recoverFunds).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();

    // Its steps still go out as they come due.
    const due = { ...next, exit: { ...next.exit, transactions: next.exit.transactions.map(t => ({ ...t, status: { type: 'ready' as const } })) } };
    const broadcastPackage = vi.fn(async () => undefined);
    await advanceUnilateralExit(due, chain({ broadcastPackage }), driver, '02abc');
    expect(broadcastPackage).toHaveBeenCalled();
    expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
    localStorage.removeItem('passkeyLabel');
  });

  it('asks for the tap on a passkey wallet when a step it could not read holds it up', async () => {
    localStorage.removeItem('walletMnemonic');
    localStorage.setItem('passkeyLabel', 'Default');
    const stuck = converted();
    stuck.exit.transactions[0].status = { type: 'unverified' };
    const driver = sdk({ prepareRecoverFunds: async () => prepared() });
    const { plan: next } = await advanceUnilateralExit(stuck, chain(), driver, '02abc');
    expect(next.status).toEqual({ type: 'needsUpdate', why: 'signIn', cause: 'unverified' });
    expect(awaitsUpdate(next)).toBe(true);
    localStorage.removeItem('passkeyLabel');
  });

  it('stays active and marked when the rebuild fails, to try again', async () => {
    const driver = sdk({
      prepareRecoverFunds: async () => {
        throw new Error('chain service unavailable');
      },
    });
    const { plan: next } = await advanceUnilateralExit(converted(), chain(), driver, '02abc');
    expect(next.status).toEqual({ type: 'running', converted: true });
  });

  it('finishes as converted when the quote has nothing left to build', async () => {
    const recoverFunds = vi.fn(async () => rebuilt);
    const { plan: next } = await advanceUnilateralExit(converted(), chain(), sdk({ recoverFunds }), '02abc');
    expect(recoverFunds).not.toHaveBeenCalled();
    expect(next.status).toEqual({ type: 'running' });
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['node-1', 'refund-1']);
  });

  it('keeps what that quote found landed when it finishes as converted', async () => {
    const swept = converted();
    swept.exit.transactions = [
      tx({ txid: txidOf(1), kind: 'refund', nodeId: 'leaf-1', status: confirmed(800) }),
      tx({ txid: 'sweep', kind: 'sweep', txHex: rawTx([`${txidOf(1)}:0`], [179_000]), dependsOn: [txidOf(1)], status: blocked }),
    ];
    const { plan: next } = await advanceUnilateralExit(swept, chain(), sdk(), '02abc');
    expect(next).toMatchObject({ landed: [{ leafIds: ['leaf-1'], valueSat: 180_000, outpoint: `${txidOf(1)}:0` }] });
    expect(next.status).toEqual({ type: 'running' });
  });

  it('archives a converted exit the check reads as done', async () => {
    const done = sdk({
      checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: { type: 'done' } }),
    });
    expect((await advanceUnilateralExit(converted(), chain(), done, '02abc')).plan.status).toEqual({ type: 'done' });
  });

  it('hands a diverged one to the usual rebuild, which clears the mark', async () => {
    const driver = sdk({
      checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: redo }),
      prepareRecoverFunds: async () => prepared(),
      recoverFunds: async () => rebuilt,
    });
    const { plan: next } = await advanceUnilateralExit(converted(), chain(), driver, '02abc');
    expect(next.status).toEqual({ type: 'running' });
  });

  it('is not rebuilt without an sdk, which cannot read it back', async () => {
    const { plan: next } = await advanceUnilateralExit(converted(), chain());
    expect(next.status).toEqual({ type: 'running', converted: true });
  });
});

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
