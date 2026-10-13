import { advanceUnilateralExit } from './pass';
import { deriveFundingKey } from './funding';
import { awaitsUpdate } from './model/plan';
import type { ExitSdk } from './quoting';
import {
  checked,
  checking,
  chain,
  confirmed,
  MNEMONIC,
  plan,
  prepared,
  ready,
  redo,
  sdk,
  twoLeaves,
  tx,
} from './testFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkippedLeafReason } from '@breeztech/breez-sdk-spark';

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
