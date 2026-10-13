import {
  advanceUnilateralExit,
  applyExitCheck,
  asKeptRecovery,
  awaitsUpdate,
  blocksToFinish,
  broadcastReadyTransactions,
  buildFromQuote,
  buildLeftover,
  buildRecoveryBump,
  canBumpRecovery,
  checkExit,
  clearPlan,
  EmptyRecoveryError,
  hasWaitingLanding,
  isLanded,
  isStalled,
  keptLeafIds,
  leftoverIdsOf,
  leftoverTopUp,
  quoteFresh,
  rebuildExit,
  destinationAddressOf,
  exitStages,
  isSendable,
  loadPlan,
  loadRecoveries,
  nextAction,
  planFromBuild,
  planFromExitResponse,
  quoteRecoveryBump,
  recordLanded,
  releaseDue,
  requiredFundingOf,
  retryDue,
  sentFunding,
  topUpFor,
  planProgress,
  savePlan,
  saveRecoveries,
  settleLanded,
  startExit,
  RebuildLaterError,
  withLanded,
  type ExitSdk,
  type Landing,
  type UnilateralExitPlan,
} from './driver';
import {
  blocked,
  checked,
  coin as feeCoin,
  confirmed,
  funding,
  locked,
  MNEMONIC,
  pendingExit,
  plan,
  prepared,
  rawTx,
  ready,
  sdk,
  sweepHex,
  twoLeaves,
  tx,
  txidOf,
} from './testFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckRecoverFundsRequest, RecoveryTransaction, RecoveryVerdict, SkippedLeafReason } from '@breeztech/breez-sdk-spark';
import type { ChainClient } from '@/services/chain';
import { logger } from '@/services/logger';
import { deriveFundingKey, MnemonicUnavailableError } from './funding';
import { exitFeeRecordOf, willReceiveSat } from './quote';
import { recoveryTxid } from './archive';

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

  it('moves everything to the destination at its value once the sweep confirms, leaving the amount the one net figure', () => {
    const stages = exitStages(
      twoLeaves([
        tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1', status: confirmed(900) }),
        tx({ txid: 'r2', kind: 'refund', nodeId: 'leaf-2', status: confirmed(900) }),
        tx({ txid: 's', kind: 'sweep', txHex: sweepHex, status: confirmed(900) }),
      ]),
    );
    expect(stages).toEqual({ inSpark: 0, onChain: 0, delivered: 600_000, willReceive: 596_524 });
  });

  it('delivers a co-signed leaf only once its own recovery confirms, though the sweep did, so the total holds', () => {
    const exit = (sweep: RecoveryTransaction['status']) =>
      twoLeaves([
        tx({ txid: 'c1', kind: 'cooperative', nodeId: 'leaf-1', status: ready }),
        tx({ txid: 'r2', kind: 'refund', nodeId: 'leaf-2', status: confirmed(900) }),
        tx({ txid: 's', kind: 'sweep', txHex: sweepHex, status: sweep }),
      ]);
    const total = ({ inSpark, onChain, delivered }: ReturnType<typeof exitStages>) => inSpark + onChain + delivered;
    const swept = exitStages(exit(confirmed(901)));
    expect(swept).toMatchObject({ inSpark: 180_000, onChain: 0, delivered: 420_000 });
    expect(total(exitStages(exit(ready)))).toBe(600_000);
    expect(total(swept)).toBe(600_000);
  });

  it('counts what replaced builds paid out as delivered, though this build never held it', () => {
    const stages = exitStages(
      twoLeaves([tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1' }), tx({ txid: 'r2', kind: 'refund', nodeId: 'leaf-2' })], {
        landed: [
          { leafIds: ['old-1'], valueSat: 50_000, txid: 'old-sweep', paidSat: 49_000 },
          { leafIds: ['old-2'], valueSat: 7_000, outpoint: 'refund:0' },
        ],
      }),
    );
    expect(stages).toMatchObject({ inSpark: 600_000, onChain: 0, delivered: 50_000 });
  });

  it('counts a leaf the plan still names once, as delivered, when a ledger entry covers it', () => {
    const stages = exitStages(
      plan([tx({ txid: 's', kind: 'sweep' })], {
        namedLeaves: [
          { leafId: 'leaf-1', valueSats: 100_000 },
          { leafId: 'c-9', valueSats: 30_000, feeSat: 1_000 },
        ],
        landed: [{ leafIds: ['c-9'], valueSat: 30_000, txid: 'c9', paidSat: 29_000, blockHeight: 9 }],
      }),
    );
    expect(stages).toMatchObject({ inSpark: 100_000, onChain: 0, delivered: 30_000 });
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
  confirmedSpender: async () => null,
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
  const skippedOnly = (reason: SkippedLeafReason, stoppedLeafIds: string[] = []) =>
    prepared({
      leaves: [],
      skipped: [{ leafId: 'leaf-1', valueSats: 100_000, reason }],
      exitChainState: { ...prepared().exitChainState, stoppedLeafIds },
    });

  it.each([
    [{ type: 'unverified' }, []],
    [{ type: 'fundsNotFound' }, []],
    [{ type: 'notRecoverable', message: 'stopped' }, ['leaf-1']],
  ] satisfies [SkippedLeafReason, string[]][])(
    'waits on a diverged exit while a leaf may yet move (%o, stopped: %o), and tries again next pass',
    async (reason, stopped) => {
      const broadcast = vi.fn(async () => undefined);
      const prepareRecoverFunds = vi.fn(async () => skippedOnly(reason, stopped));
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

  it.each([
    [{ type: 'feeExceedsValue' }, undefined],
    [{ type: 'notRecoverable', message: 'stopped' }, [{ leafId: 'leaf-1', valueSats: 100_000 }]],
  ] satisfies [SkippedLeafReason, unknown][])(
    'finishes a diverged exit whose only leaves left cost too much or cannot be recovered (%o), hiding only an unrecoverable one',
    async (reason, dropped) => {
      const driver = sdk({
        checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: redo }),
        prepareRecoverFunds: async () => skippedOnly(reason),
      });
      const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), driver, '02abc');
      expect(next.phase).toBe('complete');
      expect(next.namedLeaves).toEqual([]);
      expect(next.droppedLeaves).toEqual(dropped);
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

  it('leaves the exit for the user to rebuild once it fails unattended across a block', async () => {
    const driver = sdk({
      checkRecoverFunds: async () => ({ recovery: checked([{ txid: 'a' }]), verdict: redo }),
      prepareRecoverFunds: async () => {
        throw new Error('no recovery phrase on this device');
      },
    });
    const at = (tip: number) => chain({ tipHeight: async () => tip });
    // A failure within one block can be a passing outage, so it asks nothing yet.
    const first = await advanceUnilateralExit(plan([tx({ txid: 'a' })]), at(100), driver, '02abc');
    const again = await advanceUnilateralExit(first.plan, at(100), driver, '02abc');
    expect(again.plan).toMatchObject({ phase: 'redo', rebuildFailingSince: 100 });
    expect(awaitsUpdate(again.plan)).toBe(false);

    const { plan: next } = await advanceUnilateralExit(again.plan, at(101), driver, '02abc');
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
      plan([tx({ txid: 'a' })], { phase: 'redo', rebuildFailed: true, rebuildFailingSince: 90 }),
      chain(),
      driver,
      '02abc',
    );
    expect(next.phase).toBe('redo');
    expect(next.rebuildFailed).toBeUndefined();
    expect(next.rebuildFailingSince).toBeUndefined();
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

  describe('naming why a diverged exit asks for the update', () => {
    // Built with both leaves unilateral, so leaf-1 quoting co-signed means the operators moved it.
    const moved = prepared({
      leaves: [
        { leafId: 'leaf-1', valueSats: 180_000, method: 'cooperative' },
        { leafId: 'leaf-2', valueSats: 420_000, method: 'unilateral' },
      ],
    });
    const unmoved = prepared({
      leaves: [
        { leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' },
        { leafId: 'leaf-2', valueSats: 420_000, method: 'unilateral' },
      ],
    });
    const cases = [
      ['the operators moved a leaf it built', moved, undefined, 'watchtower'],
      ['nothing it built moved, clearing a stale cause', unmoved, 'watchtower', undefined],
    ] as const;
    const redoing = (over: Partial<ExitSdk>) => sdk({ checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: redo }), ...over });

    it.each(cases)('on sign-in, when %s', async (_, quote, before, after) => {
      localStorage.removeItem('walletMnemonic');
      localStorage.setItem('passkeyLabel', 'Default');
      try {
        const driver = redoing({ prepareRecoverFunds: async () => quote });
        const { plan: next } = await advanceUnilateralExit(twoLeaves([tx({ txid: 'a' })], { redoCause: before }), chain(), driver, '02abc');
        expect(next).toMatchObject({ phase: 'redo', needsSignIn: true });
        expect(next.redoCause).toBe(after);
      } finally {
        localStorage.removeItem('passkeyLabel');
      }
    });

    it.each(cases)('on a rebuild failing across a block, when %s', async (_, quote, before, after) => {
      const driver = redoing({
        prepareRecoverFunds: async () => quote,
        recoverFunds: async () => {
          throw new Error('operators unavailable');
        },
      });
      const at = (tip: number) => chain({ tipHeight: async () => tip });
      const first = await advanceUnilateralExit(twoLeaves([tx({ txid: 'a' })], { redoCause: before }), at(100), driver, '02abc');
      const { plan: next } = await advanceUnilateralExit(first.plan, at(101), driver, '02abc');
      expect(next).toMatchObject({ phase: 'redo', rebuildFailed: true });
      expect(next.redoCause).toBe(after);
    });
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

  it('counts each transaction a replaced build landed once, as done', () => {
    const p = plan([tx({ txid: 'a', status: confirmed(1) }), tx({ txid: 'b' })], {
      landed: [
        { leafIds: ['old-1'], valueSat: 20_000, txid: 'old-sweep', paidSat: 39_000 },
        { leafIds: ['old-2'], valueSat: 20_000, txid: 'old-sweep', paidSat: 39_000 },
        { leafIds: ['c-9'], valueSat: 9_000, txid: 'old-coop', paidSat: 8_700 },
      ],
    });
    expect(planProgress(p)).toEqual({ confirmed: 3, total: 4, isComplete: false });
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
    expect(loadRecoveries(wallet)).toEqual([{ ...kept, namedLeaves: [{ leafId: 'leaf-1', valueSats: 100_000 }] }]);
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

describe('a co-signed recovery stuck unverified', () => {
  const unverified = { type: 'unverified' } as const;
  const stuckHex = rawTx([`${txidOf(7)}:0`], [29_000]);
  const freshHex = rawTx([`${txidOf(8)}:1`], [28_500]);
  const coLeaf = (leafId: string) => ({ leafId, valueSats: 30_000, method: 'cooperative' as const });
  const stuckTx = (over: Partial<Parameters<typeof tx>[0]> = {}) =>
    tx({ txid: 'c-old', kind: 'cooperative', nodeId: 'c-2', txHex: stuckHex, status: unverified, ...over });
  // A swept leaf and a co-signed one landed; the second co-signed one is stuck.
  const exit = (over: Parameters<typeof plan>[1] = {}) =>
    plan(
      [
        tx({ txid: 'refund', kind: 'refund', nodeId: 'leaf-1', status: confirmed(90) }),
        tx({ txid: 'sweep', kind: 'sweep', dependsOn: ['refund'], status: confirmed(91) }),
        tx({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: confirmed(90) }),
        stuckTx(),
      ],
      {
        feeRateSatPerVbyte: 4,
        destination: 'bc1qmine',
        quotedSweepFeeSat: 2_200,
        retrySince: 94,
        namedLeaves: [
          { leafId: 'leaf-1', valueSats: 100_000 },
          { leafId: 'c-1', valueSats: 30_000 },
          { leafId: 'c-2', valueSats: 30_000 },
        ],
        ...over,
        exit: {
          leaves: [{ leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' }, coLeaf('c-1'), coLeaf('c-2')],
          recoverableValueSats: 160_000,
          ...over.exit,
        },
      },
    );
  const quoteFor = (over: Parameters<typeof prepared>[0] = {}) =>
    prepared({ leaves: [coLeaf('c-2')], funding: undefined, feeRateSatPerVbyte: 4, destination: 'bc1qmine', ...over });
  const builtAs = (txid: string, txHex: string) =>
    checked([{ txid, kind: 'cooperative', nodeId: 'c-2', txHex, status: unverified }], { leaves: [coLeaf('c-2')] });
  const skipping = (reason: SkippedLeafReason) => quoteFor({ leaves: [], skipped: [{ leafId: 'c-2', valueSats: 30_000, reason }] });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('walletMnemonic', MNEMONIC);
  });

  describe('its retry clock', () => {
    it('starts the first pass that reads one unverified, and keeps that height', async () => {
      const prepareRecoverFunds = vi.fn(async () => quoteFor());
      const started = await advanceUnilateralExit(exit({ retrySince: undefined }), chain(), sdk({ prepareRecoverFunds }));
      expect(started.plan.retrySince).toBe(100);
      const kept = await advanceUnilateralExit(exit({ retrySince: 95 }), chain(), sdk({ prepareRecoverFunds }));
      expect(kept.plan.retrySince).toBe(95);
      expect(prepareRecoverFunds).not.toHaveBeenCalled();
    });

    it('stops once the check finds its input in a block', async () => {
      const inBlock = sdk({
        checkRecoverFunds: async ({ recovery }) => ({
          recovery: { ...recovery, transactions: recovery.transactions.map(t => (t.txid === 'c-old' ? { ...t, status: ready } : t)) },
          verdict: { type: 'valid' },
        }),
      });
      const { plan: next } = await advanceUnilateralExit(exit({ retrySince: 90, retriedAt: 96 }), chain(), inBlock);
      expect(next.retrySince).toBeUndefined();
      expect(next.retriedAt).toBeUndefined();
    });

    it('does not start on a pass whose check failed', async () => {
      const failing = sdk({
        checkRecoverFunds: async () => {
          throw new Error('chain service unavailable');
        },
      });
      expect((await advanceUnilateralExit(exit({ retrySince: undefined }), chain(), failing)).plan.retrySince).toBeUndefined();
    });

    it('makes a retry due six blocks after it starts, then at doubling gaps up to a day', () => {
      const at = (retriedAt: number | undefined, tip: number) => retryDue(exit({ retrySince: 100, retriedAt }), tip);
      expect([at(undefined, 105), at(undefined, 106)]).toEqual([false, true]);
      expect([at(106, 111), at(106, 112)]).toEqual([false, true]);
      expect([at(112, 123), at(112, 124)]).toEqual([false, true]);
      expect([at(1_000, 1_143), at(1_000, 1_144)]).toEqual([false, true]);
      expect(retryDue(exit({ retrySince: undefined }), 10_000)).toBe(false);
    });

    it('lets go after about a week', () => {
      expect(releaseDue(exit({ retrySince: 100 }), 1_107)).toBe(false);
      expect(releaseDue(exit({ retrySince: 100 }), 1_108)).toBe(true);
      expect(releaseDue(exit({ retrySince: undefined }), 10_000)).toBe(false);
    });
  });

  describe('as a stall', () => {
    it('is one only when all that is open is co-signed recoveries stuck unverified', () => {
      expect(isStalled(exit())).toBe(true);
      const beside = (open: RecoveryTransaction) => exit({ exit: { transactions: [...exit().exit.transactions, open] } });
      expect(isStalled(beside(tx({ txid: 'refund-2', kind: 'refund', nodeId: 'leaf-3', status: locked(900) })))).toBe(false);
      expect(isStalled(exit({ exit: { transactions: [stuckTx({ status: ready })] } }))).toBe(false);
    });

    it('is not one while what landed waits on a read, or once it is complete', () => {
      expect(isStalled(exit({ landed: [{ leafIds: ['c-1'], valueSat: 30_000, outpoint: `${txidOf(6)}:0` }] }))).toBe(false);
      expect(isStalled(exit({ phase: 'complete' }))).toBe(false);
    });
  });

  it("prepares only the stuck leaf again by name, at the plan's rate and destination, and swaps the new recovery in place", async () => {
    const prepareRecoverFunds = vi.fn(async () => quoteFor());
    const recoverFunds = vi.fn(async () => builtAs('c-new', freshHex));
    const broadcast = vi.fn(async () => undefined);
    const before = exit();
    const { plan: next } = await advanceUnilateralExit(before, chain({ broadcast }), sdk({ prepareRecoverFunds, recoverFunds }));

    expect(prepareRecoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ feeRateSatPerVbyte: 4, destination: 'bc1qmine', selection: { type: 'specific', leafIds: ['c-2'] } }),
    );
    expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: expect.anything() }]);
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['refund', 'sweep', 'c1', 'c-new']);
    expect(next.exit.transactions.slice(0, 3)).toEqual(before.exit.transactions.slice(0, 3));
    expect(next.exit.leaves).toEqual(before.exit.leaves);
    expect(next.exit.recoverableValueSats).toBe(160_000);
    // The new recovery pays 500 less than the stuck one.
    expect(next.quotedSweepFeeSat).toBe(2_700);
    expect(next).toMatchObject({ phase: 'active', retrySince: 94, retriedAt: 100 });
    expect(broadcast).toHaveBeenCalledWith(freshHex);
  });

  it('keeps the plan as it stands, and paces the next try, when the SDK hands back the same transaction', async () => {
    const before = exit();
    const driver = sdk({ prepareRecoverFunds: async () => quoteFor(), recoverFunds: async () => builtAs('c-old', stuckHex) });
    const { plan: next } = await advanceUnilateralExit(before, chain(), driver);
    expect(next.exit).toEqual(before.exit);
    expect(next.quotedSweepFeeSat).toBe(2_200);
    expect(next.retriedAt).toBe(100);
  });

  it.each([{ type: 'unverified' }, { type: 'fundsNotFound' }] satisfies SkippedLeafReason[])(
    'keeps the stuck recovery while the quote skips its leaf for now ($type)',
    async reason => {
      const recoverFunds = vi.fn(async () => builtAs('c-new', freshHex));
      const { plan: next } = await advanceUnilateralExit(exit(), chain(), sdk({ prepareRecoverFunds: async () => skipping(reason), recoverFunds }));
      expect(recoverFunds).not.toHaveBeenCalled();
      expect(next.exit).toEqual(exit().exit);
      expect(next.retriedAt).toBe(100);
    },
  );

  it('keeps the stuck recovery, and paces the next try, when the operators do not co-sign the new one', async () => {
    const failed = [{ leafId: 'c-2', outputTxid: txidOf(8), outputVout: 1, error: { type: 'generic' as const, message: 'refused' } }];
    const driver = sdk({ prepareRecoverFunds: async () => quoteFor(), recoverFunds: async () => checked([], { failed }) });
    const { plan: next } = await advanceUnilateralExit(exit(), chain(), driver);
    expect(next.exit).toEqual(exit().exit);
    expect(next.retriedAt).toBe(100);
  });

  it('keeps the stuck recovery, and paces the next try, when the quote fails', async () => {
    const failing = sdk({
      prepareRecoverFunds: async () => {
        throw new Error('operators unreachable');
      },
    });
    const { plan: next } = await advanceUnilateralExit(exit(), chain(), failing);
    expect(next.exit).toEqual(exit().exit);
    expect(next.retriedAt).toBe(100);
  });

  it('takes a leaf the quote finds unrecoverable out of the exit, and hides it from then on', async () => {
    const driver = sdk({ prepareRecoverFunds: async () => skipping({ type: 'notRecoverable', message: 'paid elsewhere' }) });
    const { plan: next } = await advanceUnilateralExit(exit(), chain(), driver);
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['refund', 'sweep', 'c1']);
    expect(next.exit.leaves.map(leaf => leaf.leafId)).toEqual(['leaf-1', 'c-1']);
    expect(next.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['leaf-1', 'c-1']);
    expect(next.exit.recoverableValueSats).toBe(130_000);
    expect(next.quotedSweepFeeSat).toBe(1_200);
    expect(next.droppedLeaves).toEqual([{ leafId: 'c-2', valueSats: 30_000 }]);
    expect(next.phase).toBe('active');
  });

  it("takes a leaf too dear at the exit's rate out of the exit, still offering it as Recoverable Funds", async () => {
    const driver = sdk({ prepareRecoverFunds: async () => skipping({ type: 'feeExceedsValue' }) });
    const { plan: next } = await advanceUnilateralExit(exit(), chain(), driver);
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['refund', 'sweep', 'c1']);
    expect(next.exit.recoverableValueSats).toBe(130_000);
    expect(next.droppedLeaves).toBeUndefined();
  });

  it('takes a leaf the quote names nowhere out of the exit, recording it as waiting on what spent its input', async () => {
    const { plan: next } = await advanceUnilateralExit(exit(), chain(), sdk({ prepareRecoverFunds: async () => quoteFor({ leaves: [] }) }));
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['refund', 'sweep', 'c1']);
    expect(next.landed).toEqual([expect.objectContaining({ leafIds: ['c-2'], valueSat: 30_000, outpoint: `${txidOf(7)}:0` })]);
    expect(next.droppedLeaves).toBeUndefined();
  });

  it('finishes a recovery left with nothing once its only leaf is taken out', async () => {
    const lone = plan([stuckTx()], { mode: 'recover', retrySince: 94, exit: { leaves: [coLeaf('c-2')], recoverableValueSats: 30_000 } });
    const driver = sdk({ prepareRecoverFunds: async () => skipping({ type: 'notRecoverable', message: 'paid elsewhere' }) });
    const { plan: next } = await advanceUnilateralExit(lone, chain(), driver);
    expect(next.phase).toBe('complete');
    expect(next.exit.transactions).toEqual([]);
  });

  it('lets a leaf still stuck after about a week go, without hiding it, so the exit can finish', async () => {
    const prepareRecoverFunds = vi.fn(async () => quoteFor());
    const late = chain({ tipHeight: async () => 1_102 });
    const { plan: next } = await advanceUnilateralExit(exit(), late, sdk({ prepareRecoverFunds }));
    expect(prepareRecoverFunds).not.toHaveBeenCalled();
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['refund', 'sweep', 'c1']);
    expect(next.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['leaf-1', 'c-1']);
    expect(next.droppedLeaves).toBeUndefined();
    expect(next.retrySince).toBeUndefined();

    const lone = plan([stuckTx()], { mode: 'recover', retrySince: 94, exit: { leaves: [coLeaf('c-2')] } });
    expect((await advanceUnilateralExit(lone, late, sdk())).plan.phase).toBe('complete');
  });

  it('retries mid-exit without the phrase, while unilateral steps wait', async () => {
    localStorage.removeItem('walletMnemonic');
    localStorage.setItem('passkeyLabel', 'Default');
    const prepareRecoverFunds = vi.fn(async () => quoteFor());
    const midway = plan(
      [tx({ txid: 'refund', kind: 'refund', nodeId: 'leaf-1', status: locked(900) }), stuckTx()],
      { feeRateSatPerVbyte: 4, destination: 'bc1qmine', retrySince: 94, exit: { leaves: [coLeaf('c-2')] } },
    );
    const driver = sdk({ prepareRecoverFunds, recoverFunds: async () => builtAs('c-new', freshHex) });
    const { plan: next } = await advanceUnilateralExit(midway, chain(), driver, '02abc');
    expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
    expect(prepareRecoverFunds).toHaveBeenCalledWith(expect.objectContaining({ selection: { type: 'specific', leafIds: ['c-2'] } }));
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['refund', 'c-new']);
    expect(next.exit.transactions[0]).toEqual(midway.exit.transactions[0]);
    expect(next.needsSignIn).toBeUndefined();
    expect(next.phase).toBe('active');
    localStorage.removeItem('passkeyLabel');
  });

  it('prepares nothing again in a pass that rebuilt the exit', async () => {
    const prepareRecoverFunds = vi.fn(async () => quoteFor({ leaves: [{ leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' }] }));
    const both = plan([tx({ txid: 'node', status: unverified }), stuckTx()], {
      retrySince: 90,
      exit: { leaves: [{ leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' }, coLeaf('c-2')] },
    });
    const driver = sdk({ prepareRecoverFunds, recoverFunds: async () => checked([{ txid: 'fresh' }]) });
    const { plan: next } = await advanceUnilateralExit(both, chain(), driver, '02abc');
    expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
    expect(prepareRecoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-1', 'c-2'] } }),
    );
    expect(next.retriedAt).toBeUndefined();
  });

  it('carries the leaves it dropped and its clock across a rebuild', () => {
    const resuming = exit({ retriedAt: 98, droppedLeaves: [{ leafId: 'gone', valueSats: 700 }] });
    const next = planFromBuild(quoteFor(), builtAs('c-2-again', freshHex), resuming, { network: 'mainnet', fundingAddressIndex: 0 });
    expect(next).toMatchObject({ retrySince: 94, retriedAt: 98, droppedLeaves: [{ leafId: 'gone', valueSats: 700 }] });
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

  it('keeps what that quote found landed when it finishes as converted', async () => {
    const swept = converted();
    swept.exit.transactions = [
      tx({ txid: txidOf(1), kind: 'refund', nodeId: 'leaf-1', status: confirmed(800) }),
      tx({ txid: 'sweep', kind: 'sweep', txHex: rawTx([`${txidOf(1)}:0`], [179_000]), dependsOn: [txidOf(1)], status: blocked }),
    ];
    const { plan: next } = await advanceUnilateralExit(swept, chain(), sdk(), '02abc');
    expect(next).toMatchObject({ phase: 'active', landed: [{ leafIds: ['leaf-1'], valueSat: 180_000, outpoint: `${txidOf(1)}:0` }] });
    expect(next.needsRebuild).toBeUndefined();
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
    await rebuildExit({ ...first, phase: 'redo' }, sdk({ prepareRecoverFunds }), '02abc');
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
    const next = await rebuildExit({ ...start, phase: 'redo' }, sdk({ prepareRecoverFunds: async () => quote, recoverFunds }), '02abc');
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

  it('holds a kept leaf while its recovery is out, refused or not', () => {
    expect(keptLeafIds([kept({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: ready })])).toEqual(new Set(['c-1']));
    expect(keptLeafIds([kept({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: { type: 'unverified' } })])).toEqual(
      new Set(['c-1']),
    );
    expect(
      keptLeafIds([kept({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: { type: 'unverified' } }, { c1: 'bad-txns-inputs-missingorspent' })]),
    ).toEqual(new Set(['c-1']));
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

describe('raising the fee of a kept co-signed recovery', () => {
  const coLeaf = (leafId: string, valueSats: number) => ({ leafId, valueSats, method: 'cooperative' as const });
  const leaves = [coLeaf('c-1', 30_000), coLeaf('c-2', 18_200)];
  // Sent at 1 sat/vB to its own address, with a leaf whose co-signing failed.
  const kept = (over: Parameters<typeof plan>[1] = {}) =>
    plan(
      [
        tx({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: ready }),
        tx({ txid: 'c2', kind: 'cooperative', nodeId: 'c-2', status: { type: 'unverified' } }),
      ],
      {
        network: 'regtest',
        mode: 'recover',
        destination: 'bcrt1qmine',
        feeRateSatPerVbyte: 1,
        fundingAddressIndex: 3,
        namedLeaves: [
          { leafId: 'c-1', valueSats: 30_000 },
          { leafId: 'c-2', valueSats: 18_200 },
          { leafId: 'c-9', valueSats: 5_000 },
        ],
        ...over,
        exit: { leaves, recoverableValueSats: 48_200, ...over.exit },
      },
    );
  const bumpQuote = (over: Parameters<typeof prepared>[0] = {}) =>
    prepared({
      leaves,
      recoverableValueSats: 48_200,
      sweepFeeSats: 0,
      cpfpFeeSats: 0,
      cooperativeFeeSats: 1_200,
      totalFeeSats: 1_200,
      funding: undefined,
      feeRateSatPerVbyte: 6,
      destination: 'bcrt1qmine',
      ...over,
    });
  const bumpBuild = (over: Parameters<typeof checked>[1] = {}) =>
    checked(
      [
        { txid: 'c1-bumped', kind: 'cooperative', nodeId: 'c-1' },
        { txid: 'c2-bumped', kind: 'cooperative', nodeId: 'c-2' },
      ],
      { leaves, recoverableValueSats: 48_200, cooperativeFeeSats: 1_200, sweepFeeSats: 0, feeRateSatPerVbyte: 6, destination: 'bcrt1qmine', ...over },
    );

  describe('canBumpRecovery', () => {
    it('offers it while nothing of the recovery has confirmed', () => {
      expect(canBumpRecovery(kept())).toBe(true);
    });

    it('offers none once part of it confirmed, or once it is done or diverged', () => {
      const partly = kept();
      partly.exit.transactions[0] = { ...partly.exit.transactions[0], status: confirmed(90) };
      expect(canBumpRecovery(partly)).toBe(false);
      expect(canBumpRecovery(kept({ phase: 'complete' }))).toBe(false);
      expect(canBumpRecovery(kept({ phase: 'redo' }))).toBe(false);
    });
  });

  describe('quoteRecoveryBump', () => {
    it("names exactly the leaves it built, at its own address and the new rate, not the one whose co-signing failed", async () => {
      const prepareRecoverFunds = vi.fn(async () => bumpQuote());
      const quote = await quoteRecoveryBump(sdk({ prepareRecoverFunds }), kept(), 6);

      expect(prepareRecoverFunds).toHaveBeenCalledWith(
        expect.objectContaining({
          feeRateSatPerVbyte: 6,
          destination: 'bcrt1qmine',
          selection: { type: 'specific', leafIds: ['c-1', 'c-2'] },
        }),
      );
      expect(quote).toEqual(bumpQuote());
    });

    it.each([
      ['skips one of its leaves', bumpQuote({ leaves: [leaves[0]], skipped: [{ leafId: 'c-2', valueSats: 18_200, reason: { type: 'feeExceedsValue' } }] })],
      ['leaves one of its leaves out', bumpQuote({ leaves: [leaves[0]] })],
      ['needs funding', bumpQuote({ funding: funding(3_000) })],
      ['would move a leaf unilaterally', bumpQuote({ leaves: [leaves[0], { ...leaves[1], method: 'unilateral' }] })],
    ])('comes back empty when the quote %s', async (_, quote) => {
      const bump = await quoteRecoveryBump(sdk({ prepareRecoverFunds: async () => quote }), kept(), 6);
      expect(bump).toMatchObject({ leaves: [], recoverableValueSats: 0, totalFeeSats: 0, cooperativeFeeSats: 0 });
      expect(bump.funding).toBeUndefined();
    });
  });

  describe('buildRecoveryBump', () => {
    it('builds with no inputs and no signer, into a recovery at the new rate that keeps where it goes', async () => {
      const recoverFunds = vi.fn(async () => bumpBuild());
      const next = await buildRecoveryBump(sdk({ recoverFunds }), kept(), bumpQuote());

      expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: bumpQuote() }]);
      expect(next).toMatchObject({
        mode: 'recover',
        phase: 'active',
        network: 'regtest',
        destination: 'bcrt1qmine',
        feeRateSatPerVbyte: 6,
        fundingAddressIndex: 3,
        quotedSweepFeeSat: 1_200,
      });
      expect(next.exit.transactions.map(t => t.txid)).toEqual(['c1-bumped', 'c2-bumped']);
    });

    it('carries what the recovery dropped and what landed elsewhere, which its record alone keeps', async () => {
      const landed = [{ leafIds: ['c-3'], valueSat: 9_000, outpoint: `${txidOf(5)}:0` }];
      const droppedLeaves = [{ leafId: 'c-4', valueSats: 2_000 }];
      const next = await buildRecoveryBump(sdk({ recoverFunds: async () => bumpBuild() }), kept({ landed, droppedLeaves }), bumpQuote());
      expect(next).toMatchObject({ landed, droppedLeaves });
    });

    it('builds nothing to keep when a leaf it had to replace was left out', async () => {
      const partial = bumpBuild({
        leaves: [leaves[0]],
        transactions: [tx({ txid: 'c1-bumped', kind: 'cooperative', nodeId: 'c-1' })],
        failed: [
          {
            leafId: 'c-2',
            outputTxid: 'o',
            outputVout: 0,
            error: { type: 'replacementFeeTooLow', requiredFeeSats: 1_600, requiredFeeRateSatPerVbyte: 8 },
          },
        ],
      });
      const bump = buildRecoveryBump(sdk({ recoverFunds: async () => partial }), kept(), bumpQuote());
      await expect(bump).rejects.toBeInstanceOf(EmptyRecoveryError);
      await expect(bump).rejects.toMatchObject({ failed: partial.failed, message: 'Please try again or choose a different fee.' });
    });

    it('offers a different fee too when the build comes back with nothing at all', async () => {
      const failed = [
        {
          leafId: 'c-1',
          outputTxid: 'o',
          outputVout: 0,
          error: { type: 'replacementFeeTooLow' as const, requiredFeeSats: 1_600, requiredFeeRateSatPerVbyte: 8 },
        },
      ];
      const bump = buildRecoveryBump(sdk({ recoverFunds: async () => bumpBuild({ leaves: [], transactions: [], failed }) }), kept(), bumpQuote());
      await expect(bump).rejects.toBeInstanceOf(EmptyRecoveryError);
      await expect(bump).rejects.toMatchObject({ failed, message: 'Please try again or choose a different fee.' });
    });

    it('passes on any other refusal as the SDK gave it', async () => {
      const refused = new Error('operators unavailable');
      const bump = buildRecoveryBump(sdk({ recoverFunds: async () => Promise.reject(refused) }), kept(), bumpQuote());
      await expect(bump).rejects.toBe(refused);
    });
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

  it('records the co-signed leaves of its first quote as recoverable funds, and every leaf it names', async () => {
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
        recoverableLeafIds: ['c-1'],
        recoverableFundsSat: undefined,
        namedLeaves: [
          { leafId: 'c-1', valueSats: 30_000 },
          { leafId: 'leaf-1', valueSats: 100_000 },
        ],
      },
    });
  });

  it('counts a co-signed leaf the operators did not co-sign at once as recoverable funds too, naming it with its share of the fee', async () => {
    const quote = prepared({
      leaves: [
        { leafId: 'c-1', valueSats: 30_000, method: 'cooperative' },
        { leafId: 'c-2', valueSats: 18_200, method: 'cooperative' },
        { leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' },
      ],
      cooperativeFeeSats: 2_900,
    });
    const built = checked([{ txid: 'c1', kind: 'cooperative', nodeId: 'c-1' }], {
      leaves: [quote.leaves[0], quote.leaves[2]],
      failed: [{ leafId: 'c-2', outputTxid: 'o', outputVout: 0, error: { type: 'generic', message: 'refused' } }],
    });
    const driver = sdk({ prepareRecoverFunds: async () => quote, recoverFunds: async () => built });
    const outcome = await startExit(pendingExit(), [feeCoin(5_898)], driver, '02abc');
    expect(outcome).toMatchObject({
      type: 'started',
      plan: {
        recoverableLeafIds: ['c-1', 'c-2'],
        namedLeaves: [
          { leafId: 'c-1', valueSats: 30_000, feeSat: 1_450 },
          { leafId: 'c-2', valueSats: 18_200, feeSat: 1_450 },
          { leafId: 'leaf-1', valueSats: 100_000, feeSat: 200 },
        ],
      },
    });
  });
});

describe('the ledger of what landed', () => {
  const refund = (n: number, leafId: string, status = confirmed(100)) =>
    tx({ txid: txidOf(n), kind: 'refund', nodeId: leafId, status });
  const sweep = (txid: string, refunds: number[], paidSat: number, status = ready) =>
    tx({
      txid,
      kind: 'sweep',
      txHex: rawTx(refunds.map(n => `${txidOf(n)}:0`), [paidSat]),
      dependsOn: refunds.map(txidOf),
      status,
    });
  const cosigned = (txid: string, leafId: string, spends: string, status = ready) =>
    tx({ txid, kind: 'cooperative', nodeId: leafId, txHex: rawTx([spends], [29_000]), status });
  const coLeaf = (leafId: string, valueSats = 30_000) => ({ leafId, valueSats, method: 'cooperative' as const });
  const confirmedAs = (p: UnilateralExitPlan, txid: string, blockHeight = 120) => ({
    ...p.exit,
    transactions: p.exit.transactions.map(t => (t.txid === txid ? { ...t, status: confirmed(blockHeight) } : t)),
  });

  describe('as a check records it', () => {
    it('records a confirmed sweep from its own hex: what it paid, its block, and the leaves of the refunds it spends', () => {
      const swept = twoLeaves([refund(1, 'leaf-1'), refund(2, 'leaf-2'), sweep('sweep', [1, 2], 596_524)]);
      const next = applyExitCheck(swept, confirmedAs(swept, 'sweep'), 'complete');
      expect(next.landed).toEqual([
        { leafIds: ['leaf-1', 'leaf-2'], valueSat: 600_000, txid: 'sweep', paidSat: 596_524, blockHeight: 120 },
      ]);
      expect(hasWaitingLanding(next)).toBe(false);
    });

    it('records a confirmed co-signed recovery as waiting on the outpoint it spends, and nothing before it confirms', () => {
      const recovery = plan([cosigned('c1', 'c-1', `${txidOf(9)}:1`)], { exit: { leaves: [coLeaf('c-1')] } });
      expect(applyExitCheck(recovery, recovery.exit, 'active').landed).toBeUndefined();

      const next = applyExitCheck(recovery, confirmedAs(recovery, 'c1'), 'complete');
      expect(next.landed).toEqual([{ leafIds: ['c-1'], valueSat: 30_000, outpoint: `${txidOf(9)}:1` }]);
      expect(hasWaitingLanding(next)).toBe(true);
    });

    it('records nothing twice: a sweep it holds, or a replacement built for a leaf already recorded', () => {
      const swept = twoLeaves([refund(1, 'leaf-1'), sweep('sweep', [1], 179_000, confirmed(120))], {
        landed: [{ leafIds: ['leaf-1'], valueSat: 180_000, txid: 'sweep', paidSat: 179_000, blockHeight: 120 }],
      });
      expect(recordLanded(swept)).toBe(swept);

      const replaced = plan([cosigned('c1-again', 'c-1', `${txidOf(9)}:1`, confirmed(120))], {
        exit: { leaves: [coLeaf('c-1')] },
        landed: [{ leafIds: ['c-1'], valueSat: 30_000, outpoint: `${txidOf(9)}:1` }],
      });
      expect(recordLanded(replaced)).toBe(replaced);
    });

    it('keeps what a sweep paid without counting a leaf already waiting on a read twice', () => {
      const waiting: Landing = { leafIds: ['leaf-1'], valueSat: 180_000, outpoint: `${txidOf(1)}:0` };
      const swept = twoLeaves([refund(1, 'leaf-1'), sweep('sweep', [1], 179_000, confirmed(120))], { landed: [waiting] });
      expect(recordLanded(swept).landed).toEqual([
        waiting,
        { leafIds: [], valueSat: 0, txid: 'sweep', paidSat: 179_000, blockHeight: 120 },
      ]);
      // That entry names no leaf, so only its txid says it is this build's own and not an earlier one's.
      expect(willReceiveSat(recordLanded(swept))).toBe(179_000);
    });

    it('skips a transaction whose hex does not parse', () => {
      const unreadable = plan([
        tx({ txid: 's', kind: 'sweep', txHex: 'zz', status: confirmed(1) }),
        tx({ txid: 'c', kind: 'cooperative', nodeId: 'c-1', txHex: '00', status: confirmed(1) }),
      ]);
      expect(recordLanded(unreadable)).toBe(unreadable);
    });
  });

  describe('across a rebuild', () => {
    // A co-signed leaf, two swept leaves, and two named leaves with nothing built.
    const replaced = (over: Parameters<typeof plan>[1] = {}) =>
      plan([cosigned('c1', 'c-1', `${txidOf(9)}:1`), refund(1, 'leaf-1'), refund(2, 'leaf-2'), sweep('sweep', [1, 2], 596_524)], {
        namedLeaves: [
          { leafId: 'c-1', valueSats: 30_000 },
          { leafId: 'leaf-1', valueSats: 180_000 },
          { leafId: 'leaf-2', valueSats: 420_000 },
          { leafId: 'leaf-3', valueSats: 5_000 },
          { leafId: 'leaf-4', valueSats: 600 },
        ],
        ...over,
        exit: {
          leaves: [coLeaf('c-1'), { leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' }, { leafId: 'leaf-2', valueSats: 420_000, method: 'unilateral' }],
          ...over.exit,
        },
      });
    const earlier: Landing = { leafIds: ['old'], valueSat: 5, txid: 'old-tx', paidSat: 4 };

    it('carries the ledger, and records a leaf the quote lists nowhere by the outpoint the replaced build spends', () => {
      const quote = prepared({
        leaves: [{ leafId: 'leaf-2', valueSats: 420_000, method: 'unilateral' }],
        skipped: [{ leafId: 'leaf-4', valueSats: 600, reason: { type: 'feeExceedsValue' } }],
      });
      const next = planFromBuild(quote, checked([{ txid: 'fresh' }]), replaced({ landed: [earlier] }), { network: 'mainnet', fundingAddressIndex: 0 });
      // leaf-3 had nothing built, so the replaced build holds no outpoint for it.
      expect(next.landed).toEqual([
        earlier,
        { leafIds: ['c-1'], valueSat: 30_000, outpoint: `${txidOf(9)}:1` },
        { leafIds: ['leaf-1'], valueSat: 180_000, outpoint: `${txidOf(1)}:0` },
      ]);
    });

    it('records only the leaves it is asked about', () => {
      expect(withLanded(replaced(), null, ['leaf-1'])).toEqual([{ leafIds: ['leaf-1'], valueSat: 180_000, outpoint: `${txidOf(1)}:0` }]);
    });

    it('records a leaf whose co-signing failed by the output it failed to spend', () => {
      const failing = replaced({
        exit: { failed: [{ leafId: 'leaf-3', outputTxid: txidOf(5), outputVout: 2, error: { type: 'generic', message: 'refused' } }] },
      });
      expect(withLanded(failing, null, ['leaf-3'])).toEqual([{ leafIds: ['leaf-3'], valueSat: 5_000, outpoint: `${txidOf(5)}:2` }]);
    });

    it('records a co-signed leaf the build left out, its recovery already in a block, and names it no more', () => {
      const soloTwo = { leafId: 'leaf-2', valueSats: 420_000, method: 'unilateral' as const };
      const quote = prepared({ leaves: [coLeaf('c-1'), soloTwo] });
      const built = checked([{ txid: 'fresh' }], { leaves: [soloTwo] });
      const next = planFromBuild(quote, built, replaced(), { network: 'mainnet', fundingAddressIndex: 0 });
      expect(next.landed).toContainEqual({ leafIds: ['c-1'], valueSat: 30_000, outpoint: `${txidOf(9)}:1` });
      expect(next.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['leaf-2']);

      // One the operators refused is still to come, so it stays named and unrecorded.
      const failure = { leafId: 'c-1', outputTxid: txidOf(9), outputVout: 1, error: { type: 'generic' as const, message: 'refused' } };
      const refused = planFromBuild(quote, { ...built, failed: [failure] }, replaced(), { network: 'mainnet', fundingAddressIndex: 0 });
      expect(refused.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['c-1', 'leaf-2']);
      expect(refused.landed?.flatMap(entry => entry.leafIds)).not.toContain('c-1');
    });

    it("starts no ledger for a first build", () => {
      expect(planFromBuild(prepared(), checked([{ txid: 'fresh' }]), null, { network: 'mainnet', fundingAddressIndex: 0 }).landed).toBeUndefined();
    });
  });

  describe('when a rebuild finishes the exit', () => {
    beforeEach(() => localStorage.setItem('walletMnemonic', MNEMONIC));
    const swept = () => twoLeaves([refund(1, 'leaf-1'), refund(2, 'leaf-2'), sweep('own-sweep', [1, 2], 596_524)]);

    it('records every leaf the empty quote lists nowhere as waiting, and not its own sweep as landed', async () => {
      const finished = await rebuildExit(swept(), sdk({ prepareRecoverFunds: async () => prepared({ leaves: [] }) }), '02abc');
      expect(finished.phase).toBe('complete');
      expect(finished.landed).toEqual([
        { leafIds: ['leaf-1'], valueSat: 180_000, outpoint: `${txidOf(1)}:0` },
        { leafIds: ['leaf-2'], valueSat: 420_000, outpoint: `${txidOf(2)}:0` },
      ]);
    });

    it('records what landed between the quote and the build, leaving out what the quote skipped', async () => {
      const driver = sdk({
        prepareRecoverFunds: async () =>
          prepared({
            leaves: [{ leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' }],
            skipped: [{ leafId: 'leaf-2', valueSats: 420_000, reason: { type: 'feeExceedsValue' } }],
          }),
        recoverFunds: async () => checked([]),
      });
      const finished = await rebuildExit(swept(), driver, '02abc');
      expect(finished.phase).toBe('complete');
      expect(finished.landed).toEqual([{ leafIds: ['leaf-1'], valueSat: 180_000, outpoint: `${txidOf(1)}:0` }]);
    });
  });

  describe('reading what paid a waiting entry out', () => {
    const outpoint = `${txidOf(9)}:1`;
    const settled: Landing = { leafIds: ['leaf-1'], valueSat: 180_000, txid: 'sweep', paidSat: 179_000 };
    const waiting = (over: Partial<Landing> = {}) =>
      plan([], { destination: 'bc1qDest', landed: [{ leafIds: ['c-1'], valueSat: 30_000, outpoint, ...over }, settled] });

    it('reads nothing when no entry waits', async () => {
      const confirmedSpender = vi.fn(async () => null);
      const done = plan([], { landed: [settled] });
      expect(await settleLanded(done, chain({ confirmedSpender }), 100)).toBe(done);
      expect(confirmedSpender).not.toHaveBeenCalled();
    });

    it('takes the transaction that spent the outpoint, a replacement included, and only what it paid the destination', async () => {
      const confirmedSpender = vi.fn(async () => ({
        txid: 'replacement',
        blockHeight: 99,
        outputs: [{ address: 'BC1QDEST', value: 28_000 }, { address: 'bc1qother', value: 1_000 }, { value: 0 }],
      }));
      const next = await settleLanded(waiting({ unreadSince: 98 }), chain({ confirmedSpender }), 100);
      expect(confirmedSpender).toHaveBeenCalledWith(txidOf(9), 1);
      expect(next.landed).toEqual([
        { leafIds: ['c-1'], valueSat: 30_000, outpoint, txid: 'replacement', blockHeight: 99, paidSat: 28_000 },
        settled,
      ]);
    });

    it('keeps an entry whose read failed, however long it has waited', async () => {
      const failing = chain({
        confirmedSpender: async () => {
          throw new Error('rate limited');
        },
      });
      const stale = waiting({ unreadSince: 10 });
      expect((await settleLanded(stale, failing, 1_000)).landed).toEqual(stale.landed);
    });

    it('drops an entry nothing spent in a block for six blocks, so the exit still finishes', async () => {
      const unspent = chain({ confirmedSpender: async () => null });
      const first = await settleLanded(waiting(), unspent, 100);
      expect(first.landed?.[0].unreadSince).toBe(100);
      expect((await settleLanded(first, unspent, 105)).landed).toHaveLength(2);
      expect((await settleLanded(first, unspent, 106)).landed).toEqual([settled]);
    });
  });

  describe('on a pass', () => {
    const outpoint = `${txidOf(1)}:0`;
    const paidBy = (txid: string) =>
      vi.fn<ChainClient['confirmedSpender']>(async () => ({ txid, blockHeight: 110, outputs: [{ address: 'bc1qdest', value: 99_000 }] }));

    beforeEach(() => {
      localStorage.clear();
      localStorage.setItem('walletMnemonic', MNEMONIC);
    });

    it('finishes a diverged exit whose older sweep landed, naming that sweep and what it paid', async () => {
      const confirmedSpender = paidBy('old-sweep');
      const broadcast = vi.fn(async () => undefined);
      const driver = sdk({
        checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: redo }),
        prepareRecoverFunds: async () => prepared({ leaves: [] }),
      });
      const current = plan([refund(1, 'leaf-1'), sweep('new-sweep', [1], 99_500)]);
      const { plan: next } = await advanceUnilateralExit(current, chain({ broadcast, confirmedSpender }), driver, '02abc');
      expect(next.phase).toBe('complete');
      expect(next.landed).toEqual([
        { leafIds: ['leaf-1'], valueSat: 100_000, outpoint, txid: 'old-sweep', blockHeight: 110, paidSat: 99_000 },
      ]);
      expect(broadcast).not.toHaveBeenCalled();
    });

    it('reads again for a finished exit still waiting on its ledger', async () => {
      const confirmedSpender = paidBy('sweep');
      const finished = plan([], { phase: 'complete', landed: [{ leafIds: ['leaf-1'], valueSat: 100_000, outpoint }] });
      const { plan: next } = await advanceUnilateralExit(finished, chain({ confirmedSpender }));
      expect(confirmedSpender).toHaveBeenCalledTimes(1);
      expect(hasWaitingLanding(next)).toBe(false);
    });

    it('sends what is ready even when the read fails', async () => {
      const broadcast = vi.fn(async () => undefined);
      const failing = chain({
        broadcast,
        confirmedSpender: async () => {
          throw new Error('rate limited');
        },
      });
      const running = plan([tx({ txid: 'a' })], { landed: [{ leafIds: ['old'], valueSat: 9_000, outpoint }] });
      const { plan: next } = await advanceUnilateralExit(running, failing, sdk(), '02abc');
      expect(broadcast).toHaveBeenCalledWith('aa');
      expect(hasWaitingLanding(next)).toBe(true);
    });

    it('still reads on the pass a diverged exit stops to wait for the passkey', async () => {
      localStorage.removeItem('walletMnemonic');
      localStorage.setItem('passkeyLabel', 'Default');
      const confirmedSpender = paidBy('c1');
      const recovering = plan([cosigned('c1', 'c-1', outpoint)], { exit: { leaves: [coLeaf('c-1')] } });
      const driver = sdk({
        checkRecoverFunds: async () => ({ recovery: confirmedAs(recovering, 'c1'), verdict: redo }),
        prepareRecoverFunds: async () => prepared(),
      });
      const { plan: next } = await advanceUnilateralExit(recovering, chain({ confirmedSpender }), driver, '02abc');
      expect(next).toMatchObject({ phase: 'redo', needsSignIn: true });
      expect(next.landed).toEqual([expect.objectContaining({ leafIds: ['c-1'], txid: 'c1', paidSat: 99_000 })]);
      localStorage.removeItem('passkeyLabel');
    });
  });
});

describe('a leaf the exit left out', () => {
  const key = deriveFundingKey(MNEMONIC, 'mainnet', 0);
  const stored = { type: 'p2wpkh' as const, txid: 'f', vout: 0, valueSats: 5_000, pubkey: key.publicKeyHex };
  const coLeaf = { leafId: 'c-9', valueSats: 30_000, method: 'cooperative' as const };
  const soloLeaf = { leafId: 'leaf-2', valueSats: 50_000, method: 'unilateral' as const };
  const failure = { leafId: 'c-9', outputTxid: txidOf(5), outputVout: 2, error: { type: 'generic' as const, message: 'refused' } };
  const sweepTx = (status: RecoveryTransaction['status']) =>
    tx({ txid: 'sweep', kind: 'sweep', txHex: rawTx([`${txidOf(1)}:0`], [99_000]), dependsOn: [txidOf(1)], status });
  const sweepEntry: Landing = { leafIds: ['leaf-1'], valueSat: 100_000, txid: 'sweep', paidSat: 99_000, blockHeight: 91 };
  // leaf-1 swept; c-9's co-signing failed and leaf-2 waited on the chain when it was built.
  const exit = (sweep: RecoveryTransaction['status'] = ready, over: Parameters<typeof plan>[1] = {}) =>
    plan([tx({ txid: txidOf(1), kind: 'refund', nodeId: 'leaf-1', status: confirmed(90) }), sweepTx(sweep)], {
      feeRateSatPerVbyte: 4,
      destination: 'bc1qmine',
      quotedSweepFeeSat: 1_000,
      quotedExitFeeSat: 5_000,
      exitFeeAddress: key.address,
      exitStateSnapshot: 'frozen',
      namedLeaves: [
        { leafId: 'leaf-1', valueSats: 100_000 },
        { leafId: 'c-9', valueSats: 30_000 },
        { leafId: 'leaf-2', valueSats: 50_000 },
      ],
      ...over,
      exit: { fundingInputs: [stored], failed: [failure], ...over.exit },
    });
  /** Landed and checked before: the sweep is in the ledger. */
  const landedExit = (over: Parameters<typeof plan>[1] = {}) =>
    exit(confirmed(91), { landed: [sweepEntry], retrySince: 100, retriedAt: 100, ...over });
  // Whatever it is handed, every transaction in a block.
  const done = (over: Partial<ExitSdk> = {}) =>
    sdk({
      checkRecoverFunds: async ({ recovery }) => ({
        recovery: { ...recovery, transactions: recovery.transactions.map(t => ({ ...t, status: t.status.type === 'confirmed' ? t.status : confirmed(91) })) },
        verdict: { type: 'done' },
      }),
      ...over,
    });
  const quoting = (...quotes: ReturnType<typeof prepared>[]) => {
    const fn = vi.fn<ExitSdk['prepareRecoverFunds']>();
    quotes.forEach(q => fn.mockResolvedValueOnce(q));
    return fn.mockResolvedValue(quotes[quotes.length - 1]);
  };
  const leftoverQuote = (over: Parameters<typeof prepared>[0] = {}) =>
    prepared({ leaves: [coLeaf], funding: undefined, feeRateSatPerVbyte: 4, destination: 'bc1qmine', ...over });
  const cosignedBuild = () =>
    checked([{ txid: 'c9', kind: 'cooperative', nodeId: 'c-9', txHex: rawTx([`${txidOf(5)}:2`], [29_000]), status: { type: 'unverified' } }], {
      leaves: [coLeaf],
    });
  const passkeyWallet = () => {
    localStorage.removeItem('walletMnemonic');
    localStorage.setItem('passkeyLabel', 'Default');
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('walletMnemonic', MNEMONIC);
  });

  it('names what no build holds as a leftover', () => {
    expect(leftoverIdsOf(exit())).toEqual(['c-9', 'leaf-2']);
    expect(leftoverIdsOf(plan([tx({ txid: 'a' })], { exit: { failed: [failure] } }))).toEqual(['c-9']);
    expect(isLanded(exit().exit)).toBe(false);
    expect(isLanded(landedExit().exit)).toBe(true);
  });

  it("stays part of the exit on the done verdict, which covers only the set, and is tried at once by name at the plan's rate and destination", async () => {
    const prepareRecoverFunds = quoting(leftoverQuote({ leaves: [], skipped: [{ ...coLeaf, reason: { type: 'unverified' } }, { ...soloLeaf, reason: { type: 'fundsNotFound' } }] }));
    const importUnilateralExitState = vi.fn(sdk().importUnilateralExitState);
    const { plan: next } = await advanceUnilateralExit(exit(ready, { retrySince: 10, retriedAt: 50 }), chain(), done({ prepareRecoverFunds, importUnilateralExitState }), '02abc');

    expect(prepareRecoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ feeRateSatPerVbyte: 4, destination: 'bc1qmine', selection: { type: 'specific', leafIds: ['c-9', 'leaf-2'] } }),
    );
    expect(importUnilateralExitState).toHaveBeenCalledWith({ exitState: 'frozen' });
    expect(importUnilateralExitState.mock.invocationCallOrder[0]).toBeLessThan(prepareRecoverFunds.mock.invocationCallOrder[0]);
    // The set just landed, so the clock starts over.
    expect(next).toMatchObject({ phase: 'active', retrySince: 100, retriedAt: 100 });
    expect(next.landed).toEqual([sweepEntry]);
  });

  it('lets a kept recovery with a failed leaf finish on the done verdict, since it names none as a leftover', async () => {
    const kept = asKeptRecovery(
      plan([tx({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: ready })], {
        mode: 'recover',
        exit: { leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }], failed: [failure] },
      }),
    );
    const prepareRecoverFunds = vi.fn(async () => leftoverQuote());
    const { plan: next } = await advanceUnilateralExit(kept, chain(), done({ prepareRecoverFunds }));
    expect(next.phase).toBe('complete');
    expect(prepareRecoverFunds).not.toHaveBeenCalled();
  });

  it('builds a co-signed leftover into the same plan, with no inputs, no signer and no phrase read', async () => {
    passkeyWallet();
    const recoverFunds = vi.fn(async () => cosignedBuild());
    const broadcast = vi.fn(async () => undefined);
    const prepareRecoverFunds = quoting(leftoverQuote({ skipped: [{ ...soloLeaf, reason: { type: 'unverified' } }] }));
    const { plan: next } = await advanceUnilateralExit(exit(), chain({ broadcast }), done({ prepareRecoverFunds, recoverFunds }), '02abc');

    expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: expect.anything() }]);
    expect(next.exit.transactions.map(t => t.txid)).toEqual([txidOf(1), 'sweep', 'c9']);
    expect(next.exit.leaves.map(leaf => leaf.leafId)).toEqual(['leaf-1', 'c-9']);
    expect(next.exit.recoverableValueSats).toBe(130_000);
    expect(next.exit.failed).toEqual([]);
    // The recovery pays 1 000 less than its leaf.
    expect(next.quotedSweepFeeSat).toBe(2_000);
    expect(recoveryTxid(next)).toBe('sweep');
    expect(next.landed).toEqual([sweepEntry]);
    expect(leftoverIdsOf(next)).toEqual(['leaf-2']);
    expect(next.phase).toBe('active');
    expect(broadcast).toHaveBeenCalledWith(cosignedBuild().transactions[0].txHex);
    localStorage.removeItem('passkeyLabel');
  });

  it('counts a co-signed leftover at its value less its estimated fee, so building it moves neither the amount nor the total', async () => {
    const start = exit(ready, { namedLeaves: [{ leafId: 'leaf-1', valueSats: 100_000 }, { leafId: 'c-9', valueSats: 30_000, feeSat: 1_000 }] });
    const recoverFunds = vi.fn(async () => cosignedBuild());
    const { plan: next } = await advanceUnilateralExit(start, chain(), done({ prepareRecoverFunds: quoting(leftoverQuote()), recoverFunds }), '02abc');
    const total = ({ inSpark, onChain, delivered }: ReturnType<typeof exitStages>) => inSpark + onChain + delivered;

    expect(recoverFunds).toHaveBeenCalledTimes(1);
    expect(leftoverIdsOf(next)).toEqual([]);
    // The recovery pays 29 000, which the estimate already counted.
    expect(willReceiveSat(start)).toBe(128_000);
    expect(willReceiveSat(next)).toBe(128_000);
    expect(total(exitStages(start))).toBe(130_000);
    expect(total(exitStages(next))).toBe(130_000);
  });

  it("quotes a mixed leftover's co-signed leaves again on their own, and asks for the fee only once the rest has landed", async () => {
    const mixed = leftoverQuote({ leaves: [coLeaf, soloLeaf], funding: funding(3_000) });
    const run = async (start: UnilateralExitPlan, driver: (over: Partial<ExitSdk>) => ExitSdk) => {
      const prepareRecoverFunds = quoting(mixed, leftoverQuote());
      const recoverFunds = vi.fn(async () => cosignedBuild());
      const { plan: next } = await advanceUnilateralExit(start, chain(), driver({ prepareRecoverFunds, recoverFunds }), '02abc');
      expect(prepareRecoverFunds).toHaveBeenLastCalledWith(expect.objectContaining({ selection: { type: 'specific', leafIds: ['c-9'] } }));
      expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: leftoverQuote() }]);
      expect(leftoverIdsOf(next)).toEqual(['leaf-2']);
      return next;
    };

    const landing = await run(exit(), done);
    expect(landing.topUp).toEqual({ required: { sat: 3_000, inputs: 1 }, heldSat: 0 });

    const midway = await run(exit(locked(900), { retrySince: 94 }), sdk);
    expect(midway.topUp).toBeUndefined();
  });

  it('keeps the rest of a retry when the operators refuse its co-signed part', async () => {
    const mixed = leftoverQuote({
      leaves: [coLeaf, soloLeaf],
      funding: funding(3_000),
      skipped: [{ leafId: 'leaf-4', valueSats: 7_000, reason: { type: 'notRecoverable', message: 'paid elsewhere' } }],
    });
    const prepareRecoverFunds = quoting(mixed, leftoverQuote());
    const recoverFunds = vi.fn(async () => checked([], { leaves: [], failed: [failure] }));
    const start = exit(ready, { namedLeaves: [...exit().namedLeaves!, { leafId: 'leaf-4', valueSats: 7_000 }] });
    const { plan: next } = await advanceUnilateralExit(start, chain(), done({ prepareRecoverFunds, recoverFunds }), '02abc');

    expect(recoverFunds).toHaveBeenCalledTimes(1);
    expect(next.topUp).toEqual({ required: { sat: 3_000, inputs: 1 }, heldSat: 0 });
    expect(next.droppedLeaves).toEqual([{ leafId: 'leaf-4', valueSats: 7_000 }]);
    expect(leftoverIdsOf(next)).toEqual(['c-9', 'leaf-2']);
  });

  it('takes a leftover the quote names nowhere out of the exit, as waiting on the output its co-signing failed to spend', async () => {
    const { plan: next } = await advanceUnilateralExit(
      exit(ready, { namedLeaves: exit().namedLeaves?.slice(0, 2) }),
      chain(),
      done({ prepareRecoverFunds: quoting(leftoverQuote({ leaves: [] })) }),
      '02abc',
    );
    expect(next.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['leaf-1']);
    expect(next.exit.failed).toEqual([]);
    expect(next.landed).toEqual([sweepEntry, { leafIds: ['c-9'], valueSat: 30_000, outpoint: `${txidOf(5)}:2`, unreadSince: 100 }]);
    expect(next.phase).toBe('complete');
  });

  it('names no leftover still to go once a rebuild finds it landed, though the finished plan still lists it', async () => {
    const finished = await rebuildExit(
      exit(ready, { namedLeaves: exit().namedLeaves?.slice(0, 2) }),
      sdk({ prepareRecoverFunds: quoting(leftoverQuote({ leaves: [] })) }),
      '02abc',
    );
    expect(finished.phase).toBe('complete');
    expect(finished.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['leaf-1', 'c-9']);
    expect(leftoverIdsOf(finished)).toEqual([]);
    expect(planProgress(finished).total).toBe(2);
  });

  it.each([
    [{ type: 'notRecoverable', message: 'paid elsewhere' }, [{ leafId: 'c-9', valueSats: 30_000 }]],
    [{ type: 'feeExceedsValue' }, undefined],
  ] satisfies [SkippedLeafReason, unknown][])(
    'takes a leftover the quote skips for good (%o) out of the exit, hiding only an unrecoverable one, and finishes',
    async (reason, dropped) => {
      const quote = leftoverQuote({ leaves: [], skipped: [{ ...coLeaf, reason }] });
      const { plan: next } = await advanceUnilateralExit(
        exit(ready, { namedLeaves: exit().namedLeaves?.slice(0, 2) }),
        chain(),
        done({ prepareRecoverFunds: quoting(quote) }),
        '02abc',
      );
      expect(next.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['leaf-1']);
      expect(next.droppedLeaves).toEqual(dropped);
      expect(next.phase).toBe('complete');
    },
  );

  it.each([{ type: 'unverified' }, { type: 'fundsNotFound' }] satisfies SkippedLeafReason[])(
    'keeps a leftover the chain has yet to show ($type), trying it again on the paced schedule',
    async reason => {
      const prepareRecoverFunds = quoting(leftoverQuote({ leaves: [], skipped: [{ ...coLeaf, reason }, { ...soloLeaf, reason }] }));
      const at = (tip: number) => chain({ tipHeight: async () => tip });
      const first = await advanceUnilateralExit(exit(), at(100), done({ prepareRecoverFunds }), '02abc');
      expect(first.plan).toMatchObject({ phase: 'active', retrySince: 100, retriedAt: 100 });
      expect(leftoverIdsOf(first.plan)).toEqual(['c-9', 'leaf-2']);

      const next = await advanceUnilateralExit(first.plan, at(101), done({ prepareRecoverFunds }), '02abc');
      expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
      expect(next.plan.phase).toBe('active');
      await advanceUnilateralExit(next.plan, at(106), done({ prepareRecoverFunds }), '02abc');
      expect(prepareRecoverFunds).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps a leftover the operators stopped and tries it again, building it into the exit once it quotes co-signed', async () => {
    const notRecoverable = { type: 'notRecoverable' as const, message: 'paid elsewhere' };
    const stopped = leftoverQuote({
      leaves: [],
      skipped: [{ ...coLeaf, reason: notRecoverable }, { ...soloLeaf, reason: notRecoverable }],
      exitChainState: { ...prepared().exitChainState, stoppedLeafIds: ['c-9'] },
    });
    const prepareRecoverFunds = quoting(stopped, leftoverQuote());
    const recoverFunds = vi.fn(async () => cosignedBuild());
    const at = (tip: number) => chain({ tipHeight: async () => tip });
    const first = await advanceUnilateralExit(exit(), at(100), done({ prepareRecoverFunds, recoverFunds }), '02abc');
    expect(first.plan.phase).toBe('active');
    expect(leftoverIdsOf(first.plan)).toEqual(['c-9']);
    // Only the leaf no stop explains is gone for good.
    expect(first.plan.droppedLeaves).toEqual([{ leafId: 'leaf-2', valueSats: 50_000 }]);
    expect(recoverFunds).not.toHaveBeenCalled();

    const { plan: next } = await advanceUnilateralExit(first.plan, at(106), done({ prepareRecoverFunds, recoverFunds }), '02abc');
    expect(prepareRecoverFunds).toHaveBeenLastCalledWith(expect.objectContaining({ selection: { type: 'specific', leafIds: ['c-9'] } }));
    expect(next.exit.leaves.map(leaf => leaf.leafId)).toEqual(['leaf-1', 'c-9']);
    expect(next.exit.transactions.map(t => t.txid)).toContain('c9');
    expect(leftoverIdsOf(next)).toEqual([]);
    expect(next.droppedLeaves).toEqual([{ leafId: 'leaf-2', valueSats: 50_000 }]);
  });

  it('keeps an exit with nothing built while a leftover waits, without reading it back', async () => {
    const checkRecoverFunds = vi.fn(sdk().checkRecoverFunds);
    const prepareRecoverFunds = quoting(leftoverQuote({ leaves: [], skipped: [{ ...coLeaf, reason: { type: 'unverified' } }] }));
    const idle = plan([], { retrySince: 94, namedLeaves: [{ leafId: 'c-9', valueSats: 30_000 }], exit: { leaves: [], failed: [failure] } });
    const { plan: next } = await advanceUnilateralExit(idle, chain(), sdk({ checkRecoverFunds, prepareRecoverFunds }), '02abc');
    expect(checkRecoverFunds).not.toHaveBeenCalled();
    expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
    expect(next).toMatchObject({ phase: 'active', retriedAt: 100 });
  });

  it('builds a unilateral leftover that needs no funding as the next part, once the rest has landed', async () => {
    passkeyWallet();
    const quote = leftoverQuote({ leaves: [soloLeaf], sweepFeeSats: 300 });
    const recoverFunds = vi.fn(async () => checked([{ txid: 'sweep-2', kind: 'sweep' }], { leaves: [soloLeaf] }));
    const { plan: next } = await advanceUnilateralExit(
      exit(ready, { namedLeaves: [exit().namedLeaves![0], exit().namedLeaves![2]], exit: { failed: [] } }),
      chain(),
      done({ prepareRecoverFunds: quoting(quote), recoverFunds }),
      '02abc',
    );
    expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: quote }]);
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['sweep-2']);
    expect(next).toMatchObject({ phase: 'active', quotedSweepFeeSat: 300, quotedExitFeeSat: 5_000, exitFeeAddress: key.address, exitStateSnapshot: 'frozen' });
    expect(next.namedLeaves).toEqual([{ leafId: 'leaf-2', valueSats: 50_000, feeSat: 300 }]);
    expect(next.landed).toEqual([sweepEntry]);
    localStorage.removeItem('passkeyLabel');
  });

  it('builds no next part over a co-signed recovery in flight that its quote did not name, which the build would drop', async () => {
    const inFlight = tx({ txid: 'c5', kind: 'cooperative', nodeId: 'c-5', txHex: rawTx([`${txidOf(6)}:0`], [19_000]), status: ready });
    const recoverFunds = vi.fn(async () => checked([{ txid: 'sweep-2', kind: 'sweep' }], { leaves: [soloLeaf] }));
    const start = landedExit({
      namedLeaves: [exit().namedLeaves![0], { leafId: 'c-5', valueSats: 20_000 }, exit().namedLeaves![2]],
      exit: {
        failed: [],
        leaves: [{ leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' }, { leafId: 'c-5', valueSats: 20_000, method: 'cooperative' }],
        transactions: [tx({ txid: txidOf(1), kind: 'refund', nodeId: 'leaf-1', status: confirmed(90) }), sweepTx(confirmed(91)), inFlight],
      },
    });
    const prepareRecoverFunds = quoting(leftoverQuote({ leaves: [soloLeaf] }));
    const { plan: next } = await advanceUnilateralExit(start, chain({ tipHeight: async () => 106 }), sdk({ prepareRecoverFunds, recoverFunds }), '02abc');
    expect(prepareRecoverFunds).toHaveBeenCalledWith(expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-2'] } }));
    expect(recoverFunds).not.toHaveBeenCalled();
    expect(next.exit.transactions.map(t => t.txid)).toContain('c5');
    expect(leftoverIdsOf(next)).toEqual(['leaf-2']);
  });

  describe('that needs more exit fee', () => {
    const askQuote = () => leftoverQuote({ leaves: [soloLeaf], funding: funding(3_000), sweepFeeSats: 300 });
    const waiting = (over: Parameters<typeof plan>[1] = {}) =>
      landedExit({ namedLeaves: [exit().namedLeaves![0], exit().namedLeaves![2]], topUp: { required: { sat: 3_000, inputs: 1 }, heldSat: 1_000 }, ...over, exit: { failed: [], ...over.exit } });
    const nextPart = () =>
      checked(
        [
          { txid: 'refund-2', kind: 'refund', nodeId: 'leaf-2', status: locked(900) },
          { txid: 'sweep-2', kind: 'sweep', dependsOn: ['refund-2'], status: blocked },
        ],
        { leaves: [soloLeaf] },
      );
    const tip = (height: number) => chain({ tipHeight: async () => height });

    it('asks once the rest has landed, reading no phrase and building nothing, and keeps what the address held when asked', async () => {
      passkeyWallet();
      const recoverFunds = vi.fn(async () => nextPart());
      const prepareRecoverFunds = quoting(askQuote());
      const addressUtxos = vi.fn(async () => [feeCoin(1_000), feeCoin(800, false)]);
      const start = exit(ready, { namedLeaves: [exit().namedLeaves![0], exit().namedLeaves![2]], exit: { failed: [] } });
      const first = await advanceUnilateralExit(start, chain({ addressUtxos }), done({ prepareRecoverFunds, recoverFunds }), '02abc');
      // Read in the pass that asks: a later first read could already hold the payment.
      expect(addressUtxos).toHaveBeenCalledWith(key.address);
      expect(first.plan.topUp).toEqual({ required: { sat: 3_000, inputs: 1 }, heldSat: 1_000 });
      expect(recoverFunds).not.toHaveBeenCalled();
      expect(isStalled(first.plan)).toBe(false);

      const next = await advanceUnilateralExit(first.plan, tip(101), done({ prepareRecoverFunds, recoverFunds }), '02abc', [feeCoin(1_000), feeCoin(2_000, false)]);
      expect(next.plan.topUp).toEqual({ required: { sat: 3_000, inputs: 1 }, heldSat: 1_000 });
      expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
      localStorage.removeItem('passkeyLabel');
    });

    it('leaves what the address held unread when the read in the pass that asks fails, for the next read to fill', async () => {
      const addressUtxos = vi.fn(async (): Promise<ReturnType<typeof feeCoin>[]> => {
        throw new Error('rate limited');
      });
      const start = exit(ready, { namedLeaves: [exit().namedLeaves![0], exit().namedLeaves![2]], exit: { failed: [] } });
      const first = await advanceUnilateralExit(start, chain({ addressUtxos }), done({ prepareRecoverFunds: quoting(askQuote()) }), '02abc');
      expect(first.plan.topUp).toEqual({ required: { sat: 3_000, inputs: 1 } });

      const next = await advanceUnilateralExit(first.plan, tip(101), done(), '02abc', [feeCoin(1_000)]);
      expect(next.plan.topUp?.heldSat).toBe(1_000);
    });

    it('asks for the tap when the exit has no fee address yet, which only the key can say', async () => {
      const start = exit(ready, { exitFeeAddress: undefined, namedLeaves: [exit().namedLeaves![0], exit().namedLeaves![2]], exit: { failed: [], fundingInputs: [] } });
      const { plan: next } = await advanceUnilateralExit(start, chain(), done({ prepareRecoverFunds: quoting(askQuote()) }), '02abc');
      expect(next.topUp).toEqual({ required: { sat: 3_000, inputs: 1 }, needsSignIn: true });
    });

    it('builds the next part from the funding it had and the coins sent, with a signer, once they confirm', async () => {
      const recoverFunds = vi.fn<ExitSdk['recoverFunds']>(async () => nextPart());
      const coins = [feeCoin(3_000)];
      expect(leftoverTopUp(waiting(), coins).stillToSendSat).toBe(0);
      const { plan: next } = await advanceUnilateralExit(waiting(), tip(101), done({ prepareRecoverFunds: quoting(askQuote()), recoverFunds }), '02abc', coins);

      expect(recoverFunds).toHaveBeenCalledWith(
        { prepared: askQuote(), fundingInputs: [stored, { type: 'p2wpkh', txid: 'coin-3000', vout: 0, valueSats: 3_000, pubkey: key.publicKeyHex }] },
        expect.anything(),
      );
      expect(next.topUp).toBeUndefined();
      // What the address held before the ask was not sent for this part.
      expect(next).toMatchObject({ quotedExitFeeSat: 7_000, exitFeeAddress: key.address, quotedSweepFeeSat: 300, exitStateSnapshot: 'frozen', phase: 'active' });
      expect(next.exit.transactions.map(t => t.txid)).toEqual(['refund-2', 'sweep-2']);
      expect(next.landed).toEqual([sweepEntry]);
    });

    it('counts the leftover at the fee of the quote that asks, so building it does not move the amount', async () => {
      const recoverFunds = vi.fn<ExitSdk['recoverFunds']>(async () => ({ ...nextPart(), recoverableValueSats: 50_000 }));
      const prepareRecoverFunds = quoting(askQuote());
      // Its fee is the share an earlier quote of more leaves put on it.
      const stale = exit(ready, { namedLeaves: [exit().namedLeaves![0], { leafId: 'leaf-2', valueSats: 50_000, feeSat: 150 }], exit: { failed: [] } });
      const first = await advanceUnilateralExit(stale, chain(), done({ prepareRecoverFunds, recoverFunds }), '02abc');
      expect(first.plan.topUp).toBeDefined();
      expect(recoverFunds).not.toHaveBeenCalled();

      const { plan: next } = await advanceUnilateralExit(first.plan, tip(101), done({ prepareRecoverFunds, recoverFunds }), '02abc', [feeCoin(3_000)]);
      expect(recoverFunds).toHaveBeenCalledTimes(1);
      expect(willReceiveSat(first.plan)).toBe(99_000 + 50_000 - 300);
      expect(willReceiveSat(next)).toBe(willReceiveSat(first.plan));
    });

    it('waits while what it asked for has not confirmed', async () => {
      const recoverFunds = vi.fn(async () => nextPart());
      const { plan: next } = await advanceUnilateralExit(waiting(), tip(101), done({ recoverFunds }), '02abc', [feeCoin(3_000, false)]);
      expect(recoverFunds).not.toHaveBeenCalled();
      expect(next.topUp).toEqual(waiting().topUp);
    });

    it('waits for the tap on a passkey wallet, building nothing', async () => {
      passkeyWallet();
      const recoverFunds = vi.fn(async () => nextPart());
      const prepareRecoverFunds = quoting(askQuote());
      const first = await advanceUnilateralExit(waiting(), tip(101), done({ prepareRecoverFunds, recoverFunds }), '02abc', [feeCoin(3_000)]);
      expect(first.plan.topUp).toEqual({ ...waiting().topUp, needsSignIn: true });
      expect(recoverFunds).not.toHaveBeenCalled();

      await advanceUnilateralExit(first.plan, tip(102), done({ prepareRecoverFunds, recoverFunds }), '02abc', [feeCoin(3_000)]);
      expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
      localStorage.removeItem('passkeyLabel');
    });

    it('tries a build that failed again only in a later block', async () => {
      const prepareRecoverFunds = vi.fn(async () => askQuote());
      const recoverFunds = vi.fn(async () => {
        throw new Error('operators unreachable');
      });
      const driver = done({ prepareRecoverFunds, recoverFunds });
      const first = await advanceUnilateralExit(waiting(), tip(101), driver, '02abc', [feeCoin(3_000)]);
      expect(first.plan).toMatchObject({ retriedAt: 101, topUp: waiting().topUp });
      await advanceUnilateralExit(first.plan, tip(101), driver, '02abc', [feeCoin(3_000)]);
      expect(recoverFunds).toHaveBeenCalledTimes(1);
      await advanceUnilateralExit(first.plan, tip(102), driver, '02abc', [feeCoin(3_000)]);
      expect(recoverFunds).toHaveBeenCalledTimes(2);
    });

    it('asks for what the build says it needs, sized on the coins it had', async () => {
      const recoverFunds = vi.fn(async () => {
        throw new Error('Insufficient CPFP funding: need at least 6400 sats');
      });
      const coins = [feeCoin(2_000), feeCoin(1_500, true, 'b')];
      const { plan: next } = await advanceUnilateralExit(waiting(), tip(101), done({ prepareRecoverFunds: quoting(askQuote()), recoverFunds }), '02abc', coins);
      expect(next.topUp).toEqual({ required: { sat: 6_400, inputs: 2 }, heldSat: 1_000 });
      expect(next.exit.transactions.map(t => t.txid)).toEqual([txidOf(1), 'sweep']);
    });

    it('lets go of the leftover after about a week, without hiding it, and finishes', async () => {
      const prepareRecoverFunds = vi.fn(async () => askQuote());
      const start = waiting({ namedLeaves: [exit().namedLeaves![0], { leafId: 'leaf-2', valueSats: 50_000, feeSat: 300 }] });
      const { plan: next } = await advanceUnilateralExit(start, tip(1_108), done({ prepareRecoverFunds }), '02abc');
      expect(prepareRecoverFunds).not.toHaveBeenCalled();
      // The amount drops by what the leaf was counted at: its value less its fee.
      expect(willReceiveSat(start) - willReceiveSat(next)).toBe(49_700);
      expect(next.namedLeaves).toEqual([{ leafId: 'leaf-1', valueSats: 100_000 }]);
      expect(next.topUp).toBeUndefined();
      expect(next.droppedLeaves).toBeUndefined();
      expect(next.phase).toBe('complete');
    });

    it('lets nothing go while a unilateral step is in flight', () => {
      expect(releaseDue(exit(locked(900), { retrySince: 100 }), 2_000)).toBe(false);
      expect(releaseDue(waiting(), 1_108)).toBe(true);
    });

    it('lets go of a paid leftover whose build keeps failing once the week is up, logging an empty build', async () => {
      const warn = vi.spyOn(logger, 'warn');
      const recoverFunds = vi.fn(async () => checked([]));
      const driver = done({ prepareRecoverFunds: vi.fn(async () => askQuote()), recoverFunds });
      const before = await advanceUnilateralExit(waiting(), tip(1_107), driver, '02abc', [feeCoin(3_000)]);
      expect(leftoverIdsOf(before.plan)).toEqual(['leaf-2']);
      expect(warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('came back empty'));

      const { plan: next } = await advanceUnilateralExit(before.plan, tip(1_108), driver, '02abc', [feeCoin(3_000)]);
      expect(recoverFunds).toHaveBeenCalledTimes(2);
      expect(leftoverIdsOf(next)).toEqual([]);
      expect(next.topUp).toBeUndefined();
      expect(next.droppedLeaves).toBeUndefined();
      expect(next.phase).toBe('complete');
      warn.mockRestore();
    });

    it('keeps its request and retries on schedule while a unilateral step is back in flight, building nothing', async () => {
      const prepareRecoverFunds = vi.fn(async () => askQuote());
      const recoverFunds = vi.fn(async () => nextPart());
      const inFlight = waiting({ exit: { transactions: [tx({ txid: txidOf(1), kind: 'refund', nodeId: 'leaf-1', status: confirmed(90) }), sweepTx(ready)] } });
      const { plan: next } = await advanceUnilateralExit(inFlight, tip(106), sdk({ prepareRecoverFunds, recoverFunds }), '02abc', [feeCoin(3_000)]);
      expect(prepareRecoverFunds).toHaveBeenCalledWith(expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-2'] } }));
      expect(recoverFunds).not.toHaveBeenCalled();
      expect(next.topUp).toEqual(waiting().topUp);
    });

    describe('beside a co-signed recovery stuck unverified', () => {
      const stuckTx = () =>
        tx({ txid: 'c9', kind: 'cooperative', nodeId: 'c-9', txHex: rawTx([`${txidOf(5)}:2`], [29_000]), status: { type: 'unverified' } });
      const leafOne = { leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' as const };
      const beside = (sweep: RecoveryTransaction['status'], over: Parameters<typeof plan>[1] = {}) =>
        landedExit({
          retrySince: 10,
          retriedAt: 50,
          ...over,
          exit: {
            failed: [],
            leaves: [leafOne, coLeaf],
            transactions: [tx({ txid: txidOf(1), kind: 'refund', nodeId: 'leaf-1', status: confirmed(90) }), sweepTx(sweep), stuckTx()],
            ...over.exit,
          },
        });
      const mixed = () => leftoverQuote({ leaves: [coLeaf, soloLeaf], funding: funding(3_000), sweepFeeSats: 300 });
      // The check confirms the sweep and reads the recovery unverified still.
      const stillStuck = (over: Partial<ExitSdk> = {}) =>
        sdk({
          checkRecoverFunds: async ({ recovery }) => ({
            recovery: { ...recovery, transactions: recovery.transactions.map(t => (t.txid === 'sweep' ? { ...t, status: confirmed(95) } : t)) },
            verdict: { type: 'valid' },
          }),
          ...over,
        });

      it('asks for the fee on the pass the last unilateral step lands, and starts the week over from there', async () => {
        const prepareRecoverFunds = quoting(mixed(), leftoverQuote());
        const recoverFunds = vi.fn(async () => cosignedBuild());
        const { plan: next } = await advanceUnilateralExit(beside(ready), chain(), stillStuck({ prepareRecoverFunds, recoverFunds }), '02abc');
        expect(prepareRecoverFunds).toHaveBeenCalledWith(expect.objectContaining({ selection: { type: 'specific', leafIds: ['c-9', 'leaf-2'] } }));
        expect(next.topUp).toEqual({ required: { sat: 3_000, inputs: 1 }, heldSat: 0 });
        expect(next).toMatchObject({ retrySince: 100, retriedAt: 100 });
        expect(releaseDue(next, 1_107)).toBe(false);
      });

      it('builds the paid leftover without waiting on it, naming it too so the next part carries it', async () => {
        const prepareRecoverFunds = quoting(mixed());
        const carried = checked(
          [
            { txid: 'c9', kind: 'cooperative', nodeId: 'c-9', txHex: rawTx([`${txidOf(5)}:2`], [29_000]), status: { type: 'unverified' } },
            ...nextPart().transactions,
          ],
          { leaves: [coLeaf, soloLeaf] },
        );
        const recoverFunds = vi.fn<ExitSdk['recoverFunds']>(async () => carried);
        const start = beside(confirmed(91), {
          namedLeaves: exit().namedLeaves,
          topUp: { required: { sat: 3_000, inputs: 1 }, heldSat: 1_000 },
          retrySince: 100,
          retriedAt: 100,
        });
        const { plan: next } = await advanceUnilateralExit(start, tip(101), stillStuck({ prepareRecoverFunds, recoverFunds }), '02abc', [feeCoin(3_000)]);

        expect(prepareRecoverFunds).toHaveBeenCalledWith(expect.objectContaining({ selection: { type: 'specific', leafIds: ['c-9', 'leaf-2'] } }));
        expect(recoverFunds).toHaveBeenCalledWith(expect.objectContaining({ fundingInputs: expect.any(Array) }), expect.anything());
        expect(next.topUp).toBeUndefined();
        expect(next.exit.transactions.map(t => t.txid)).toEqual(['c9', 'refund-2', 'sweep-2']);
        expect(next.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['c-9', 'leaf-2']);
        expect(next.landed).toEqual([sweepEntry]);
      });
    });

    describe('buildLeftover', () => {
      it('reads the phrase before anything else from the tap, and passes on a failure', async () => {
        localStorage.removeItem('walletMnemonic');
        const prepareRecoverFunds = vi.fn(async () => askQuote());
        const tap = buildLeftover(waiting(), sdk({ prepareRecoverFunds }), '02abc', [feeCoin(3_000)], { interactive: true });
        await expect(tap).rejects.toBeInstanceOf(MnemonicUnavailableError);
        expect(prepareRecoverFunds).not.toHaveBeenCalled();
      });

      it('builds nothing over a transaction still in flight', async () => {
        await expect(buildLeftover(waiting({ exit: { transactions: [sweepTx(ready)] } }), sdk(), '02abc', [])).rejects.toBeInstanceOf(RebuildLaterError);
      });

      it('needs no key once the quote needs no funding, and asks for nothing more', async () => {
        passkeyWallet();
        const recoverFunds = vi.fn(async () => nextPart());
        const quote = leftoverQuote({ leaves: [soloLeaf] });
        const next = await buildLeftover(waiting(), sdk({ prepareRecoverFunds: quoting(quote), recoverFunds }), '02abc', []);
        expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: quote }]);
        expect(next.topUp).toBeUndefined();
        expect(next.quotedExitFeeSat).toBe(5_000);
        localStorage.removeItem('passkeyLabel');
      });
    });
  });

  it('counts each leftover as one transaction still to go, and its value as not yet moving', () => {
    const landed = landedExit({ landed: undefined });
    expect(planProgress(landed)).toEqual({ confirmed: 2, total: 4, isComplete: false });
    expect(exitStages(landed)).toMatchObject({ inSpark: 80_000, onChain: 0 });
    expect(exitStages(exit(locked(900)))).toMatchObject({ inSpark: 80_000 + 0, onChain: 100_000 });
  });

  it('polls slowly while all that is left waits on a retry, but not while it waits on the exit fee', () => {
    expect(isStalled(landedExit())).toBe(true);
    expect(isStalled(landedExit({ topUp: { required: { sat: 3_000, inputs: 1 } } }))).toBe(false);
  });

  it('drops a leaf a rebuild found unrecoverable or too dear from what the exit names, hiding only the unrecoverable one', () => {
    const quote = prepared({
      leaves: [{ leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' }],
      skipped: [
        { ...coLeaf, reason: { type: 'notRecoverable', message: 'paid elsewhere' } },
        { ...soloLeaf, reason: { type: 'feeExceedsValue' } },
        { leafId: 'leaf-3', valueSats: 7_000, reason: { type: 'unverified' } },
      ],
    });
    const resuming = exit(ready, {
      droppedLeaves: [{ leafId: 'gone', valueSats: 700 }],
      namedLeaves: [...exit().namedLeaves!, { leafId: 'leaf-3', valueSats: 7_000 }],
    });
    const next = planFromBuild(quote, checked([{ txid: 'fresh' }]), resuming, { network: 'mainnet', fundingAddressIndex: 0 });
    expect(next.namedLeaves?.map(leaf => leaf.leafId)).toEqual(['leaf-1', 'leaf-3']);
    expect(next.droppedLeaves).toEqual([{ leafId: 'gone', valueSats: 700 }, { leafId: 'c-9', valueSats: 30_000 }]);
  });
});
