import { isPendingFunded, leftoverTopUp, MIN_SEND_SAT, pendingTopUp, requiredFundingOf, sentFunding, topUpFor } from './exitFee';
import { coin, confirmed, pendingExit, plan, tx } from './testFixtures';
import { describe, expect, it } from 'vitest';

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

  it('asks for no less than wallets send, and the breakdown still adds up', () => {
    // 1 286 paid in two coins leaves their two input fees, 136 sats, which no wallet sends.
    const short = topUpFor({ sat: 1_286, inputs: 1 }, { sat: 1_286, inputs: 2 }, 1);
    expect(short).toEqual({ neededSat: 1_832, sentSat: 1_286, stillToSendSat: MIN_SEND_SAT });
    expect(short.neededSat - short.sentSat).toBe(short.stillToSendSat);
    // Once that coin arrives, its own input fee included, nothing is left to send.
    expect(topUpFor({ sat: 1_286, inputs: 1 }, { sat: 1_832, inputs: 3 }, 1).stillToSendSat).toBe(0);
  });

  it('asks nothing of an address that holds enough', () => {
    expect(topUpFor({ sat: 1_286, inputs: 1 }, { sat: 1_363, inputs: 1 }, 1)).toEqual({ neededSat: 1_286, sentSat: 1_363, stillToSendSat: 0 });
  });
});

describe('what a pending exit or a leftover asks for', () => {
  it('asks no less than wallets send of a pending exit whose fee address already holds nearly enough', () => {
    const pending = pendingExit({ feeRateSatPerVbyte: 1, required: { sat: 1_286, inputs: 1 } });
    expect(pendingTopUp(pending, [coin(1_200)]).stillToSendSat).toBe(MIN_SEND_SAT);
    expect(isPendingFunded(pending, [coin(1_200), coin(MIN_SEND_SAT)])).toBe(true);
  });

  it('asks no less than wallets send for a leftover', () => {
    const asking = plan([tx({ txid: 's', kind: 'sweep', status: confirmed(9) })], {
      feeRateSatPerVbyte: 1,
      status: { type: 'needsExitFee', topUp: { required: { sat: 300, inputs: 1 } } },
    });
    expect(leftoverTopUp(asking, []).stillToSendSat).toBe(MIN_SEND_SAT);
  });
});
