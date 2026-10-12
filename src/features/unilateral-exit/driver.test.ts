import {
  advanceUnilateralExit,
  applyExitCheck,
  awaitsUpdate,
  blocksToFinish,
  broadcastReadyTransactions,
  buildFromQuote,
  checkExit,
  clearPlan,
  EmptyRecoveryError,
  keptLeafIds,
  quoteFresh,
  rebuildExit,
  destinationAddressOf,
  exitStages,
  isSendable,
  loadPlan,
  loadRecoveries,
  nextAction,
  planFromExitResponse,
  requiredFundingOf,
  sentFunding,
  topUpFor,
  planProgress,
  savePlan,
  saveRecoveries,
  startExit,
} from './driver';
import {
  blocked,
  checked,
  coin as feeCoin,
  confirmed,
  locked,
  MNEMONIC,
  pendingExit,
  plan,
  prepared,
  ready,
  sdk,
  sweepHex,
  twoLeaves,
  tx,
} from './testFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckRecoverFundsRequest, RecoveryVerdict, SkippedLeafReason } from '@breeztech/breez-sdk-spark';
import type { ChainClient } from '@/services/chain';
import { deriveFundingKey } from './funding';
import { exitFeeRecordOf } from './quote';

const meta = {
  network: 'mainnet',
  destination: 'bc1qdest',
  feeRateSatPerVbyte: 3,
  fundingAddressIndex: 0,
  quotedSweepFeeSat: 200,
};

describe('planFromExitResponse', () => {
  it('keeps the sdk response whole, for the check to read back', () => {
    const exit = checked([{ txid: 'node-1' }], {
      fundingInputs: [{ type: 'p2wpkh', txid: 'fund', vout: 0, valueSats: 50_000, pubkey: '02ab' }],
    });
    const built = planFromExitResponse(exit, meta);
    expect(built.exit).toBe(exit);
    expect(built).toMatchObject({ ...meta, phase: 'active', refusals: {} });
  });
});

describe('applyExitCheck', () => {
  it('takes the sdk word on the whole exit', () => {
    const exit = checked([{ txid: 'a', status: confirmed(812_345) }], { sweepFeeSats: 250 });
    expect(applyExitCheck(plan([tx({ txid: 'a' })]), exit, 'active').exit).toBe(exit);
  });

  it('keeps the refusal on a step that is still out there', () => {
    const next = applyExitCheck(
      plan([tx({ txid: 'a' })], { refusals: { a: 'txn-mempool-conflict' } }),
      checked([{ txid: 'a', status: ready }]),
      'active',
    );
    expect(next.refusals).toEqual({ a: 'txn-mempool-conflict' });
  });

  it('drops the refusal once the step has confirmed, or is no longer in the set', () => {
    const next = applyExitCheck(
      plan([tx({ txid: 'a' }), tx({ txid: 'b' })], { refusals: { a: 'conflict', b: 'conflict' } }),
      checked([{ txid: 'a', status: confirmed(1) }]),
      'active',
    );
    expect(next.refusals).toEqual({});
  });

  it('sets the phase', () => {
    const next = applyExitCheck(plan([tx({ txid: 'a' })]), checked([{ txid: 'a' }]), 'complete');
    expect(next.phase).toBe('complete');
  });

  describe('a tap asked for over a step the SDK could not read', () => {
    const unverified = { type: 'unverified' } as const;
    const waiting = plan([tx({ txid: 'a', status: unverified })], { needsSignIn: true, redoCause: 'unverified' });

    it('stands while the step does', () => {
      expect(applyExitCheck(waiting, checked([{ txid: 'a', status: unverified }]), 'active')).toMatchObject({
        needsSignIn: true,
        redoCause: 'unverified',
      });
    });

    it('ends once the step settles, or the chain diverges, so a later divergence reads as one', () => {
      for (const [status, phase] of [[ready, 'active'], [unverified, 'redo']] as const) {
        const next = applyExitCheck(waiting, checked([{ txid: 'a', status }]), phase);
        expect(next.redoCause).toBeUndefined();
        expect(next.needsSignIn).toBeUndefined();
      }
    });

    it("leaves a converted exit's sign-in alone, which waits on no such step", () => {
      const converted = plan([tx({ txid: 'a' })], { needsRebuild: true, needsSignIn: true });
      expect(applyExitCheck(converted, checked([{ txid: 'a' }]), 'active').needsSignIn).toBe(true);
    });
  });
});

