import { describe, expect, it } from 'vitest';
import type { PrepareUnilateralExitResponse } from '@breeztech/breez-sdk-spark';
import { planFromExitResponse } from './driver';
import { leftOutSat, needsFunding, quoteFigures, quotedSweepFeeSat, willReceiveSat } from './quote';
import { checked, confirmed, prepared, sweepHex, twoLeaves, tx } from './testFixtures';

const meta = {
  network: 'mainnet',
  destination: 'bc1qdest',
  feeRateSatPerVbyte: 3,
  fundingAddressIndex: 0,
  quotedSweepFeeSat: 200,
};

/** A quote with the fields the recover-funds API adds to today's. */
const withApi = (
  over: Partial<PrepareUnilateralExitResponse>,
  api: { cooperativeFeeSats?: number; skipped?: { valueSats: number; reason: { type: string } }[] } = {},
): PrepareUnilateralExitResponse => ({ ...prepared(over), ...api });

const cosigned = [
  { leafId: 'c-1', value: 30_000, method: 'cooperative' },
  { leafId: 'c-2', value: 18_200, method: 'cooperative' },
];
const stranded = [
  { leafId: 's-1', value: 60_000, method: 'unilateral' },
  { leafId: 's-2', value: 60_000, method: 'unilateral' },
];

describe('willReceiveSat', () => {
  it('is the balance less the sweep fee: the other fees come out of the funding', () => {
    const quote = prepared({ recoverableValueSat: 600_000, totalFeeSat: 3_122, cpfpFeeSat: 2_907, sweepFeeSat: 215 });
    expect(willReceiveSat(quote)).toBe(599_785);
  });

  it('says the same thing on the quote and on the exit built from it', () => {
    const quote = prepared({ recoverableValueSat: 600_000, totalFeeSat: 3_122, cpfpFeeSat: 2_907, sweepFeeSat: 215 });
    // A fresh build carries no sweep yet, so the sdk reports its fee as zero there.
    const built = planFromExitResponse(
      checked([{ txid: 'r', kind: 'refund' }], { recoverableValueSat: 600_000, sweepFeeSat: 0 }),
      { ...meta, quotedSweepFeeSat: quotedSweepFeeSat(quote, null) },
    );
    expect(willReceiveSat(built)).toBe(willReceiveSat(quote));
    expect(willReceiveSat(built)).toBe(599_785);
  });

  it('does not move when a check or rebuild reprices the exit', () => {
    expect(willReceiveSat(twoLeaves([tx({ txid: 'r', kind: 'refund' })], { exit: { totalFeeSat: 214, sweepFeeSat: 214 } }))).toBe(599_785);
  });

  it('holds a resumed quote to the sweep fee the exit was first quoted at', () => {
    const resuming = twoLeaves([]);
    expect(quotedSweepFeeSat(prepared({ sweepFeeSat: 180 }), resuming)).toBe(215);
    expect(willReceiveSat(prepared({ recoverableValueSat: 600_000, sweepFeeSat: 180 }), resuming)).toBe(599_785);
  });

  it('lets a quote at a higher rate cost more', () => {
    expect(quotedSweepFeeSat(prepared({ sweepFeeSat: 900 }), twoLeaves([]))).toBe(900);
  });

  it('takes the co-signed recoveries\' fee off too, since it comes out of the value moved', () => {
    const quote = withApi({ recoverableValueSat: 600_000, sweepFeeSat: 215 }, { cooperativeFeeSats: 990 });
    expect(quotedSweepFeeSat(quote, null)).toBe(1_205);
    expect(willReceiveSat(quote)).toBe(598_795);
  });

  it('reports what a confirmed sweep actually paid', () => {
    expect(willReceiveSat(twoLeaves([tx({ txid: 's', kind: 'sweep', txHex: sweepHex, status: confirmed(1) })]))).toBe(596_524);
  });

  it('ignores an unconfirmed sweep, which may still be rebuilt', () => {
    expect(willReceiveSat(twoLeaves([tx({ txid: 's', kind: 'sweep', txHex: sweepHex })]))).toBe(599_785);
  });
});

