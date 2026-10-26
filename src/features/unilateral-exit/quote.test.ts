import { describe, expect, it } from 'vitest';
import type { RecoverFundsLeaf, SkippedLeaf } from '@breeztech/breez-sdk-spark';
import { planFromBuild } from './building';
import { leftoverIdsOf, planFromExitResponse } from './model/plan';
import { deriveFundingKey } from './funding';
import {
  builtExitFeeRecord,
  builtSweepFeeSat,
  exitFeeRecordOf,
  exitFeeSat,
  isProvisionalSkip,
  leafFeesSat,
  leftOutReason,
  leftOutSat,
  needsFunding,
  quoteFigures,
  quotedSweepFeeSat,
  stopClock,
  willReceiveSat,
} from './quote';
import { checked, confirmed, funding, MNEMONIC, plan, prepared, sweepHex, twoLeaves, tx } from './testFixtures';

const meta = {
  network: 'mainnet',
  destination: 'bc1qdest',
  feeRateSatPerVbyte: 3,
  fundingAddressIndex: 0,
  quotedSweepFeeSat: 200,
};

const cosigned: RecoverFundsLeaf[] = [
  { leafId: 'c-1', valueSats: 30_000, method: 'cooperative' },
  { leafId: 'c-2', valueSats: 18_200, method: 'cooperative' },
];
const stranded: RecoverFundsLeaf[] = [
  { leafId: 's-1', valueSats: 60_000, method: 'unilateral' },
  { leafId: 's-2', valueSats: 60_000, method: 'unilateral' },
];

/** The two co-signed leaves, quoted at 1 450 each. */
const cosignedQuote = prepared({ leaves: cosigned, recoverableValueSats: 48_200, sweepFeeSats: 0, cooperativeFeeSats: 2_900, funding: undefined });
/** An exit started from that quote, with both co-signed. */
const startedCosigned = () =>
  planFromBuild(
    cosignedQuote,
    checked(
      [
        { txid: 'c1', kind: 'cooperative', nodeId: 'c-1' },
        { txid: 'c2', kind: 'cooperative', nodeId: 'c-2' },
      ],
      { leaves: cosigned, recoverableValueSats: 48_200, cooperativeFeeSats: 2_900, sweepFeeSats: 0 },
    ),
    null,
    { network: 'mainnet', fundingAddressIndex: 0 },
  );