describe('awaitsUpdate', () => {
  it('asks for the tap on a diverged exit only when its rebuild needs the passkey or failed', () => {
    expect(awaitsUpdate(plan([], { phase: 'redo', needsSignIn: true }))).toBe(true);
    expect(awaitsUpdate(plan([], { phase: 'redo', rebuildFailed: true }))).toBe(true);
  });

  it('leaves a diverged exit Glow rebuilds by itself alone', () => {
    expect(awaitsUpdate(plan([], { phase: 'redo' }))).toBe(false);
  });

  it('asks for the tap on a running exit that has to sign over a step it could not read', () => {
    expect(awaitsUpdate(plan([], { needsSignIn: true, redoCause: 'unverified' }))).toBe(true);
  });

  it('leaves a running exit alone, a converted one waiting to sign included', () => {
    expect(awaitsUpdate(plan([]))).toBe(false);
    expect(awaitsUpdate(plan([], { needsRebuild: true, needsSignIn: true }))).toBe(false);
    // A tap that found nothing to rebuild yet hands the step back to the engine.
    expect(awaitsUpdate(plan([], { redoCause: 'unverified' }))).toBe(false);
    // Left from a divergence the chain has since settled.
    expect(awaitsUpdate(plan([], { rebuildFailed: true }))).toBe(false);
  });

  it('asks nothing of a tap whose rebuild finished the exit, while it waits to be archived', () => {
    expect(awaitsUpdate(plan([], { phase: 'complete', needsSignIn: true, redoCause: 'unverified' }))).toBe(false);
  });
});

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
    expect(loadRecoveries(wallet)).toEqual([recovery]);
    expect(loadRecoveries({ ...wallet, network: 'regtest' })).toEqual([]);
  });
});

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

  it('moves everything to the destination once the sweep confirms', () => {
    const stages = exitStages(
      twoLeaves([
        tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1', status: confirmed(900) }),
        tx({ txid: 's', kind: 'sweep', txHex: sweepHex, status: confirmed(900) }),
      ]),
    );
    expect(stages).toEqual({ inSpark: 0, onChain: 0, delivered: 596_524, willReceive: 596_524 });
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

const chain = (over: Partial<ChainClient> = {}): ChainClient => ({
  feeRates: async () => ({ slow: 1, medium: 2, fast: 3 }),
  addressUtxos: async () => [],
  tipHeight: async () => 100,
  broadcast: async () => undefined,
  broadcastPackage: async () => undefined,
  ...over,
});

const redo: RecoveryVerdict = { type: 'redo', reason: 'onChainStateDiverged' };

const checking = (exit: ReturnType<typeof checked>, verdict: RecoveryVerdict = { type: 'valid' }) =>
  sdk({ checkRecoverFunds: async () => ({ recovery: exit, verdict }) });

describe('broadcastReadyTransactions', () => {
  it('sends a package when the step has a cpfp child', async () => {
    const broadcastPackage = vi.fn(async () => undefined);
    await broadcastReadyTransactions(plan([tx({ txid: 'a', cpfpTxHex: 'bb' })]), chain({ broadcastPackage }));
    expect(broadcastPackage).toHaveBeenCalledWith('aa', 'bb');
  });

  it('leaves a step the sdk is still waiting on alone', async () => {
    const broadcast = vi.fn(async () => undefined);
    await broadcastReadyTransactions(plan([tx({ txid: 'a', status: blocked })]), chain({ broadcast }));
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('sends a ready step on every pass, so one the mempool dropped is put back', async () => {
    const broadcast = vi.fn(async () => undefined);
    const client = chain({ broadcast });
    const once = await broadcastReadyTransactions(plan([tx({ txid: 'a' })]), client);
    await broadcastReadyTransactions(once, client);
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('keeps a refusal on the step without giving up on it', async () => {
    const client = chain({
      broadcast: async () => {
        throw new Error('bad-txns-inputs-missingorspent');
      },
    });
    const after = await broadcastReadyTransactions(plan([tx({ txid: 'a' })]), client);
    expect(after.refusals.a).toMatch(/missingorspent/);
    expect(isSendable(after.exit.transactions[0])).toBe(true);
  });

  it('clears the refusal once the network takes the step', async () => {
    const after = await broadcastReadyTransactions(plan([tx({ txid: 'a' })], { refusals: { a: 'min relay fee not met' } }), chain());
    expect(after.refusals).toEqual({});
  });
});

describe('advanceUnilateralExit', () => {
  // A rebuild derives the fee key from the phrase the wallet is unlocked with.
  beforeEach(() => {
    localStorage.setItem(
      'walletMnemonic',
      'legal winner thank year wave sausage worth useful legal winner thank yellow',
    );
  });

  it('adopts what the check found on-chain, so a step settled elsewhere counts as done', async () => {
    const { plan: next } = await advanceUnilateralExit(
      plan([tx({ txid: 'refund', kind: 'refund' })]),
      chain(),
      checking(checked([{ txid: 'refund', kind: 'refund', status: confirmed(812_345) }])),
    );
    expect(next.exit.transactions[0].status).toEqual({ type: 'confirmed', blockHeight: 812_345 });
  });

  it('finishes the exit on the done verdict', async () => {
    const { plan: next } = await advanceUnilateralExit(
      plan([tx({ txid: 's', kind: 'sweep' })]),
      chain(),
      checking(checked([{ txid: 's', kind: 'sweep', status: confirmed(9) }]), { type: 'done' }),
    );
    expect(next.phase).toBe('complete');
  });

  it('finishes a diverged exit once a quote of its leaves names none of them, since they all landed', async () => {
    const broadcast = vi.fn(async () => undefined);
    const { plan: next } = await advanceUnilateralExit(
      plan([tx({ txid: 'a' })]),
      chain({ broadcast }),
      checking(checked([{ txid: 'a' }]), redo),
      '02abc',
    );
    expect(next.phase).toBe('complete');
    expect(broadcast).not.toHaveBeenCalled();
  });

  // The two cases below cover all four skip reasons, so moving any of them in
  // or out of RETRY_LATER_REASONS fails one.
  const skippedOnly = (reason: SkippedLeafReason) => prepared({ leaves: [], skipped: [{ leafId: 'leaf-1', valueSats: 100_000, reason }] });

  it.each([{ type: 'unverified' }, { type: 'fundsNotFound' }] satisfies SkippedLeafReason[])(
    'waits on a diverged exit while the chain has yet to show where a leaf went ($type), and tries again next pass',
    async reason => {
      const broadcast = vi.fn(async () => undefined);
      const prepareRecoverFunds = vi.fn(async () => skippedOnly(reason));
      const driver = sdk({ checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: redo }), prepareRecoverFunds });
      const first = await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain({ broadcast }), driver, '02abc');
      expect(first.plan.phase).toBe('redo');
      expect(first.plan.needsSignIn).toBeUndefined();
      expect(first.plan.rebuildFailed).toBeUndefined();
      expect(awaitsUpdate(first.plan)).toBe(false);
      await advanceUnilateralExit(first.plan, chain({ broadcast }), driver, '02abc');
      expect(prepareRecoverFunds).toHaveBeenCalledTimes(2);
      expect(broadcast).not.toHaveBeenCalled();
    },
  );

  it.each([{ type: 'feeExceedsValue' }, { type: 'notRecoverable', message: 'stopped' }] satisfies SkippedLeafReason[])(
    'finishes a diverged exit whose only leaves left cost too much or cannot be recovered ($type), leaving them to Recover Funds',
    async reason => {
      const driver = sdk({
        checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: redo }),
        prepareRecoverFunds: async () => skippedOnly(reason),
      });
      const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), driver, '02abc');
      expect(next.phase).toBe('complete');
    },
  );

  it('rebuilds itself when the chain diverges, rather than waiting on the user', async () => {
    const driver = sdk({
      checkRecoverFunds: async () => ({ recovery: checked([{ txid: 'a' }]), verdict: redo }),
      prepareRecoverFunds: async () => prepared(),
      recoverFunds: async () => checked([{ txid: 'fresh', status: ready }]),
    });
    const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), driver, '02abc');
    expect(next.phase).toBe('active');
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['fresh']);
  });

  it('names the leaves it is rebuilding rather than letting them be reselected', async () => {
    const prepareRecoverFunds = vi.fn(async () => prepared());
    const driver = sdk({
      checkRecoverFunds: async () => ({ recovery: checked([{ txid: 'a' }]), verdict: redo }),
      prepareRecoverFunds,
      recoverFunds: async () => checked([{ txid: 'fresh', status: ready }]),
    });
    await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), driver, '02abc');
    expect(prepareRecoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-1'] } }),
    );
  });

  it('hands the funding it was built from back, for the sdk to follow', async () => {
    const recoverFunds = vi.fn(async () => checked([{ txid: 'fresh', status: ready }]));
    const funding = [{ type: 'p2wpkh' as const, txid: 'f', vout: 0, valueSats: 40_000, pubkey: '02ab' }];
    const driver = sdk({
      checkRecoverFunds: async () => ({ recovery: checked([{ txid: 'a' }], { fundingInputs: funding }), verdict: redo }),
      prepareRecoverFunds: async () => prepared(),
      recoverFunds,
    });
    await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), driver, '02abc');
    expect(recoverFunds).toHaveBeenCalledWith(expect.objectContaining({ fundingInputs: funding }), expect.anything());
  });

  it('keeps the sweep fee the exit was first quoted at across a rebuild', async () => {
    const driver = sdk({
      checkRecoverFunds: async () => ({ recovery: checked([{ txid: 'a' }]), verdict: redo }),
      prepareRecoverFunds: async () => prepared({ sweepFeeSats: 180 }),
      recoverFunds: async () => checked([{ txid: 'fresh', status: ready }], { sweepFeeSats: 180 }),
    });
    const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })], { quotedSweepFeeSat: 215 }), chain(), driver, '02abc');
    expect(next.quotedSweepFeeSat).toBe(215);
    expect(next.exit.sweepFeeSats).toBe(180);
  });

  it('raises that floor when a moved leaf comes back co-signed, since its fee comes off what arrives', async () => {
    const quote = prepared({ sweepFeeSats: 180, cooperativeFeeSats: 1_450 });
    const driver = sdk({
      checkRecoverFunds: async () => ({ recovery: checked([{ txid: 'a' }]), verdict: redo }),
      prepareRecoverFunds: async () => quote,
      recoverFunds: async () => checked([{ txid: 'fresh', status: ready }], { sweepFeeSats: 180, cooperativeFeeSats: 1_450 }),
    });
    const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })], { quotedSweepFeeSat: 215 }), chain(), driver, '02abc');
    expect(next.quotedSweepFeeSat).toBe(1_630);
  });

  it('waits for the user rather than prompting for a passkey in the background', async () => {
    // A wallet that keeps no phrase on the device: a rebuild that signs for
    // funding needs a ceremony, which only a button press can ask for.
    localStorage.removeItem('walletMnemonic');
    localStorage.setItem('passkeyLabel', 'Default');
    const recoverFunds = vi.fn(async () => checked([{ txid: 'fresh', status: ready }]));
    const driver = sdk({
      checkRecoverFunds: async () => ({ recovery: checked([{ txid: 'a' }]), verdict: redo }),
      prepareRecoverFunds: async () => prepared(),
      recoverFunds,
    });
    const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), driver, '02abc');
    expect(next.phase).toBe('redo');
    expect(next.needsSignIn).toBe(true);
    expect(recoverFunds).not.toHaveBeenCalled();
    localStorage.removeItem('passkeyLabel');
  });

  it('rebuilds a sweep left on its own without the phrase, so a passkey wallet does not stall', async () => {
    localStorage.removeItem('walletMnemonic');
    localStorage.setItem('passkeyLabel', 'Default');
    const recoverFunds = vi.fn(async () => checked([{ txid: 'sweep', kind: 'sweep', status: ready }]));
    const driver = sdk({
      checkRecoverFunds: async () => ({ recovery: checked([{ txid: 'a' }]), verdict: redo }),
      prepareRecoverFunds: async () => prepared({ funding: undefined, cpfpFeeSats: 0 }),
      recoverFunds,
    });
    const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), driver, '02abc');
    expect(next.phase).toBe('active');
    expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: expect.anything() }]);
    localStorage.removeItem('passkeyLabel');
  });

  it('keeps what the exit fee address was paid when a rebuild leaves only the sweep', async () => {
    const key = deriveFundingKey(MNEMONIC, 'mainnet', 0);
    const funding = [{ type: 'p2wpkh' as const, txid: 'f', vout: 0, valueSats: 14_350, pubkey: key.publicKeyHex }];
    const funded = plan([tx({ txid: 'a' })], { quotedExitFeeSat: 14_350, exit: { fundingInputs: funding } });
    const driver = sdk({
      checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: redo }),
      prepareRecoverFunds: async () => prepared({ funding: undefined, cpfpFeeSats: 0 }),
      // The sdk lists the funding a build was handed, and this one took none.
      recoverFunds: async () => checked([{ txid: 'sweep', kind: 'sweep', status: ready }], { fundingInputs: [] }),
    });
    const { plan: next } = await advanceUnilateralExit(funded, chain(), driver, '02abc');
    expect(next.exit.fundingInputs).toEqual([]);
    expect(next).toMatchObject({ quotedExitFeeSat: 14_350, exitFeeAddress: key.address });
  });

  it('leaves the exit for the user to rebuild when it cannot do it unattended', async () => {
    const driver = sdk({
      checkRecoverFunds: async () => ({ recovery: checked([{ txid: 'a' }]), verdict: redo }),
      prepareRecoverFunds: async () => {
        throw new Error('no recovery phrase on this device');
      },
    });
    const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), driver, '02abc');
    expect(next.phase).toBe('redo');
    expect(next.rebuildFailed).toBe(true);
    expect(awaitsUpdate(next)).toBe(true);
  });

  it('stops asking for the tap once a pass finds the failed rebuild only waiting on the chain', async () => {
    const driver = sdk({
      checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: redo }),
      prepareRecoverFunds: async () => skippedOnly({ type: 'unverified' }),
    });
    const { plan: next } = await advanceUnilateralExit(
      plan([tx({ txid: 'a' })], { phase: 'redo', rebuildFailed: true }),
      chain(),
      driver,
      '02abc',
    );
    expect(next.phase).toBe('redo');
    expect(next.rebuildFailed).toBeUndefined();
  });

  it('stops asking for the tap once a pass rebuilds what had failed', async () => {
    const driver = sdk({
      checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: redo }),
      prepareRecoverFunds: async () => prepared(),
      recoverFunds: async () => checked([{ txid: 'fresh', status: ready }]),
    });
    const { plan: next } = await advanceUnilateralExit(
      plan([tx({ txid: 'a' })], { phase: 'redo', rebuildFailed: true }),
      chain(),
      driver,
      '02abc',
    );
    expect(next.phase).toBe('active');
    expect(next.rebuildFailed).toBeUndefined();
  });

  it('keeps going on the set it holds when the check fails', async () => {
    const failing = sdk({
      checkRecoverFunds: async () => {
        throw new Error('sdk unavailable');
      },
    });
    const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), failing);
    expect(next.exit.transactions).toHaveLength(1);
  });

  it('sends nothing once the exit is complete', async () => {
    const broadcast = vi.fn(async () => undefined);
    await advanceUnilateralExit(
      plan([tx({ txid: 's', kind: 'sweep', status: confirmed(9) })], { phase: 'complete' }),
      chain({ broadcast }),
    );
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('checkExit', () => {
  it('hands the sdk the exit it stored, untouched', async () => {
    const stored = plan([tx({ txid: 'a', cpfpTxHex: 'bb', dependsOn: ['x'] })], { refusals: { a: 'refused' } });
    const checkRecoverFunds = vi.fn(async (_request: CheckRecoverFundsRequest) => ({
      recovery: checked([{ txid: 'a', status: confirmed(9) }]),
      verdict: { type: 'valid' as const },
    }));
    const next = await checkExit(stored, sdk({ checkRecoverFunds }));
    expect(checkRecoverFunds.mock.calls[0][0].recovery).toBe(stored.exit);
    expect(next.exit.transactions[0].status).toEqual(confirmed(9));
  });

  it.each([
    [{ type: 'valid' } as const, 'active'],
    [{ type: 'done' } as const, 'complete'],
    [redo, 'redo'],
  ])('turns the %o verdict into the %s phase', async (verdict, phase) => {
    expect((await checkExit(plan([tx({ txid: 'a' })]), checking(checked([{ txid: 'a' }]), verdict))).phase).toBe(phase);
  });
});

describe('isSendable', () => {
  it('takes the sdk word that a step can go out now', () => {
    expect(isSendable(tx({ txid: 'a', status: ready }))).toBe(true);
  });

  it('holds a step back while the sdk is waiting on something', () => {
    expect(isSendable(tx({ txid: 'a', status: blocked }))).toBe(false);
    expect(isSendable(tx({ txid: 'b', status: locked(244) }))).toBe(false);
    expect(isSendable(tx({ txid: 'c', status: { type: 'unverified' } }))).toBe(false);
    expect(isSendable(tx({ txid: 'd', status: confirmed(90) }))).toBe(false);
  });

  it('sends a co-signed recovery the sdk could not verify, which the network refuses if its funds moved', () => {
    expect(isSendable(tx({ txid: 'c', kind: 'cooperative', status: { type: 'unverified' } }))).toBe(true);
    expect(isSendable(tx({ txid: 'd', kind: 'cooperative', status: confirmed(90) }))).toBe(false);
  });
});

describe('planProgress', () => {
  it('counts confirmed transactions against the total', () => {
    const p = plan([tx({ txid: 'a', status: confirmed(1) }), tx({ txid: 'b' }), tx({ txid: 'c' })]);
    expect(planProgress(p)).toEqual({ confirmed: 1, total: 3, isComplete: false });
  });

  it('is complete on the sdk done verdict', () => {
    const p = plan([tx({ txid: 's', kind: 'sweep', status: confirmed(2) })], { phase: 'complete' });
    expect(planProgress(p).isComplete).toBe(true);
  });

  it('is not complete just because every step confirmed, without a verdict to say so', () => {
    expect(planProgress(plan([tx({ txid: 'n', status: confirmed(1) })])).isComplete).toBe(false);
  });

  it('is not complete when the exit has to be rebuilt', () => {
    expect(planProgress(plan([tx({ txid: 'a' })], { phase: 'redo' })).isComplete).toBe(false);
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

describe('destinationAddressOf', () => {
  const address = { type: 'bitcoinAddress', address: 'bcrt1qdest', network: 'regtest', source: {} } as const;

  it('takes a plain address as it is', () => {
    expect(destinationAddressOf(address as never)).toBe('bcrt1qdest');
  });

  it('takes the address out of a scanned bitcoin: URI', () => {
    const uri = { type: 'bip21', uri: 'bitcoin:bcrt1qdest?amount=1', extras: [], paymentMethods: [address] };
    expect(destinationAddressOf(uri as never)).toBe('bcrt1qdest');
  });

  it('refuses anything that names no on-chain address', () => {
    expect(destinationAddressOf({ type: 'bip21', uri: 'bitcoin:?lightning=lnbc1', extras: [], paymentMethods: [] } as never)).toBeUndefined();
    expect(destinationAddressOf(null)).toBeUndefined();
  });
});

describe('requiredFundingOf', () => {
  it("reads the amount out of the sdk's shortfall error", () => {
    expect(requiredFundingOf('Insufficient CPFP funding: need at least 5898 sats')).toBe(5898);
  });

  it('is null for any other failure', () => {
    expect(requiredFundingOf('signing failed')).toBeNull();
  });

  it('is null for a shortfall of nothing, which no top-up can fix', () => {
    expect(requiredFundingOf('Insufficient CPFP funding: need at least 0 sats')).toBeNull();
  });
});

describe('sentFunding', () => {
  const own = [{ type: 'p2wpkh' as const, txid: 'fund', vout: 0, valueSats: 5_361, pubkey: '02' }];
  const coin = (txid: string, value: number) => ({ txid, vout: 0, value });

  it("counts the exit's own funding while its first transaction is unconfirmed", () => {
    // The sdk replaces that transaction and spends the same coin again.
    const unconfirmed = plan([tx({ txid: 'fan', kind: 'fanOut' })], { exit: { fundingInputs: own } });
    expect(sentFunding(unconfirmed, [coin('top-up', 1_000)])).toEqual({ sat: 6_361, inputs: 2 });
  });

  it('leaves it out once a transaction confirms, since that spent it for good', () => {
    const settled = plan([tx({ txid: 'fan', kind: 'fanOut', status: confirmed(10) })], { exit: { fundingInputs: own } });
    expect(sentFunding(settled, [coin('top-up', 1_000)])).toEqual({ sat: 1_000, inputs: 1 });
  });

  it('still counts it when only a co-signed recovery has confirmed, which spends no funding', () => {
    const cosigned = plan(
      [tx({ txid: 'c', kind: 'cooperative', status: confirmed(10) }), tx({ txid: 'fan', kind: 'fanOut' })],
      { exit: { fundingInputs: own } },
    );
    expect(sentFunding(cosigned, [])).toEqual({ sat: 5_361, inputs: 1 });
  });

  it('counts a coin the address still lists only once', () => {
    const unsent = plan([tx({ txid: 'fan', kind: 'fanOut' })], { exit: { fundingInputs: own } });
    expect(sentFunding(unsent, [coin('fund', 5_361)])).toEqual({ sat: 5_361, inputs: 1 });
  });
});

describe('topUpFor', () => {
  it('asks for the gap plus the fee of the coin that fills it', () => {
    // One more input is 68 vB, so 2 720 sats at 40 sat/vB.
    expect(topUpFor({ sat: 93_122, inputs: 2 }, { sat: 6_361, inputs: 2 }, 40)).toEqual({
      neededSat: 95_842,
      sentSat: 6_361,
      stillToSendSat: 89_481,
    });
  });

  it('is covered once that coin arrives', () => {
    expect(topUpFor({ sat: 93_122, inputs: 2 }, { sat: 95_842, inputs: 3 }, 40).stillToSendSat).toBe(0);
  });

  it('asks again, for the next coin too, when the one sent fell short', () => {
    expect(topUpFor({ sat: 93_122, inputs: 2 }, { sat: 93_122, inputs: 3 }, 40)).toEqual({
      neededSat: 98_562,
      sentSat: 93_122,
      stillToSendSat: 5_440,
    });
  });

  it("asks a quote for its own figure, whose single coin is already priced in, and prices a second one", () => {
    expect(topUpFor({ sat: 5_898, inputs: 1 }, { sat: 0, inputs: 0 }, 2).stillToSendSat).toBe(5_898);
    expect(topUpFor({ sat: 5_898, inputs: 1 }, { sat: 3_000, inputs: 1 }, 2).stillToSendSat).toBe(3_034);
  });
});

describe('buildFromQuote', () => {
  const funding = {
    inputs: [{ type: 'p2wpkh' as const, txid: 'f', vout: 0, valueSats: 6_000, pubkey: '02ab' }],
    secretKey: deriveFundingKey(MNEMONIC, 'regtest', 0).secretKey,
  };

  it('spends the funding and signs for it when the quote needs funding', async () => {
    const recoverFunds = vi.fn(async () => checked([{ txid: 'a' }]));
    await buildFromQuote(sdk({ recoverFunds }), prepared(), funding);
    expect(recoverFunds).toHaveBeenCalledWith(expect.objectContaining({ fundingInputs: funding.inputs }), expect.anything());
  });

  it('builds a quote that needs no funding with no inputs and no signer, whatever it is handed', async () => {
    const recoverFunds = vi.fn(async () => checked([{ txid: 'a' }]));
    const quote = prepared({ funding: undefined });
    await buildFromQuote(sdk({ recoverFunds }), quote, funding);
    expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: quote }]);
  });

  it('refuses a build with no transactions, naming none of the failures to the user', async () => {
    const failed = [
      {
        leafId: 'c-1',
        outputTxid: 'out',
        outputVout: 0,
        error: { type: 'operatorsUnavailable' as const, message: 'operators unreachable' },
      },
    ];
    const recoverFunds = async () => checked([], { failed });
    const build = buildFromQuote(sdk({ recoverFunds }), prepared({ funding: undefined }), null);
    await expect(build).rejects.toBeInstanceOf(EmptyRecoveryError);
    await expect(build).rejects.toMatchObject({ failed, message: 'Please try again.' });
  });

  it('keeps a build where only some co-signing failed', async () => {
    const failed = [
      { leafId: 'c-2', outputTxid: 'out', outputVout: 1, error: { type: 'generic' as const, message: 'refused' } },
    ];
    const built = checked([{ txid: 'c1', kind: 'cooperative' }], { failed });
    await expect(buildFromQuote(sdk({ recoverFunds: async () => built }), prepared({ funding: undefined }), null)).resolves.toBe(built);
  });
});

describe('startExit', () => {
  beforeEach(() => {
    localStorage.setItem('walletMnemonic', MNEMONIC);
  });

  it('quotes what the wallet holds now and builds it from the confirmed fee coins', async () => {
    const prepareRecoverFunds = vi.fn(async () => prepared({ sweepFeeSats: 180 }));
    const recoverFunds = vi.fn(async () => checked([{ txid: 'fan', kind: 'fanOut' }]));
    const outcome = await startExit(
      pendingExit({ fundingAddressIndex: 3 }),
      [feeCoin(5_898)],
      sdk({ prepareRecoverFunds, recoverFunds }),
      '02abc',
    );

    // Not the leaves the first quote picked: a payment since could have spent one.
    expect(prepareRecoverFunds).toHaveBeenCalledWith(expect.objectContaining({ selection: { type: 'all' }, feeRateSatPerVbyte: 2 }));
    expect(recoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ fundingInputs: [expect.objectContaining({ txid: 'coin-5898', valueSats: 5_898 })] }),
      expect.anything(),
    );
    expect(outcome.type).toBe('started');
    if (outcome.type !== 'started') return;
    expect(outcome.plan).toMatchObject({
      fundingAddressIndex: 3,
      quotedSweepFeeSat: 180,
      quotedExitFeeSat: 3_000,
      exitFeeAddress: 'bcrt1qfund',
      exitStateSnapshot: 'snapshot',
    });
    expect(outcome.plan.exit.transactions[0].txid).toBe('fan');
  });

  it('keeps a record of the fee paid when the quote at start no longer needs it', async () => {
    const recoverFunds = vi.fn(async () => checked([{ txid: 'sweep', kind: 'sweep' }]));
    const driver = sdk({ prepareRecoverFunds: async () => prepared({ funding: undefined, cpfpFeeSats: 0 }), recoverFunds });
    const outcome = await startExit(pendingExit(), [feeCoin(5_898)], driver, '02abc');

    // The coins stay at the fee address, which the finished exit points to.
    expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: expect.anything() }]);
    expect(outcome).toMatchObject({ type: 'started', plan: { quotedExitFeeSat: 5_898, exitFeeAddress: 'bcrt1qfund' } });
  });

  it('keeps a recovery a recovery once it is built', async () => {
    const driver = sdk({ prepareRecoverFunds: async () => prepared(), recoverFunds: async () => checked([{ txid: 'fan' }]) });
    const outcome = await startExit(pendingExit({ mode: 'recover' }), [feeCoin(5_898)], driver, '02abc');
    expect(outcome).toMatchObject({ type: 'started', plan: { mode: 'recover' } });
  });

  it('reports what the build says it still needs, sized on the coins it had', async () => {
    const driver = sdk({
      prepareRecoverFunds: async () => prepared(),
      recoverFunds: async () => {
        throw new Error('Insufficient CPFP funding: need at least 6400 sats');
      },
    });
    expect(await startExit(pendingExit(), [feeCoin(5_898)], driver, '02abc')).toEqual({
      type: 'short',
      required: { sat: 6_400, inputs: 1 },
    });
  });

  it('builds nothing once the wallet holds nothing worth its fee', async () => {
    const recoverFunds = vi.fn(async () => checked([{ txid: 'a' }]));
    const driver = sdk({ prepareRecoverFunds: async () => prepared({ leaves: [] }), recoverFunds });
    expect(await startExit(pendingExit(), [feeCoin(5_898)], driver, '02abc')).toEqual({ type: 'nothingToExit' });
    expect(recoverFunds).not.toHaveBeenCalled();
  });

});

