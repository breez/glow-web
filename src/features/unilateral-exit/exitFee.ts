import type { ChainClient, ChainUtxo } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import type { Funding, PendingExit, UnilateralExitPlan } from './model/plan';
import { exitFeeRecordOf, isCooperative } from './quote';

/** What a build said it needs: the sdk's error reaches the page only as its message. */
export function requiredFundingOf(error: string): number | null {
  const match = /need at least (\d+) sats/i.exec(error);
  const sat = match ? Number(match[1]) : 0;
  return sat > 0 ? sat : null;
}

/**
 * What a build counts as sent to the exit fee address: the exit's own funding
 * until one of its funded transactions confirms, since the sdk replaces an
 * unconfirmed spender rather than building on it, plus every confirmed coin
 * there. A co-signed recovery spends no funding, so its confirming says nothing.
 * ponytail: mirrors the sdk's rules; take the figure from the sdk once its
 * shortfall error reports what it counted.
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

/** A signed P2WPKH input: each coin at the exit fee address is one more for the build to pay for. */
const P2WPKH_INPUT_VBYTES = 68;

export interface TopUp {
  /** What the address needs at the new rate, the coin still to send included. */
  neededSat: number;
  sentSat: number;
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
  return { neededSat, sentSat: sent.sat, stillToSendSat: Math.max(0, neededSat - sent.sat) };
}

/** What a pending exit's fee address still needs. Unconfirmed coins count, so a payment on its way is not asked for twice. */
export const pendingTopUp = (pending: PendingExit, coins: ChainUtxo[]): TopUp =>
  topUpFor(pending.required, sentFunding(null, coins), pending.feeRateSatPerVbyte);

/** Whether the confirmed coins at the fee address pay for the exit, so it can be started. */
export const isPendingFunded = (pending: PendingExit, coins: ChainUtxo[]): boolean =>
  pendingTopUp(pending, coins.filter(coin => coin.confirmed)).stillToSendSat === 0;

/** What a leftover waiting on its fee still needs at the fee address, from `coins` there. */
export const leftoverTopUp = (plan: UnilateralExitPlan, coins: ChainUtxo[]): TopUp =>
  topUpFor(plan.topUp?.required ?? { sat: 0, inputs: 0 }, sentFunding(plan, coins), plan.feeRateSatPerVbyte);

/** What the exit fee address holds, or null while it is not known or cannot be read. */
async function readFeeCoins(chain: ChainClient, address: string | undefined): Promise<ChainUtxo[] | null> {
  if (!address) return null;
  try {
    return await chain.addressUtxos(address);
  } catch (e) {
    logger.warn(LogCategory.SDK, 'Failed to read the exit fee address', { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** What the confirmed coins hold. */
const confirmedSat = (coins: ChainUtxo[]): number =>
  coins.filter(coin => coin.confirmed).reduce((sum, coin) => sum + coin.value, 0);

export const withHeldSat = (plan: UnilateralExitPlan, coins: ChainUtxo[] | null | undefined): UnilateralExitPlan =>
  plan.topUp && coins && plan.topUp.heldSat === undefined
    ? { ...plan, topUp: { ...plan.topUp, heldSat: confirmedSat(coins) } }
    : plan;

/**
 * A request made in this pass is read against what the address holds now,
 * before the user can have paid it, so the fee paid counts only what they add.
 */
export async function readHeldSat(
  plan: UnilateralExitPlan,
  chain: ChainClient,
  feeCoins?: ChainUtxo[],
): Promise<UnilateralExitPlan> {
  if (!plan.topUp || plan.topUp.heldSat !== undefined) return plan;
  return withHeldSat(plan, feeCoins ?? (await readFeeCoins(chain, exitFeeRecordOf(plan).exitFeeAddress)));
}