describe('willReceiveSat', () => {
  it('says the same thing on the quote and on the exit built from it', () => {
    const quote = prepared({ recoverableValueSats: 600_000, totalFeeSats: 3_122, cpfpFeeSats: 2_907, sweepFeeSats: 215 });
    // The built sweep also spends the funding's change, so its own fee is no guide.
    const built = planFromExitResponse(
      checked([{ txid: 'r', kind: 'refund' }], { recoverableValueSats: 600_000, sweepFeeSats: 290 }),
      { ...meta, quotedSweepFeeSat: quotedSweepFeeSat(quote, null) },
    );
    expect(willReceiveSat(built)).toBe(willReceiveSat(quote));
    expect(willReceiveSat(built)).toBe(599_785);
  });

  it('does not move when a check or rebuild reprices the exit', () => {
    expect(willReceiveSat(twoLeaves([tx({ txid: 'r', kind: 'refund' })], { exit: { totalFeeSats: 214, sweepFeeSats: 214 } }))).toBe(599_785);
  });

  it('holds a resumed quote to the sweep fee the exit was first quoted at', () => {
    const resuming = twoLeaves([]);
    expect(quotedSweepFeeSat(prepared({ sweepFeeSats: 180 }), resuming)).toBe(215);
    expect(willReceiveSat(prepared({ recoverableValueSats: 600_000, sweepFeeSats: 180 }), resuming)).toBe(599_785);
  });

  it('lets a quote at a higher rate cost more', () => {
    expect(quotedSweepFeeSat(prepared({ sweepFeeSats: 900 }), twoLeaves([]))).toBe(900);
  });

  it.each([
    ["what the operators' own refund took from its leaf", { refundFeeSats: 330 }, 545],
    ["the co-signed recoveries' fee too, since it comes out of the value moved", { cooperativeFeeSats: 990 }, 1_205],
  ])('takes off %s', (_, fees, feeSat) => {
    const quote = prepared({ recoverableValueSats: 600_000, sweepFeeSats: 215, ...fees });
    expect(quotedSweepFeeSat(quote, null)).toBe(feeSat);
    expect(willReceiveSat(quote)).toBe(600_000 - feeSat);
  });

  it('takes only the co-signed fee of what was built, leaving out a leaf whose recovery landed before the build', () => {
    // The build co-signed one and did not list the other as failed, so that
    // one's recovery is already in a block.
    const built = checked([{ txid: 'c1', kind: 'cooperative', nodeId: 'c-1' }], {
      leaves: [cosigned[0]],
      recoverableValueSats: 30_000,
      cooperativeFeeSats: 1_450,
      sweepFeeSats: 0,
    });
    expect(builtSweepFeeSat(cosignedQuote, built)).toBe(1_450);
    const started = planFromBuild(cosignedQuote, built, null, { network: 'mainnet', fundingAddressIndex: 0 });
    expect(willReceiveSat(started)).toBe(28_550);
    expect(leftoverIdsOf(started)).toEqual([]);
  });

  it('counts a leaf the operators did not co-sign at its value less its share of the fee, so the exit starts at the quote', () => {
    const built = checked([{ txid: 'c1', kind: 'cooperative', nodeId: 'c-1' }], {
      leaves: [cosigned[0]],
      failed: [{ leafId: 'c-2', outputTxid: 'o', outputVout: 0, error: { type: 'operatorsUnavailable', message: 'down' } }],
      recoverableValueSats: 30_000,
      cooperativeFeeSats: 1_450,
      sweepFeeSats: 0,
    });
    const started = planFromBuild(cosignedQuote, built, null, { network: 'mainnet', fundingAddressIndex: 0 });
    expect(started.namedLeaves).toContainEqual({ leafId: 'c-2', valueSats: 18_200, feeSat: 1_450 });
    expect(willReceiveSat(started)).toBe(willReceiveSat(cosignedQuote));
    expect(willReceiveSat(started)).toBe(45_300);
  });

  it('takes the fee of a leaf a rebuild no longer co-signed off only once', () => {
    const started = startedCosigned();
    const rebuilt = checked([{ txid: 'c1-again', kind: 'cooperative', nodeId: 'c-1' }], {
      leaves: [cosigned[0]],
      failed: [{ leafId: 'c-2', outputTxid: 'o', outputVout: 0, error: { type: 'operatorsUnavailable', message: 'down' } }],
      recoverableValueSats: 30_000,
      cooperativeFeeSats: 1_450,
      sweepFeeSats: 0,
    });
    const next = planFromBuild(cosignedQuote, rebuilt, started, { network: 'mainnet', fundingAddressIndex: 0 });
    expect(willReceiveSat(started)).toBe(45_300);
    expect(willReceiveSat(next)).toBe(45_300);
  });

  it('takes the fee of a co-signed leaf whose recovery landed before a rebuild off only once', () => {
    const started = startedCosigned();
    // c-1's recovery is in a block, and the ledger has read what it paid.
    const oneLanded = {
      ...started,
      exit: { ...started.exit, transactions: started.exit.transactions.map(t => (t.nodeId === 'c-1' ? { ...t, status: confirmed(9) } : t)) },
      landed: [{ leafIds: ['c-1'], valueSat: 30_000, txid: 'c1', paidSat: 28_550, blockHeight: 9 }],
    };
    const rest = prepared({ leaves: [cosigned[1]], recoverableValueSats: 18_200, sweepFeeSats: 0, cooperativeFeeSats: 1_450, funding: undefined });
    const rebuilt = checked([{ txid: 'c2-again', kind: 'cooperative', nodeId: 'c-2' }], {
      leaves: [cosigned[1]],
      recoverableValueSats: 18_200,
      cooperativeFeeSats: 1_450,
      sweepFeeSats: 0,
    });
    const next = planFromBuild(rest, rebuilt, oneLanded, { network: 'mainnet', fundingAddressIndex: 0 });
    expect(willReceiveSat(oneLanded)).toBe(45_300);
    expect(quoteFigures(rest, { resuming: oneLanded }).willReceiveSat).toBe(16_750);
    expect(willReceiveSat(next)).toBe(45_300);
  });

  it('does not count a leaf again once a ledger entry covers it, though the plan still names it', () => {
    const finished = plan([tx({ txid: 's', kind: 'sweep' })], {
      namedLeaves: [
        { leafId: 'leaf-1', valueSats: 100_000 },
        { leafId: 'c-9', valueSats: 30_000, feeSat: 1_000 },
      ],
      landed: [{ leafIds: ['c-9'], valueSat: 30_000, txid: 'c9', paidSat: 29_000, blockHeight: 9 }],
    });
    expect(willReceiveSat(finished)).toBe(99_800 + 29_000);
  });

  it('reports what a confirmed sweep actually paid', () => {
    expect(willReceiveSat(twoLeaves([tx({ txid: 's', kind: 'sweep', txHex: sweepHex, status: confirmed(1) })]))).toBe(596_524);
  });

  it('ignores an unconfirmed sweep, which may still be rebuilt', () => {
    expect(willReceiveSat(twoLeaves([tx({ txid: 's', kind: 'sweep', txHex: sweepHex })]))).toBe(599_785);
  });

  it('adds what replaced builds paid the destination, once per transaction', () => {
    const rebuilt = twoLeaves([tx({ txid: 's', kind: 'sweep', txHex: sweepHex })], {
      landed: [
        // One older sweep paid two leaves the rebuild no longer names.
        { leafIds: ['old-1'], valueSat: 20_000, txid: 'old-sweep', paidSat: 39_000, blockHeight: 5 },
        { leafIds: ['old-2'], valueSat: 20_000, txid: 'old-sweep', paidSat: 39_000, blockHeight: 5 },
        // Still waiting on its read, and one of this build's own leaves.
        { leafIds: ['old-3'], valueSat: 9_000, outpoint: 'refund:0' },
        { leafIds: ['leaf-1'], valueSat: 180_000, txid: 'coop', paidSat: 179_000 },
      ],
    });
    expect(willReceiveSat(rebuilt)).toBe(599_785 + 39_000);
  });
});

