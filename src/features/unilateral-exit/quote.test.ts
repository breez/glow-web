import { describe, expect, it } from 'vitest';
import type { RecoverFundsLeaf, SkippedLeaf } from '@breeztech/breez-sdk-spark';
import { planFromBuild, planFromExitResponse } from './driver';
import { deriveFundingKey } from './funding';
import {
  builtExitFeeRecord,
  builtSweepFeeSat,
  exitFeeRecordOf,
  exitFeeSat,
  leftOutSat,
  needsFunding,
  quoteFigures,
  quotedSweepFeeSat,
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

describe('willReceiveSat', () => {
  it('is the balance less the sweep fee: the other fees come out of the funding', () => {
    const quote = prepared({ recoverableValueSats: 600_000, totalFeeSats: 3_122, cpfpFeeSats: 2_907, sweepFeeSats: 215 });
    expect(willReceiveSat(quote)).toBe(599_785);
  });

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

  it('takes the co-signed recoveries\' fee off too, since it comes out of the value moved', () => {
    const quote = prepared({ recoverableValueSats: 600_000, sweepFeeSats: 215, cooperativeFeeSats: 990 });
    expect(quotedSweepFeeSat(quote, null)).toBe(1_205);
    expect(willReceiveSat(quote)).toBe(598_795);
  });

  it('takes only the co-signed fee of what was built, so a leaf the operators did not co-sign costs nothing', () => {
    // Two co-signed leaves quoted at 1 450 each; the build co-signed one.
    const quote = prepared({ leaves: cosigned, recoverableValueSats: 48_200, sweepFeeSats: 0, cooperativeFeeSats: 2_900, funding: undefined });
    const built = checked([{ txid: 'c1', kind: 'cooperative', nodeId: 'c-1' }], {
      leaves: [cosigned[0]],
      recoverableValueSats: 30_000,
      cooperativeFeeSats: 1_450,
      sweepFeeSats: 0,
    });
    expect(builtSweepFeeSat(quote, built, null)).toBe(1_450);
    expect(willReceiveSat(planFromBuild(quote, built, null, { network: 'mainnet', fundingAddressIndex: 0 }))).toBe(28_550);
  });

  it('reports what a confirmed sweep actually paid', () => {
    expect(willReceiveSat(twoLeaves([tx({ txid: 's', kind: 'sweep', txHex: sweepHex, status: confirmed(1) })]))).toBe(596_524);
  });

  it('ignores an unconfirmed sweep, which may still be rebuilt', () => {
    expect(willReceiveSat(twoLeaves([tx({ txid: 's', kind: 'sweep', txHex: sweepHex })]))).toBe(599_785);
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
    const recorded = plan([], { quotedExitFeeSat: 14_350, exitFeeAddress: 'bcrt1qfee', exit: { fundingInputs: [] } });
    expect(exitFeeRecordOf(recorded)).toEqual({ quotedExitFeeSat: 14_350, exitFeeAddress: 'bcrt1qfee' });
  });

  it('reads an older plan off the coins its builds spent', () => {
    const older = plan([], { network: 'regtest', exit: { fundingInputs: [input('a', 12_000), input('b', 8_000)] } });
    expect(exitFeeRecordOf(older)).toEqual({ quotedExitFeeSat: 20_000, exitFeeAddress: key.address });
  });

  it('is empty for an exit that never needed funding', () => {
    expect(exitFeeRecordOf(plan([]))).toEqual({ quotedExitFeeSat: undefined, exitFeeAddress: undefined });
  });

  it('takes a funded build\'s own exit fee, and carries what was paid through one that needs none', () => {
    const paid = { quotedExitFeeSat: 14_350, exitFeeAddress: 'bcrt1qfee' };
    expect(builtExitFeeRecord(prepared({ funding: funding(16_000) }), paid)).toEqual({
      quotedExitFeeSat: 16_000,
      exitFeeAddress: 'bcrt1qfee',
    });
    expect(builtExitFeeRecord(prepared({ funding: undefined }), paid)).toEqual(paid);
    expect(builtExitFeeRecord(prepared({ funding: undefined }), {})).toEqual({});
  });
});

describe('leftOutSat', () => {
  const dust: SkippedLeaf = { leafId: 'dust', valueSats: 350, reason: { type: 'feeExceedsValue' } };
  const lost: SkippedLeaf = { leafId: 'lost', valueSats: 1_000, reason: { type: 'fundsNotFound' } };

  it('counts every leaf the quote skipped, whatever the reason', () => {
    expect(leftOutSat(prepared({ skipped: [dust, lost] }))).toBe(1_350);
  });

  it('leaves nothing out when the list is empty', () => {
    expect(leftOutSat(prepared({ skipped: [] }))).toBe(0);
  });

  it('blames the fee only when it is the reason for every leaf left out', () => {
    expect(quoteFigures(prepared({ skipped: [dust] })).leftOutForFees).toBe(true);
    expect(quoteFigures(prepared({ skipped: [dust, lost] })).leftOutForFees).toBe(false);
    expect(quoteFigures(prepared({ skipped: [] })).leftOutForFees).toBe(false);
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