/** A plan as SDK 0.26 builds left it on main: `value` fields, no exit fee address. */
const v4Plan = (over: Record<string, unknown> = {}) => ({
  version: 4,
  network: 'mainnet',
  destination: 'bc1qold',
  feeRateSatPerVbyte: 3,
  fundingAddressIndex: 1,
  quotedSweepFeeSat: 215,
  quotedExitFeeSat: 14_350,
  exit: {
    recoverableValueSat: 600_000,
    totalFeeSat: 3_122,
    cpfpFeeSat: 2_907,
    fanoutFeeSat: 0,
    sweepFeeSat: 215,
    leaves: [
      { leafId: 'leaf-1', value: 180_000 },
      { leafId: 'leaf-2', value: 420_000 },
    ],
    transactions: [
      { kind: 'node', nodeId: 'node-1', txid: 'node-1', txHex: 'aa', cpfpTxHex: 'bb', dependsOn: [], status: confirmed(10) },
      { kind: 'refund', nodeId: 'leaf-1', txid: 'refund-1', txHex: 'aa', dependsOn: ['node-1'], status: locked(900) },
    ],
    fundingInputs: [{ type: 'p2wpkh', txid: 'fund', vout: 0, value: 14_350, pubkey: deriveFundingKey(MNEMONIC, 'mainnet', 1).publicKeyHex }],
  },
  refusals: { 'refund-1': 'non-BIP68-final' },
  phase: 'active',
  exitStateSnapshot: 'frozen',
  ...over,
});