describe('leafFeesSat', () => {
  it('splits the co-signed fee over the co-signed leaves and the sweep fee over the rest, rounding up', () => {
    const quote = prepared({ leaves: [...stranded, ...cosigned], sweepFeeSats: 1_101, cooperativeFeeSats: 2_901 });
    expect(leafFeesSat(quote)).toEqual(
      new Map([
        ['s-1', 551],
        ['s-2', 551],
        ['c-1', 1_451],
        ['c-2', 1_451],
      ]),
    );
  });
});

describe('needsFunding', () => {
  it('asks for coins from another wallet only when the quote has funding', () => {
    expect(needsFunding(prepared({ funding: funding(3_000) }))).toBe(true);
    expect(exitFeeSat(prepared({ funding: funding(3_000) }))).toBe(3_000);
    expect(needsFunding(prepared({ funding: undefined }))).toBe(false);
    expect(exitFeeSat(prepared({ funding: undefined }))).toBe(0);
  });
});

describe('the exit fee record', () => {
  const key = deriveFundingKey(MNEMONIC, 'regtest', 0);
  const input = (txid: string, valueSats: number) => ({ type: 'p2wpkh' as const, txid, vout: 0, valueSats, pubkey: key.publicKeyHex });

  it('is what the plan recorded, whatever its funding inputs say', () => {
    const recorded = plan([], { quotedExitFeeSat: 14_350, exitFeeAddress: 'bcrt1qfee', exit: { fundingInputs: [input('change', 31_939)] } });
    expect(exitFeeRecordOf(recorded)).toEqual({ quotedExitFeeSat: 14_350, exitFeeAddress: 'bcrt1qfee' });
  });

  it('reads an older plan off the coins its builds spent', () => {
    const older = plan([], { network: 'regtest', exit: { fundingInputs: [input('a', 12_000), input('b', 8_000)] } });
    expect(exitFeeRecordOf(older)).toEqual({ quotedExitFeeSat: 20_000, exitFeeAddress: key.address });
  });

  it('is empty for an exit that never needed funding', () => {
    expect(exitFeeRecordOf(plan([]))).toEqual({ quotedExitFeeSat: undefined, exitFeeAddress: undefined });
  });

  it("adds what was sent since to a funded rebuild's record, whatever its quote asks, and carries what was paid through one that needs none", () => {
    const paid = { quotedExitFeeSat: 14_350, exitFeeAddress: 'bcrt1qfee' };
    expect(builtExitFeeRecord(prepared({ funding: funding(16_000) }), paid, undefined, 2_000)).toEqual({
      quotedExitFeeSat: 16_350,
      exitFeeAddress: 'bcrt1qfee',
    });
    expect(builtExitFeeRecord(prepared({ funding: undefined }), paid, 'bcrt1qfee', 2_000)).toEqual(paid);
    expect(builtExitFeeRecord(prepared({ funding: undefined }), {}, undefined, 0)).toEqual({});
  });
});

