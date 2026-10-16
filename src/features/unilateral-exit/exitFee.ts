import type { ChainClient, ChainUtxo } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { inputOutpoints } from '@/utils/rawTx';
import type { Funding, PendingExit, UnilateralExitPlan } from './model/plan';
import { isCooperative } from './quote';

/** What a build said it needs: the sdk's error reaches the page only as its message. */
export function requiredFundingOf(error: string): number | null {
  const match = /need at least (\d+) sats/i.exec(error);
  const sat = match ? Number(match[1]) : 0;
  return sat > 0 ? sat : null;
}

/** A refusal over the fee as the SDK or a node words it: a replacement or relay fee too low. */
const FEE_REFUSAL = /replacementFeeTooLow|replacement fee too low|insufficient fee|min (?:relay )?fee not met/i;

/** Glow's retry once the fee is what failed. */
export const FEE_RETRY = 'Please try again or choose a different fee.';

/** Whether a failure is about the fee, which another rate can fix. Only the message reaches the page. */
export const isFeeFailure = (error: string): boolean =>
  error === FEE_RETRY || requiredFundingOf(error) !== null || FEE_REFUSAL.test(error);

/** What to do after a failure: try again, and pick another rate when the fee is what failed. */
export const retryAdvice = (error: string): string => (isFeeFailure(error) ? FEE_RETRY : 'Please try again.');

/**
 * What a build counts as sent to the exit fee address: every confirmed coin
 * there, plus the exit's own funding until one of its funded, not co-signed,
 * transactions confirms, since the sdk replaces an unconfirmed spender.
 * ponytail: mirrors the sdk's rules; take the sdk's figure once its shortfall error reports it.
 */
export function sentFunding(
  plan: UnilateralExitPlan | null,
  confirmed: { txid: string; vout: number; value: number }[],
): Funding {
  const spent = plan?.exit.transactions.some(tx => !isCooperative(tx) && tx.status.type === 'confirmed');
  const own = plan && !spent ? plan.exit.fundingInputs.map(({ txid, vout, valueSats }) => ({ txid, vout, value: valueSats })) : [];
  const coins = new Map([...own, ...confirmed].map(coin => [`${coin.txid}:${coin.vout}`, coin.value]));
  return { sat: [...coins.values()].reduce((total, value) => total + value, 0), inputs: coins.size };
}

/**
 * `coins` less any still in the mempool that the exit's own steps spend: that
 * is the exit's change, not a payment, and beside the funding it came from it
 * would count the same money twice.
 */
export function withoutOwnChange(plan: UnilateralExitPlan | null, coins: ChainUtxo[]): ChainUtxo[] {
  const spent = new Set(
    plan?.exit.transactions.flatMap(tx => [tx.txHex, tx.cpfpTxHex].flatMap(hex => (hex ? inputOutpoints(hex) : []))),
  );
  return coins.filter(coin => coin.confirmed || !spent.has(`${coin.txid}:${coin.vout}`));
}

/**
 * What reached the fee address since `plan` was built: the coins its funding
 * does not hold and none of its own transactions spend. Each change output
 * an exit returns there is spent by its next step, so none counts.
 */
export function sentSince(plan: UnilateralExitPlan, coins: { txid: string; vout: number; value: number }[]): number {
  const own = new Set([
    ...plan.exit.fundingInputs.map(({ txid, vout }) => `${txid}:${vout}`),
    ...plan.exit.transactions.flatMap(tx => [tx.txHex, tx.cpfpTxHex].flatMap(hex => (hex ? inputOutpoints(hex) : []))),
  ]);
  return coins.filter(coin => !own.has(`${coin.txid}:${coin.vout}`)).reduce((sum, coin) => sum + coin.value, 0);
}

/** A signed P2WPKH input: each coin at the exit fee address is one more for the build to pay for. */
const P2WPKH_INPUT_VBYTES = 68;

/**
 * The least Glow asks anyone to send: common wallets refuse a smaller payment
 * as dust. What it adds stays at the fee address and counts toward later.
 */
export const MIN_SEND_SAT = 546;

export interface TopUp {
  /** What the address is asked to hold at the new rate, the coin still to send included. */
  neededSat: number;
  sentSat: number;
  /** Nothing, or at least `MIN_SEND_SAT`. */
  stillToSendSat: number;
}

/**
 * What to send after a build fell short. The sdk sized `required` on the inputs
 * that build had, so each coin sent since, and the one still to send, adds its
 * own input fee. A quote is sized on the one coin it assumes, so its first coin
 * adds nothing.
 */
export function topUpFor(required: Funding, sent: Funding, feeRateSatPerVbyte: number): TopUp {
  const inputFeeSat = Math.ceil(P2WPKH_INPUT_VBYTES * feeRateSatPerVbyte);
  const neededNowSat = required.sat + inputFeeSat * Math.max(0, sent.inputs - required.inputs);
  const nextCoinSat = sent.inputs < required.inputs ? 0 : inputFeeSat;
  const neededSat = sent.sat >= neededNowSat ? neededNowSat : neededNowSat + nextCoinSat;
  const gapSat = Math.max(0, neededSat - sent.sat);
  const stillToSendSat = gapSat > 0 ? Math.max(MIN_SEND_SAT, gapSat) : 0;
  return { neededSat: neededSat + stillToSendSat - gapSat, sentSat: sent.sat, stillToSendSat };
}

/** What a pending exit's fee address still needs. Unconfirmed coins count, so a payment on its way is not asked for twice. */
export const pendingTopUp = (pending: PendingExit, coins: ChainUtxo[]): TopUp =>
  topUpFor(pending.required, sentFunding(null, coins), pending.feeRateSatPerVbyte);

/** Whether the confirmed coins at the fee address pay for the exit, so it can be started. */
export const isPendingFunded = (pending: PendingExit, coins: ChainUtxo[]): boolean =>
  pendingTopUp(pending, coins.filter(coin => coin.confirmed)).stillToSendSat === 0;

// What each fee address was last read to hold. A screen falls back to it when
// a read fails: shown as empty, a paid address would ask for its fee again.
const lastRead = new Map<string, ChainUtxo[]>();

/** Reads what a fee address holds, kept for a later read of it that fails. */
export async function readFeeAddress(chain: ChainClient, address: string): Promise<ChainUtxo[]> {
  const coins = await chain.addressUtxos(address);
  lastRead.set(address, coins);
  return coins;
}

/** What `address` was last read to hold in this session, or undefined when it never was. */
export const lastReadCoins = (address: string | undefined): ChainUtxo[] | undefined =>
  address === undefined ? undefined : lastRead.get(address);

/** What the exit fee address holds, or null while it is not known or cannot be read. */
export async function readFeeCoins(chain: ChainClient, address: string | undefined): Promise<ChainUtxo[] | null> {
  if (!address) return null;
  try {
    return await readFeeAddress(chain, address);
  } catch (e) {
    logger.warn(LogCategory.SDK, 'Failed to read the exit fee address', { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