describe('a plan stored under SDK 0.26', () => {
  const wallet = { identityPubkey: '02abcdef0123456789', network: 'mainnet' };
  const key = `recovery-plan:${wallet.identityPubkey.slice(0, 16)}:mainnet`;
  const store = (stored: unknown) => localStorage.setItem(key, JSON.stringify(stored));

  beforeEach(() => localStorage.clear());

  it('is converted rather than dropped, keeping everything the exit was built with', () => {
    store(v4Plan());
    const loaded = loadPlan(wallet);
    expect(loaded).toMatchObject({
      version: 5,
      needsRebuild: true,
      phase: 'active',
      destination: 'bc1qold',
      feeRateSatPerVbyte: 3,
      fundingAddressIndex: 1,
      quotedSweepFeeSat: 215,
      quotedExitFeeSat: 14_350,
      exitStateSnapshot: 'frozen',
      refusals: { 'refund-1': 'non-BIP68-final' },
    });
    expect(loaded?.exit).toMatchObject({
      recoverableValueSats: 600_000,
      totalFeeSats: 3_122,
      cooperativeFeeSats: 0,
      cpfpFeeSats: 2_907,
      fanoutFeeSats: 0,
      sweepFeeSats: 215,
      failed: [],
      feeRateSatPerVbyte: 3,
      destination: 'bc1qold',
      leaves: [
        { leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' },
        { leafId: 'leaf-2', valueSats: 420_000, method: 'unilateral' },
      ],
      fundingInputs: [expect.objectContaining({ txid: 'fund', valueSats: 14_350 })],
    });
    expect(loaded?.exit.fundingInputs[0]).not.toHaveProperty('value');
    expect(loaded?.exit.transactions.map(t => t.txid)).toEqual(['node-1', 'refund-1']);
  });

  it('still reads its exit fee off the coins it spent, as main never kept the address', () => {
    store(v4Plan({ quotedExitFeeSat: undefined }));
    expect(exitFeeRecordOf(loadPlan(wallet)!)).toEqual({
      quotedExitFeeSat: 14_350,
      exitFeeAddress: deriveFundingKey(MNEMONIC, 'mainnet', 1).address,
    });
  });

  it('keeps a diverged exit in redo, and a finished one finished', () => {
    store(v4Plan({ phase: 'redo' }));
    expect(loadPlan(wallet)).toMatchObject({ phase: 'redo', needsRebuild: true });
    store(v4Plan({ phase: 'complete' }));
    const done = loadPlan(wallet);
    expect(done?.phase).toBe('complete');
    expect(done?.needsRebuild).toBeUndefined();
  });

  it('drops the co-signed recoveries kept before, which only ever held mock data', () => {
    const kept = plan([tx({ txid: 'c', kind: 'cooperative' })], { mode: 'recover' });
    localStorage.setItem(
      `recovery-cosigned:${wallet.identityPubkey.slice(0, 16)}:mainnet`,
      JSON.stringify([{ ...kept, version: 4 }, kept]),
    );
    expect(loadRecoveries(wallet)).toEqual([kept]);
  });
});

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

  it('leaves an unverified co-signed recovery alone, since Glow sends that one', async () => {
    const prepareRecoverFunds = vi.fn(async () => quote);
    const cosigned = plan([tx({ txid: 'rec', kind: 'cooperative', status: { type: 'unverified' } })]);
    await advanceUnilateralExit(cosigned, chain(), sdk({ prepareRecoverFunds }), '02abc');
    expect(prepareRecoverFunds).not.toHaveBeenCalled();
  });

  it('asks a passkey wallet for the tap, and keeps sending the other steps meanwhile', async () => {
    localStorage.removeItem('walletMnemonic');
    localStorage.setItem('passkeyLabel', 'Default');
    const prepareRecoverFunds = vi.fn(async () => quote);
    const recoverFunds = vi.fn(async () => rebuilt);
    const driver = sdk({ prepareRecoverFunds, recoverFunds });
    const { plan: next } = await advanceUnilateralExit(stuck(), chain(), driver, '02abc');
    expect(next).toMatchObject({ phase: 'active', needsSignIn: true, redoCause: 'unverified', unverifiedRebuiltAt: 100 });
    expect(awaitsUpdate(next)).toBe(true);
    expect(recoverFunds).not.toHaveBeenCalled();

    // Another leaf's step comes due while the tap waits.
    const due = { ...next, exit: { ...next.exit, transactions: [...next.exit.transactions, tx({ txid: 'other', cpfpTxHex: 'bb' })] } };
    const broadcastPackage = vi.fn(async () => undefined);
    const { plan: after } = await advanceUnilateralExit(due, chain({ tipHeight: async () => 101, broadcastPackage }), driver, '02abc');
    expect(broadcastPackage).toHaveBeenCalledWith('aa', 'bb');
    expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
    expect(after).toMatchObject({ phase: 'active', needsSignIn: true, redoCause: 'unverified' });
    localStorage.removeItem('passkeyLabel');
  });

  it('keeps the exit and marks the block when the rebuild fails', async () => {
    const failing = sdk({
      prepareRecoverFunds: async () => {
        throw new Error('chain service unavailable');
      },
    });
    const { plan: next } = await advanceUnilateralExit(stuck(), chain(), failing, '02abc');
    expect(next).toMatchObject({ phase: 'active', unverifiedRebuiltAt: 100 });
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
    expect(next.needsRebuild).toBe(true);
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
    expect(next).toMatchObject({ phase: 'active', destination: 'bc1qold', feeRateSatPerVbyte: 3, exitStateSnapshot: 'frozen' });
    expect(next.needsRebuild).toBeUndefined();
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
    expect(next.needsRebuild).toBeUndefined();
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
    expect(next).toMatchObject({ phase: 'active', needsRebuild: true, needsSignIn: true });
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
    expect(next).toMatchObject({ phase: 'active', needsRebuild: true, needsSignIn: true, redoCause: 'unverified' });
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
    expect(next).toMatchObject({ phase: 'active', needsRebuild: true });
  });

  it('finishes as converted when the quote has nothing left to build', async () => {
    const recoverFunds = vi.fn(async () => rebuilt);
    const { plan: next } = await advanceUnilateralExit(converted(), chain(), sdk({ recoverFunds }), '02abc');
    expect(recoverFunds).not.toHaveBeenCalled();
    expect(next.phase).toBe('active');
    expect(next.needsRebuild).toBeUndefined();
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['node-1', 'refund-1']);
  });

  it('archives a converted exit the check reads as done', async () => {
    const done = sdk({
      checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: { type: 'done' } }),
    });
    expect((await advanceUnilateralExit(converted(), chain(), done, '02abc')).plan.phase).toBe('complete');
  });

  it('hands a diverged one to the usual rebuild, which clears the mark', async () => {
    const driver = sdk({
      checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: redo }),
      prepareRecoverFunds: async () => prepared(),
      recoverFunds: async () => rebuilt,
    });
    const { plan: next } = await advanceUnilateralExit(converted(), chain(), driver, '02abc');
    expect(next.phase).toBe('active');
    expect(next.needsRebuild).toBeUndefined();
  });

  it('is not rebuilt without an sdk, which cannot read it back', async () => {
    const { plan: next } = await advanceUnilateralExit(converted(), chain());
    expect(next.needsRebuild).toBe(true);
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

  it('keeps naming a leaf a quote skipped while its funds were not found yet', async () => {
    const quote = prepared({ skipped: [{ leafId: 'leaf-2', valueSats: 420_000, reason: { type: 'unverified' } }] });
    const prepareRecoverFunds = vi.fn(async () => quote);
    const first = await rebuildExit(twoLeaves([tx({ txid: 'a' })]), sdk({ prepareRecoverFunds }), '02abc');
    expect(first.namedLeaves).toEqual([
      { leafId: 'leaf-1', valueSats: 100_000 },
      { leafId: 'leaf-2', valueSats: 420_000 },
    ]);
    await rebuildExit({ ...first, phase: 'redo' }, sdk({ prepareRecoverFunds }), '02abc');
    expect(prepareRecoverFunds).toHaveBeenLastCalledWith(
      expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-1', 'leaf-2'] } }),
    );
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
    expect((await rebuildExit(plan([tx({ txid: 'a' })]), driver, '02abc')).phase).toBe('complete');
  });

  it('finishes without quoting when the plan names no leaf', async () => {
    const prepareRecoverFunds = vi.fn(async () => prepared());
    const empty = plan([tx({ txid: 'a' })], { exit: { leaves: [] } });
    expect((await rebuildExit(empty, sdk({ prepareRecoverFunds }), '02abc')).phase).toBe('complete');
    expect(prepareRecoverFunds).not.toHaveBeenCalled();
  });
});