describe('leftOutSat', () => {
  const dust: SkippedLeaf = { leafId: 'dust', valueSats: 350, reason: { type: 'feeExceedsValue' } };
  const lost: SkippedLeaf = { leafId: 'lost', valueSats: 1_000, reason: { type: 'fundsNotFound' } };

  it.each([
    ['counts every leaf the quote skipped, whatever the reason', [dust, lost], 1_350],
    ['leaves nothing out when the list is empty', [], 0],
  ])('%s', (_, skipped, sat) => {
    expect(leftOutSat(prepared({ skipped }))).toBe(sat);
  });

  it('blames the fee only when it is the reason for every leaf left out', () => {
    expect(quoteFigures(prepared({ skipped: [dust] })).leftOutForFees).toBe(true);
    expect(quoteFigures(prepared({ skipped: [dust, lost] })).leftOutForFees).toBe(false);
    expect(quoteFigures(prepared({ skipped: [] })).leftOutForFees).toBe(false);
  });
});

describe('leftOutReason', () => {
  const skip = (type: 'feeExceedsValue' | 'fundsNotFound' | 'unverified' | 'operatorsUnavailable'): SkippedLeaf => ({
    leafId: type,
    valueSats: 350,
    reason: { type },
  });
  const unrecoverable: SkippedLeaf = { leafId: 'gone', valueSats: 350, reason: { type: 'notRecoverable', message: 'spent' } };

  it('gives none when nothing was skipped', () => {
    expect(leftOutReason(prepared({ skipped: [] }))).toBeNull();
  });

  it.each([
    ['unverified', [skip('unverified'), skip('feeExceedsValue'), unrecoverable]],
    ['missing', [unrecoverable, skip('feeExceedsValue'), skip('fundsNotFound')]],
    ['operators unavailable', [unrecoverable, skip('operatorsUnavailable'), skip('feeExceedsValue')]],
  ])('puts a leaf Glow could not check or find first, as %s, since it may yet move', (_, skipped) => {
    expect(leftOutReason(prepared({ skipped }))).toBe('unavailable');
  });

  it('blames the fee over a leaf that cannot be recovered', () => {
    expect(leftOutReason(prepared({ skipped: [unrecoverable, skip('feeExceedsValue')] }))).toBe('fees');
  });

  it('says the funds cannot be recovered only when that is the reason for every leaf', () => {
    expect(leftOutReason(prepared({ skipped: [unrecoverable, { ...unrecoverable, leafId: 'gone-2' }] }))).toBe('notRecoverable');
  });

  it('says a leaf the operators stopped cannot be recovered once it stays stopped six blocks', () => {
    const quote = prepared({ leaves: [], skipped: [unrecoverable], exitChainState: { ...prepared().exitChainState, stoppedLeafIds: ['gone'] } });
    expect(leftOutReason(quote)).toBe('unavailable');
    expect(quoteFigures(quote, { clock: { since: { gone: 100 }, tipHeight: 105 } }).leftOutReason).toBe('unavailable');
    expect(quoteFigures(quote, { clock: { since: { gone: 100 }, tipHeight: 106 } }).leftOutReason).toBe('notRecoverable');
  });
});