describe('needsFunding', () => {
  it('asks for coins from another wallet only when the quote has an exit fee', () => {
    expect(needsFunding(prepared({ singleUtxoFundingSat: 3_000 }))).toBe(true);
    expect(needsFunding(prepared({ singleUtxoFundingSat: 0 }))).toBe(false);
  });
});

describe('leftOutSat', () => {
  it('counts every leaf the quote skipped, a reason it does not know included', () => {
    const quote = withApi({}, {
      skipped: [
        { valueSats: 350, reason: { type: 'feeExceedsValue' } },
        { valueSats: 1_000, reason: { type: 'aReasonAddedLater' } },
      ],
    });
    expect(leftOutSat(quote, 0)).toBe(1_350);
  });

  it('leaves nothing out when the list is empty, whatever the balance says', () => {
    expect(leftOutSat(withApi({}, { skipped: [] }), 999_999)).toBe(0);
  });

  it('falls back to the balance the quote does not move when it lists nothing', () => {
    expect(leftOutSat(prepared({ recoverableValueSat: 100_000 }), 102_500)).toBe(2_500);
    // Co-signed funds sit outside the balance, so they do not cover any of it.
    expect(leftOutSat(prepared({ leaves: cosigned, recoverableValueSat: 148_200 }), 102_500)).toBe(2_500);
  });
});

describe('quoteFigures', () => {
  it('sends co-signed funds without an exit fee, for exactly what the quote says', () => {
    const quote = withApi(
      { leaves: cosigned, recoverableValueSat: 48_200, sweepFeeSat: 0, singleUtxoFundingSat: 0, totalFeeSat: 2_900 },
      { cooperativeFeeSats: 2_900, skipped: [] },
    );
    expect(quoteFigures(quote)).toMatchObject({
      fundsSat: 48_200,
      balanceSat: 0,
      recoverableSat: 48_200,
      networkFeeSat: 2_900,
      exitFeeSat: 0,
      needsFunding: false,
      willReceiveSat: 45_300,
      isCooperative: true,
      isEstimate: false,
      isWorthMoving: true,
    });
  });

  it('splits a mixed quote into what arrives now and what waits on the exit fee', () => {
    const quote = withApi(
      {
        leaves: [...stranded, ...cosigned],
        recoverableValueSat: 168_200,
        sweepFeeSat: 1_100,
        singleUtxoFundingSat: 14_350,
        totalFeeSat: 18_350,
      },
      { cooperativeFeeSats: 2_900, skipped: [] },
    );
    expect(quoteFigures(quote)).toMatchObject({
      networkFeeSat: 4_000,
      exitFeeSat: 14_350,
      needsFunding: true,
      willReceiveSat: 164_200,
      recoverableReceiveSat: 45_300,
      balanceReceiveSat: 118_900,
      isEstimate: true,
    });
  });

  it('needs no funding once only the sweep is left, which pays its own fee', () => {
    const quote = withApi(
      { leaves: stranded, recoverableValueSat: 120_000, sweepFeeSat: 1_100, cpfpFeeSat: 0, singleUtxoFundingSat: 0, totalFeeSat: 1_100 },
      { skipped: [] },
    );
    expect(quoteFigures(quote)).toMatchObject({
      balanceSat: 120_000,
      networkFeeSat: 1_100,
      exitFeeSat: 0,
      needsFunding: false,
      willReceiveSat: 118_900,
      isCooperative: false,
      isEstimate: false,
    });
  });

  it('has nothing worth moving when the quote is empty or its fees eat it', () => {
    expect(quoteFigures(prepared({ leaves: [], recoverableValueSat: 0 }))).toMatchObject({ isEmpty: true, isWorthMoving: false });
    expect(quoteFigures(prepared({ recoverableValueSat: 1_000, totalFeeSat: 4_000 }))).toMatchObject({
      isEmpty: false,
      isWorthMoving: false,
    });
  });
});
