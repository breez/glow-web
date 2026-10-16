import type { SkippedLeafReason } from '@breeztech/breez-sdk-spark';
import { buildFromQuote, EmptyRecoveryError, startExit } from './building';
import { deriveFundingKey } from './funding';
import { checked, coin as feeCoin, funding as asking, MNEMONIC, pendingExit, prepared, sdk } from './testFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      quotedExitFeeSat: 5_898,
      exitFeeAddress: 'bcrt1qfund',
      exitStateSnapshot: 'snapshot',
    });
    expect(outcome.plan.exit.transactions[0].txid).toBe('fan');
  });

  it("records every coin sent as the exit fee paid, not the quote's ask, which the least ask of 546 sats can exceed", async () => {
    const driver = sdk({ prepareRecoverFunds: async () => prepared({ funding: asking(1_011) }), recoverFunds: async () => checked([{ txid: 'node' }]) });
    const outcome = await startExit(pendingExit({ required: { sat: 1_011, inputs: 1 } }), [feeCoin(505), feeCoin(506), feeCoin(546)], driver, '02abc');
    expect(outcome).toMatchObject({ type: 'started', plan: { quotedExitFeeSat: 1_557, exitFeeAddress: 'bcrt1qfund' } });
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
    const driver = sdk({ prepareRecoverFunds: async () => prepared({ totalFeeSats: 100_000 }), recoverFunds });
    expect(await startExit(pendingExit(), [feeCoin(5_898)], driver, '02abc')).toEqual({ type: 'nothingToExit', reason: 'fees' });
    expect(recoverFunds).not.toHaveBeenCalled();
  });

  it('says why a start found nothing: funds that may yet move, or funds that cannot', async () => {
    const skipping = (reason: SkippedLeafReason) =>
      sdk({ prepareRecoverFunds: async () => prepared({ leaves: [], skipped: [{ leafId: 'leaf-1', valueSats: 100_000, reason }] }) });
    expect(await startExit(pendingExit(), [feeCoin(5_898)], skipping({ type: 'fundsNotFound' }), '02abc')).toEqual({
      type: 'nothingToExit',
      reason: 'unavailable',
    });
    expect(await startExit(pendingExit(), [feeCoin(5_898)], skipping({ type: 'notRecoverable', message: 'spent' }), '02abc')).toEqual({
      type: 'nothingToExit',
      reason: 'notRecoverable',
    });
  });

  it('lets go of a leaf the operators stopped once the clock it is handed says it stayed stopped six blocks', async () => {
    const driver = sdk({
      prepareRecoverFunds: async () =>
        prepared({
          leaves: [],
          skipped: [{ leafId: 's-1', valueSats: 150_000, reason: { type: 'notRecoverable', message: 'stopped' } }],
          exitChainState: { ...prepared().exitChainState, stoppedLeafIds: ['s-1'] },
        }),
    });
    const startAt = (tipHeight: number) =>
      startExit(pendingExit({ mode: 'recover' }), [feeCoin(5_898)], driver, '02abc', undefined, new Set(), async () => ({
        since: { 's-1': 100 },
        tipHeight,
      }));
    expect(await startAt(105)).toEqual({ type: 'nothingToExit', reason: 'unavailable' });
    expect(await startAt(106)).toEqual({ type: 'nothingToExit', reason: 'notRecoverable' });
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
    expect(outcome).toEqual({ type: 'nothingToExit', reason: null });
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