describe('a leaf the operators stopped', () => {
  const stopped = (leafId: string): SkippedLeaf => ({ leafId, valueSats: 350, reason: { type: 'notRecoverable', message: 'stopped' } });
  const quote = prepared({
    leaves: [],
    skipped: [stopped('s-1'), stopped('s-2'), stopped('gone')],
    exitChainState: { ...prepared().exitChainState, stoppedLeafIds: ['s-1', 's-2'] },
  });

  it('is dated when first seen, keeping the date of one seen before', () => {
    expect(stopClock({ 's-1': 90 }, quote, 100)).toEqual({ since: { 's-1': 90, 's-2': 100 }, tipHeight: 100 });
    const known = { 's-1': 90, 's-2': 95 };
    expect(stopClock(known, quote, 100).since).toBe(known);
    expect(stopClock(undefined, prepared(), 100)).toEqual({ since: undefined, tipHeight: 100 });
  });

  it('may yet move until it has stayed stopped for six blocks, and always without a clock', () => {
    const at = (tipHeight: number) => ({ since: { 's-1': 100 }, tipHeight });
    expect(isProvisionalSkip(stopped('s-1'), quote)).toBe(true);
    expect(isProvisionalSkip(stopped('s-1'), quote, at(105))).toBe(true);
    expect(isProvisionalSkip(stopped('s-1'), quote, at(106))).toBe(false);
    // Not dated yet: its six blocks start now.
    expect(isProvisionalSkip(stopped('s-2'), quote, at(500))).toBe(true);
    // Unrecoverable without a stop.
    expect(isProvisionalSkip(stopped('gone'), quote)).toBe(false);
  });
});

describe('quoteFigures', () => {
  it('sends co-signed funds without an exit fee, for exactly what the quote says', () => {
    const quote = prepared({
      leaves: cosigned,
      recoverableValueSats: 48_200,
      sweepFeeSats: 0,
      funding: undefined,
      totalFeeSats: 2_900,
      cooperativeFeeSats: 2_900,
    });
    expect(quoteFigures(quote)).toMatchObject({
      fundsSat: 48_200,
      balanceSat: 0,
      recoverableSat: 48_200,
      networkFeeSat: 2_900,
      exitFeeSat: 0,
      needsFunding: false,
      willReceiveSat: 45_300,
      isCooperative: true,
      isWorthMoving: true,
    });
  });

  it('splits a mixed quote into what arrives now and what waits on the exit fee', () => {
    const quote = prepared({
      leaves: [...stranded, ...cosigned],
      recoverableValueSats: 168_200,
      sweepFeeSats: 1_100,
      funding: funding(14_350),
      totalFeeSats: 18_350,
      cooperativeFeeSats: 2_900,
    });
    expect(quoteFigures(quote)).toMatchObject({
      networkFeeSat: 4_000,
      exitFeeSat: 14_350,
      needsFunding: true,
      willReceiveSat: 164_200,
      recoverableReceiveSat: 45_300,
      balanceReceiveSat: 118_900,
    });
  });

  it('needs no funding once only the sweep is left, which pays its own fee', () => {
    const quote = prepared({
      leaves: stranded,
      recoverableValueSats: 120_000,
      sweepFeeSats: 1_100,
      cpfpFeeSats: 0,
      funding: undefined,
      totalFeeSats: 1_100,
    });
    expect(quoteFigures(quote)).toMatchObject({
      balanceSat: 120_000,
      networkFeeSat: 1_100,
      exitFeeSat: 0,
      needsFunding: false,
      willReceiveSat: 118_900,
      isCooperative: false,
    });
  });

  it('has nothing worth moving when the quote is empty or its fees eat it', () => {
    expect(quoteFigures(prepared({ leaves: [], recoverableValueSats: 0 }))).toMatchObject({ isEmpty: true, isWorthMoving: false });
    expect(quoteFigures(prepared({ recoverableValueSats: 1_000, totalFeeSats: 4_000 }))).toMatchObject({
      isEmpty: false,
      isWorthMoving: false,
    });
  });
});