describe('what a fresh quote leaves to kept recoveries', () => {
  const kept = (over: Parameters<typeof tx>[0], refusals: Record<string, string> = {}) =>
    plan([tx(over)], {
      mode: 'recover',
      refusals,
      exit: { leaves: [{ leafId: over.nodeId ?? '', valueSats: 30_000, method: 'cooperative' }] },
    });

  it('holds a kept leaf while its recovery is out, and lets it go once the network refused it unverified', () => {
    expect(keptLeafIds([kept({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: ready })])).toEqual(new Set(['c-1']));
    expect(keptLeafIds([kept({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: { type: 'unverified' } })])).toEqual(
      new Set(['c-1']),
    );
    expect(
      keptLeafIds([kept({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: { type: 'unverified' } }, { c1: 'bad-txns-inputs-missingorspent' })]),
    ).toEqual(new Set());
  });

  it('quotes the other leaves again by name, and keeps what both quotes skipped', async () => {
    const prepareRecoverFunds = vi
      .fn()
      .mockResolvedValueOnce(
        prepared({
          leaves: [
            { leafId: 'c-1', valueSats: 30_000, method: 'cooperative' },
            { leafId: 's-1', valueSats: 60_000, method: 'unilateral' },
          ],
          skipped: [
            { leafId: 'dust', valueSats: 350, reason: { type: 'feeExceedsValue' } },
            { leafId: 'c-1', valueSats: 30_000, reason: { type: 'unverified' } },
          ],
        }),
      )
      .mockResolvedValueOnce(prepared({ skipped: [{ leafId: 's-2', valueSats: 900, reason: { type: 'unverified' } }] }));
    const quote = await quoteFresh(sdk({ prepareRecoverFunds }), { feeRateSatPerVbyte: 2, destination: 'bc1qdest' }, 'recover', new Set(['c-1']));

    expect(prepareRecoverFunds).toHaveBeenNthCalledWith(1, expect.objectContaining({ selection: { type: 'recoverableOnly' } }));
    expect(prepareRecoverFunds).toHaveBeenNthCalledWith(2, expect.objectContaining({ selection: { type: 'specific', leafIds: ['s-1'] } }));
    expect(quote.skipped.map(leaf => leaf.leafId)).toEqual(['s-2', 'dust']);
  });

  it('quotes nothing when the kept recoveries hold every leaf', async () => {
    const prepareRecoverFunds = vi.fn(async () => prepared({ leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }] }));
    const quote = await quoteFresh(sdk({ prepareRecoverFunds }), { feeRateSatPerVbyte: 2, destination: 'bc1qdest' }, undefined, new Set(['c-1']));
    expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
    expect(quote).toMatchObject({ leaves: [], recoverableValueSats: 0, totalFeeSats: 0 });
    expect(quote.funding).toBeUndefined();
  });
});

describe('startExit for a recovery', () => {
  beforeEach(() => localStorage.setItem('walletMnemonic', MNEMONIC));

  it('quotes only the funds outside the balance', async () => {
    const prepareRecoverFunds = vi.fn(async () => prepared());
    await startExit(pendingExit({ mode: 'recover' }), [feeCoin(5_898)], sdk({ prepareRecoverFunds }), '02abc');
    expect(prepareRecoverFunds).toHaveBeenCalledWith(expect.objectContaining({ selection: { type: 'recoverableOnly' } }));
  });

  it('leaves a kept recovery its leaves, building the rest', async () => {
    const both = prepared({
      leaves: [
        { leafId: 'c-1', valueSats: 30_000, method: 'cooperative' },
        { leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' },
      ],
    });
    const prepareRecoverFunds = vi.fn().mockResolvedValueOnce(both).mockResolvedValueOnce(prepared());
    const recoverFunds = vi.fn(async () => checked([{ txid: 'fan', kind: 'fanOut' }]));
    const outcome = await startExit(
      pendingExit({ mode: 'recover' }),
      [feeCoin(5_898)],
      sdk({ prepareRecoverFunds, recoverFunds }),
      '02abc',
      undefined,
      new Set(['c-1']),
    );
    expect(prepareRecoverFunds).toHaveBeenLastCalledWith(expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-1'] } }));
    expect(recoverFunds).toHaveBeenCalledWith(expect.objectContaining({ prepared: prepared() }), expect.anything());
    expect(outcome.type).toBe('started');
  });

  it('finds nothing to exit when kept recoveries hold every leaf', async () => {
    const prepareRecoverFunds = vi.fn(async () => prepared({ leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }] }));
    const recoverFunds = vi.fn(async () => checked([{ txid: 'a' }]));
    const outcome = await startExit(pendingExit(), [feeCoin(5_898)], sdk({ prepareRecoverFunds, recoverFunds }), '02abc', undefined, new Set(['c-1']));
    expect(outcome).toEqual({ type: 'nothingToExit' });
    expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
    expect(recoverFunds).not.toHaveBeenCalled();
  });

  it('fails rather than starting an exit whose build came back empty', async () => {
    const driver = sdk({ prepareRecoverFunds: async () => prepared(), recoverFunds: async () => checked([]) });
    await expect(startExit(pendingExit(), [feeCoin(5_898)], driver, '02abc')).rejects.toBeInstanceOf(EmptyRecoveryError);
  });

  it('records the co-signed part of its first build as recoverable funds, and every leaf it names', async () => {
    const quote = prepared({
      leaves: [
        { leafId: 'c-1', valueSats: 30_000, method: 'cooperative' },
        { leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' },
      ],
    });
    const built = checked([{ txid: 'c1', kind: 'cooperative', nodeId: 'c-1' }], {
      leaves: quote.leaves,
    });
    const driver = sdk({ prepareRecoverFunds: async () => quote, recoverFunds: async () => built });
    const outcome = await startExit(pendingExit(), [feeCoin(5_898)], driver, '02abc');
    expect(outcome).toMatchObject({
      type: 'started',
      plan: {
        recoverableFundsSat: 30_000,
        namedLeaves: [
          { leafId: 'c-1', valueSats: 30_000 },
          { leafId: 'leaf-1', valueSats: 100_000 },
        ],
      },
    });
  });
});
