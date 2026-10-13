import { singleKeyCpfpSigner } from '@breeztech/breez-sdk-spark';
import type {
  BreezSdk,
  CooperativeRecoveryFailure,
  CpfpFundingKind,
  CpfpInput,
  PrepareRecoverFundsResponse,
  RecoverFundsLeaf,
  RecoverFundsResponse,
  RecoveryTransaction,
  RecoveryVerdict,
} from '@breeztech/breez-sdk-spark';
import type { ChainClient, ChainUtxo } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { inputOutpoints, outputTotalSat } from '@/utils/rawTx';
import { loadExitState, restoreExitState, saveExitState } from './exitState';
import { deriveFundingKey, MnemonicNeedsPasskeyError, readWalletMnemonic, type FundingKey } from './funding';
import { planFromV4, type V4Plan } from './legacyPlan';
import {
  builtExitFeeRecord,
  builtSweepFeeSat,
  cooperativeValueSat,
  exitFeeRecordOf,
  exitFeeSat,
  isCooperative,
  isCooperativeLeaf,
  isWorthExiting,
  needsFunding,
  paidOut,
  priorLandings,
  willReceiveSat,
  type ExitFeeRecord,
} from './quote';

/**
 * `complete` is the sdk's `done` verdict. `redo` is its `redo`: the chain no
 * longer matches these transactions, so the exit has to be built again.
 */
export type ExitPhase = 'active' | 'complete' | 'redo';

/** A leaf an exit set out to move, at the value it was quoted. */
export interface NamedLeaf {
  leafId: string;
  valueSats: number;
}

/** Leaves paid out on-chain. Waiting until `txid` is read. */
export interface Landing {
  leafIds: string[];
  valueSat: number;
  /** What the paying transaction spends, used only to find that transaction. */
  outpoint?: string;
  /** The transaction in a block that paid the leaves: Glow's own, or a replacement. */
  txid?: string;
  /** What `txid` paid the destination. Entries can share a txid, so it counts once per txid. */
  paidSat?: number;
  blockHeight?: number;
  /** The tip of the first read that found no spender in a block. */
  unreadSince?: number;
}

export interface UnilateralExitPlan {
  version: 5;
  network: string;
  destination: string;
  feeRateSatPerVbyte: number;
  fundingAddressIndex: number;
  /**
   * What comes off the value moved: the sweep's fee, plus the co-signed
   * recoveries' where there are any, so the figure shown is the value less
   * this. The fees the funding pays do not reduce what arrives.
   */
  quotedSweepFeeSat: number;
  /**
   * What the exit fee address was asked for, and where it is. Kept here as well
   * as in the funding inputs, which a build that needs no funding leaves empty.
   * Absent when the exit never needed any, or on a plan written before these
   * existed, whose funding inputs stand in (`exitFeeRecordOf`).
   */
  quotedExitFeeSat?: number;
  exitFeeAddress?: string;
  /** The sdk's latest word on the exit, handed back to `checkRecoverFunds` unchanged. */
  exit: RecoverFundsResponse;
  /**
   * Every leaf the exit set out to move. A rebuild names them all, so a leaf one
   * quote skipped is named again in the next; a leaf drops out once a quote names
   * it nowhere, which means it landed. Absent on a plan from before this was
   * kept: the exit's leaves and failures stand in (`namedLeavesOf`).
   */
  namedLeaves?: NamedLeaf[];
  /**
   * The ledger the archive is read from: what this build and every one it
   * replaced paid out. A rebuild keeps only its own transactions, so this is
   * the one record of what earlier builds landed. Absent means none yet.
   */
  landed?: Landing[];
  /** The co-signed part of the first build: funds that were outside the balance before the exit began. */
  recoverableFundsSat?: number;
  /**
   * Why the network last refused each transaction, by txid, for diagnostics. The
   * tracker shows none: Glow retries a refusal on every check. Cleared once the
   * transaction is accepted or confirms.
   */
  refusals: Record<string, string>;
  phase: ExitPhase;
  /** Frozen when the exit was built: the operators stop reporting the leaves it moves. */
  exitStateSnapshot?: string;
  mode?: ExitMode;
  /** Glow's conversion of an exit stored under SDK 0.26, built again once nothing of it is in flight. */
  needsRebuild?: true;
  /** A rebuild needs the passkey, which only a tap can ask for, so the engine leaves it to the tracker's button. */
  needsSignIn?: true;
  /** The last background rebuild of a diverged exit failed for a reason other than waiting on the chain, so the exit asks for the update tap. */
  rebuildFailed?: true;
  /** The tip of Glow's last rebuild over an Unverified step: once a block, so a failing chain service is not asked every pass. */
  unverifiedRebuiltAt?: number;
  /**
   * The tip at which a checked pass first found a co-signed recovery stuck
   * unverified, which Glow prepares again by itself (`retryDue`). Cleared once
   * none is left.
   */
  retrySince?: number;
  /** The tip of the last of those retries. */
  retriedAt?: number;
  /**
   * Leaves the exit named that a quote then found unrecoverable. Hidden from
   * the Recoverable Funds row by ID, and left out of Glow's fresh quotes.
   */
  droppedLeaves?: NamedLeaf[];
  /** A unilateral leaf the exit left out, waiting on more exit fee. Plan slot only. */
  topUp?: ExitTopUp;
  /**
   * Why an active exit asks for the update tap: a step the SDK could not read,
   * which only a rebuild settles, and that rebuild needs the passkey. It asks
   * only while `needsSignIn` is set too (`awaitsUpdate`).
   */
  redoCause?: 'unverified';
}

/**
 * What a leftover's build needs at the exit fee address, at the plan's rate.
 * Asked only once nothing of the exit is in flight, and a build clears it.
 */
export interface ExitTopUp {
  required: Funding;
  /** What the address held when first read after the ask, so the fee paid counts only what was added. */
  heldSat?: number;
  /** The build needs the passkey, or the key to say where to pay, which only a tap can read. */
  needsSignIn?: true;
}

/**
 * `recover` moves funds found outside the balance for a wallet that never
 * started an exit. Absent means a unilateral exit the user started.
 */
export type ExitMode = 'recover';

const PLAN_VERSION = 5;

export interface WalletKey {
  identityPubkey: string;
  network: string;
}

export interface PlanMeta {
  network: string;
  destination: string;
  feeRateSatPerVbyte: number;
  fundingAddressIndex: number;
  quotedSweepFeeSat: number;
  quotedExitFeeSat?: number;
  exitFeeAddress?: string;
  namedLeaves?: NamedLeaf[];
  landed?: Landing[];
  droppedLeaves?: NamedLeaf[];
  retrySince?: number;
  retriedAt?: number;
  recoverableFundsSat?: number;
  mode?: ExitMode;
}

const storageKey = ({ identityPubkey, network }: WalletKey): string =>
  `recovery-plan:${identityPubkey.slice(0, 16)}:${network}`;

export function planFromExitResponse(exit: RecoverFundsResponse, meta: PlanMeta): UnilateralExitPlan {
  return { version: PLAN_VERSION, ...meta, exit, refusals: {}, phase: 'active' };
}

/** A unilateral step the SDK could not read while building: never sent, and a check never settles it. */
const hasUnverifiedStep = (plan: UnilateralExitPlan): boolean =>
  plan.exit.transactions.some(tx => tx.status.type === 'unverified' && !isCooperative(tx));

/**
 * Whether the exit waits on the user's update tap. Glow rebuilds a diverged
 * exit on every pass, so it asks only when that rebuild needs the passkey or
 * has failed. An active exit asks when its Unverified step needs a rebuild only
 * the passkey can sign, and keeps running meanwhile. A finished one never asks,
 * though a tap that finished it leaves the flags until the engine archives it.
 */
export const awaitsUpdate = (plan: UnilateralExitPlan): boolean =>
  plan.phase === 'redo'
    ? !!plan.needsSignIn || !!plan.rebuildFailed
    : plan.phase === 'active' && !!plan.needsSignIn && plan.redoCause === 'unverified';

/**
 * Adds what the build landed to the ledger. A sweep confirms by its own txid,
 * so its hex says what it paid. The SDK confirms a co-signed recovery once any
 * spend of its output is in a block, so that entry waits for the spender.
 */
export function recordLanded(plan: UnilateralExitPlan): UnilateralExitPlan {
  const before = plan.landed ?? [];
  const landed = [...before];
  const { transactions, leaves } = plan.exit;
  const covered = new Set(before.flatMap(entry => entry.leafIds));
  const recorded = new Set(before.flatMap(entry => entry.txid ?? []));
  const valueOf = (ids: string[]) =>
    leaves.filter(leaf => ids.includes(leaf.leafId)).reduce((sum, leaf) => sum + leaf.valueSats, 0);

  for (const tx of transactions) {
    if (tx.status.type !== 'confirmed') continue;
    if (tx.kind === 'sweep' && !recorded.has(tx.txid)) {
      const paidSat = outputTotalSat(tx.txHex);
      if (paidSat === null) continue;
      // A leaf already waiting on a read is not counted twice.
      const leafIds = transactions.flatMap(refund =>
        refund.kind === 'refund' && refund.nodeId && tx.dependsOn.includes(refund.txid) && !covered.has(refund.nodeId)
          ? [refund.nodeId]
          : [],
      );
      leafIds.forEach(id => covered.add(id));
      landed.push({ leafIds, valueSat: valueOf(leafIds), txid: tx.txid, paidSat, blockHeight: tx.status.blockHeight });
    } else if (isCooperative(tx) && tx.nodeId && !covered.has(tx.nodeId)) {
      const [outpoint] = inputOutpoints(tx.txHex);
      if (!outpoint) continue;
      covered.add(tx.nodeId);
      landed.push({ leafIds: [tx.nodeId], valueSat: valueOf([tx.nodeId]), outpoint });
    }
  }
  return landed.length === before.length ? plan : { ...plan, landed };
}

/** Whether the ledger still waits on a read of what paid an entry out. */
export const hasWaitingLanding = (plan: UnilateralExitPlan): boolean => (plan.landed ?? []).some(entry => !entry.txid);

/** Folds a check onto the plan. The sdk owns the exit and the phase; glow keeps only what the network told it about its own sends. */
export function applyExitCheck(
  plan: UnilateralExitPlan,
  checked: RecoverFundsResponse,
  phase: ExitPhase,
): UnilateralExitPlan {
  const open = new Set(
    checked.transactions.filter(tx => tx.status.type !== 'confirmed').map(tx => tx.txid),
  );
  const refusals = Object.fromEntries(
    Object.entries(plan.refusals).filter(([txid]) => open.has(txid)),
  );
  // Recorded before a rebuild can replace the exit, which is the last place
  // its transactions exist.
  const next = recordLanded({ ...plan, exit: checked, refusals, phase });
  // The tap asked for over an Unverified step ends with that step, or with a
  // divergence, whose own rebuild asks again if it has to sign.
  if (plan.redoCause === 'unverified' && (phase === 'redo' || !hasUnverifiedStep(next))) {
    return { ...next, redoCause: undefined, needsSignIn: undefined };
  }
  return next;
}

export function savePlan(wallet: WalletKey, plan: UnilateralExitPlan): void {
  try {
    localStorage.setItem(storageKey(wallet), JSON.stringify(plan));
    return;
  } catch (e) {
    logger.error(LogCategory.SDK, 'Failed to persist recovery plan', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  // The snapshot can outgrow localStorage. Losing the plan would lose the exit,
  // so it is kept without the snapshot, which moves to the rolling backup that
  // a restore falls back to and that nothing refreshes while the exit runs.
  // ponytail: retried on every save while too big; keep the snapshot in
  // IndexedDB from the start if that ever costs.
  if (!plan.exitStateSnapshot) return;
  const { exitStateSnapshot, ...rest } = plan;
  try {
    localStorage.setItem(storageKey(wallet), JSON.stringify(rest));
    void saveExitState(wallet.identityPubkey, exitStateSnapshot).catch(e =>
      logger.error(LogCategory.SDK, 'Failed to move the exit snapshot to the rolling backup', {
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  } catch (e) {
    logger.error(LogCategory.SDK, 'Failed to persist recovery plan without its snapshot', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** A version 4 plan, from SDK 0.26, is converted rather than dropped: it may be part-way through an exit. */
export function loadPlan(wallet: WalletKey): UnilateralExitPlan | null {
  const raw = localStorage.getItem(storageKey(wallet));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as UnilateralExitPlan | V4Plan;
    if (!Array.isArray(parsed?.exit?.transactions)) return null;
    if (parsed.version === 4) return planFromV4(parsed);
    return parsed.version === PLAN_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPlan(wallet: WalletKey): void {
  localStorage.removeItem(storageKey(wallet));
}

/**
 * Co-signed recoveries Glow broadcast and follows until they confirm. The sdk
 * records no payment for one, so this is the only record of it. Plan-shaped,
 * mode `recover`, cooperative transactions only, and kept beside the plan and
 * pending slots: they need no funding key, so they never hold up an exit.
 */
const recoveriesKey = ({ identityPubkey, network }: WalletKey): string =>
  `recovery-cosigned:${identityPubkey.slice(0, 16)}:${network}`;

export function saveRecoveries(wallet: WalletKey, recoveries: UnilateralExitPlan[]): void {
  try {
    localStorage.setItem(recoveriesKey(wallet), JSON.stringify(recoveries));
  } catch (e) {
    logger.error(LogCategory.SDK, 'Failed to persist the co-signed recoveries', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * A kept recovery names only the leaves it built: one whose co-signing failed
 * is left to the Recoverable Funds row, so a kept recovery has no leftovers.
 */
export const asKeptRecovery = (recovery: UnilateralExitPlan): UnilateralExitPlan => ({
  ...recovery,
  namedLeaves: recovery.exit.leaves.map(({ leafId, valueSats }) => ({ leafId, valueSats })),
});

export function loadRecoveries(wallet: WalletKey): UnilateralExitPlan[] {
  const raw = localStorage.getItem(recoveriesKey(wallet));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as UnilateralExitPlan[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(r => r?.version === PLAN_VERSION && Array.isArray(r.exit?.transactions)).map(asKeptRecovery);
  } catch {
    return [];
  }
}

/**
 * An exit saved when its fee address is first shown, before anything is built.
 * The user starts it once confirmed coins at the address pay for it.
 */
export interface PendingExit {
  network: string;
  destination: string;
  feeRateSatPerVbyte: number;
  fundingAddressIndex: number;
  fundingAddress: string;
  /** The quote's figure, until a start that fell short replaces it with the build's. */
  required: Funding;
  /** What the quote said would arrive, shown until the exit is built. */
  willReceiveSat: number;
  mode?: ExitMode;
}

const pendingKey = ({ identityPubkey, network }: WalletKey): string =>
  `unilateral-exit-pending:${identityPubkey.slice(0, 16)}:${network}`;

export function savePendingExit(wallet: WalletKey, pending: PendingExit): void {
  try {
    localStorage.setItem(pendingKey(wallet), JSON.stringify(pending));
  } catch (e) {
    logger.error(LogCategory.SDK, 'Failed to persist the pending unilateral exit', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export function loadPendingExit(wallet: WalletKey): PendingExit | null {
  const raw = localStorage.getItem(pendingKey(wallet));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingExit;
    return typeof parsed?.fundingAddress === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingExit(wallet: WalletKey): void {
  localStorage.removeItem(pendingKey(wallet));
}

/**
 * Where the money is. A leaf sits in Spark until its refund is on-chain, then
 * in an output only the owner can spend, and reaches the destination when the
 * sweep confirms. A co-signed leaf reaches it when its own recovery confirms.
 */
export interface ExitStages {
  inSpark: number;
  onChain: number;
  delivered: number;
  willReceive: number;
}

export function exitStages(plan: UnilateralExitPlan): ExitStages {
  const willReceive = willReceiveSat(plan);
  const { transactions, leaves } = plan.exit;
  // A leaf no build holds yet has not started to move.
  const waitingSat = leftoverValueSat(plan);
  if (transactions.find(tx => tx.kind === 'sweep')?.status.type === 'confirmed') {
    return { inSpark: waitingSat, onChain: 0, delivered: willReceive, willReceive };
  }

  const confirmedFor = (matches: (tx: RecoveryTransaction) => boolean) =>
    new Set(transactions.filter(tx => matches(tx) && tx.status.type === 'confirmed').map(tx => tx.nodeId));
  const refunded = confirmedFor(tx => tx.kind === 'refund');
  const recovered = confirmedFor(isCooperative);
  const valueOf = (ids: Set<string | undefined>) =>
    leaves.filter(leaf => ids.has(leaf.leafId)).reduce((sum, leaf) => sum + leaf.valueSats, 0);
  const total = leaves.reduce((sum, leaf) => sum + leaf.valueSats, 0);
  const onChain = valueOf(refunded);
  const recoveredSat = valueOf(recovered);
  // Leaves earlier builds paid out are delivered, though this build never held them.
  const delivered = recoveredSat + paidOut(priorLandings(plan)).valueSat;
  return { inSpark: total - onChain - recoveredSat + waitingSat, onChain, delivered, willReceive };
}

/**
 * Blocks until the last step could confirm: the longest path left through the
 * set, each step costing its remaining timelock plus a block to confirm in.
 * Null once nothing is left to send. Relies on the sdk returning the set in
 * broadcast order, so a dependency is always reached before what depends on it.
 */
export function blocksToFinish(all: RecoveryTransaction[], tipHeight: number): number | null {
  const after = new Map<string, number>();
  let longest: number | null = null;

  for (const tx of all) {
    if (tx.status.type === 'confirmed') {
      after.set(tx.txid, 0);
      continue;
    }
    // A ready step's timelock has matured; a started one counts down from the
    // height the sdk gives; one not yet started lies wholly ahead of whatever
    // its dependency waits on.
    const timelock =
      tx.status.type === 'ready'
        ? 0
        : tx.status.type === 'waitingForTimelock' && tx.status.spendableAtHeight !== undefined
          ? Math.max(0, tx.status.spendableAtHeight - tipHeight)
          : (tx.csvTimelockBlocks ?? 0);
    const waits = tx.dependsOn.map(id => after.get(id) ?? 0);
    const blocks = (waits.length > 0 ? Math.max(...waits) : 0) + timelock + 1;

    after.set(tx.txid, blocks);
    longest = longest === null ? blocks : Math.max(longest, blocks);
  }
  return longest;
}

/** The slice of the sdk a pass drives. */
export type ExitSdk = Pick<
  BreezSdk,
  | 'checkRecoverFunds'
  | 'prepareRecoverFunds'
  | 'recoverFunds'
  | 'importUnilateralExitState'
  | 'exportUnilateralExitState'
  | 'syncWallet'
>;

/**
 * What a pass sends: whatever the sdk resolved as ready against the chain tip,
 * timelock included. A co-signed recovery also goes out unverified, since the
 * network refuses it if its funds already moved.
 */
export const isSendable = (tx: RecoveryTransaction): boolean =>
  tx.status.type === 'ready' || (isCooperative(tx) && tx.status.type === 'unverified');

/** A co-signed recovery whose input is not in a block. It may never be, so Glow prepares it again. */
const isUnverifiedCosigned = (tx: RecoveryTransaction): boolean => isCooperative(tx) && tx.status.type === 'unverified';

/** The leaves Glow prepares again by itself. In the plan slot, the leaves the exit left out as well. */
const retryTargetsOf = (plan: UnilateralExitPlan, withLeftovers = false): string[] => {
  const stuck = plan.exit.transactions.flatMap(tx => (isUnverifiedCosigned(tx) && tx.nodeId ? [tx.nodeId] : []));
  return withLeftovers ? [...stuck, ...leftoverIdsOf(plan).filter(id => !stuck.includes(id))] : stuck;
};

const RETRY_BLOCKS = 6;
const RETRY_MAX_BLOCKS = 144;
/** About a week. */
const RELEASE_BLOCKS = 1_008;

/**
 * Six blocks after the clock starts, then at doubling gaps up to a day, so a
 * recovery that never moves costs one prepare a day.
 */
export function retryDue(plan: UnilateralExitPlan, tipHeight: number): boolean {
  const since = plan.retrySince;
  if (since === undefined) return false;
  const last = Math.max(since, plan.retriedAt ?? since);
  const gap = Math.min(RETRY_MAX_BLOCKS, Math.max(RETRY_BLOCKS, last - since));
  return tipHeight - last >= gap;
}

/**
 * What is still stuck after about a week is let go, so the exit can finish and
 * the leaf shows as Recoverable Funds again. Not while a unilateral step is in
 * flight: a leftover waits for the rest to land, and its own build is not cut
 * short.
 */
export const releaseDue = (plan: UnilateralExitPlan, tipHeight: number): boolean =>
  plan.retrySince !== undefined &&
  tipHeight - plan.retrySince >= RELEASE_BLOCKS &&
  plan.exit.transactions.every(tx => isCooperative(tx) || tx.status.type === 'confirmed');

/** Starts the clock on the first checked pass that finds a target, and stops it once none is left. */
function paceRetry(plan: UnilateralExitPlan, tipHeight: number, withLeftovers: boolean): UnilateralExitPlan {
  if (retryTargetsOf(plan, withLeftovers).length > 0) {
    return plan.retrySince === undefined ? { ...plan, retrySince: tipHeight } : plan;
  }
  if (plan.retrySince === undefined && plan.retriedAt === undefined) return plan;
  return { ...plan, retrySince: undefined, retriedAt: undefined };
}

/**
 * Nothing can move but through a retry: every transaction confirmed except
 * co-signed recoveries stuck unverified, and nothing waits on a read or on the
 * exit fee. The engine polls less often then.
 */
export const isStalled = (plan: UnilateralExitPlan): boolean =>
  plan.phase === 'active' &&
  !hasWaitingLanding(plan) &&
  !plan.topUp &&
  plan.exit.transactions.every(tx => tx.status.type === 'confirmed' || isUnverifiedCosigned(tx)) &&
  (plan.exit.transactions.some(isUnverifiedCosigned) || leftoverIdsOf(plan).length > 0);

export { destinationAddressOf } from '@/utils/destinationAddress';

/** What a build said it needs: the sdk's error reaches the page only as its message. */
export function requiredFundingOf(error: string): number | null {
  const match = /need at least (\d+) sats/i.exec(error);
  const sat = match ? Number(match[1]) : 0;
  return sat > 0 ? sat : null;
}

export interface Funding {
  sat: number;
  inputs: number;
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

export type StartOutcome =
  | { type: 'started'; plan: UnilateralExitPlan }
  | { type: 'short'; required: Funding }
  | { type: 'nothingToExit' };

/** Coins at the exit fee address and the key that signs for them. */
export interface BuildFunding {
  inputs: CpfpInput[];
  secretKey: Uint8Array;
}

/** Passed on every quote: the sdk needs it only while unilateral steps are left, and ignores it otherwise. */
const P2WPKH: CpfpFundingKind = { type: 'p2wpkh' };

/** Every leaf a plan names. One from before `namedLeaves` names its exit's leaves and failures. */
export function namedLeavesOf(plan: UnilateralExitPlan): NamedLeaf[] {
  if (plan.namedLeaves) return plan.namedLeaves;
  const built = plan.exit.leaves.map(({ leafId, valueSats }) => ({ leafId, valueSats }));
  const seen = new Set(built.map(leaf => leaf.leafId));
  const failed = [...new Set(plan.exit.failed.map(f => f.leafId))].filter(id => !seen.has(id));
  return [...built, ...failed.map(leafId => ({ leafId, valueSats: 0 }))];
}

/**
 * Leaves the exit named that no build of it holds: one whose co-signing
 * failed, or one a rebuild skipped for now. Each stays part of the exit until
 * it lands, is found unrecoverable, or is let go at the deadline.
 */
export const leftoverIdsOf = (plan: UnilateralExitPlan): string[] => {
  const built = new Set(plan.exit.leaves.map(leaf => leaf.leafId));
  return namedLeavesOf(plan)
    .map(leaf => leaf.leafId)
    .filter(id => !built.has(id));
};

const leftoverValueSat = (plan: UnilateralExitPlan): number => {
  const leftovers = new Set(leftoverIdsOf(plan));
  return namedLeavesOf(plan).reduce((sum, leaf) => sum + (leftovers.has(leaf.leafId) ? leaf.valueSats : 0), 0);
};

/** Nothing of the build is in flight. True of a plan with no transactions, which has nothing to replace. */
export const isLanded = (exit: RecoverFundsResponse): boolean => exit.transactions.every(tx => tx.status.type === 'confirmed');

const outpointOf = (input: CpfpInput): string => `${input.txid}:${input.vout}`;

/** The funding an earlier build spent, with fresh coins beside it: the sdk follows a spent outpoint to what it became. */
export const mergeFunding = (stored: CpfpInput[], fresh: CpfpInput[]): CpfpInput[] => {
  const seen = new Set(stored.map(outpointOf));
  return [...stored, ...fresh.filter(input => !seen.has(outpointOf(input)))];
};

/** Skips that take a leaf out of the exit. Only an unrecoverable one is hidden as well. */
const LEAVES_EXIT_SKIPS = new Set(['notRecoverable', 'feeExceedsValue']);

/**
 * The leaves among `ids` that `quote` takes out of the exit, and the ones of
 * them to hide. A leaf too dear at the exit's rate stays on offer, for a
 * recovery at a lower one.
 */
function leavingSkips(quote: PrepareRecoverFundsResponse, ids?: string[]): { leaving: Set<string>; dropped: NamedLeaf[] } {
  const skips = quote.skipped.filter(leaf => LEAVES_EXIT_SKIPS.has(leaf.reason.type) && (!ids || ids.includes(leaf.leafId)));
  return {
    leaving: new Set(skips.map(leaf => leaf.leafId)),
    dropped: skips.flatMap(({ leafId, valueSats, reason }) => (reason.type === 'notRecoverable' ? [{ leafId, valueSats }] : [])),
  };
}

const withDropped = (dropped: NamedLeaf[] | undefined, added: NamedLeaf[]): NamedLeaf[] | undefined => {
  if (added.length === 0) return dropped;
  const ids = new Set(added.map(leaf => leaf.leafId));
  return [...(dropped ?? []).filter(leaf => !ids.has(leaf.leafId)), ...added];
};

/**
 * What `resuming` still names once `quote` has priced its leaves: a leaf it
 * lists nowhere has landed, and one it skips as unrecoverable or too dear has
 * left the exit.
 */
function stillNamed(resuming: UnilateralExitPlan, quote: PrepareRecoverFundsResponse): NamedLeaf[] {
  const { leaving } = leavingSkips(quote);
  const kept = quote.skipped.filter(leaf => !leaving.has(leaf.leafId));
  const priced = new Map([...kept, ...quote.leaves].map(leaf => [leaf.leafId, leaf.valueSats]));
  const named = namedLeavesOf(resuming).flatMap(leaf => {
    const valueSats = priced.get(leaf.leafId);
    return valueSats === undefined ? [] : [{ leafId: leaf.leafId, valueSats }];
  });
  const seen = new Set(named.map(leaf => leaf.leafId));
  return [...named, ...quote.leaves.filter(leaf => !seen.has(leaf.leafId)).map(({ leafId, valueSats }) => ({ leafId, valueSats }))];
}

/**
 * The output whose spender paid `leafId` out, read off the build being
 * replaced: a co-signed recovery's input, the sweep's input from the leaf's
 * refund, or the output of a leaf whose co-signing failed.
 */
function landingOutpoint(plan: UnilateralExitPlan, leafId: string): string | undefined {
  const { transactions, failed } = plan.exit;
  const cosigned = transactions.find(tx => isCooperative(tx) && tx.nodeId === leafId);
  const fromCosigned = cosigned && inputOutpoints(cosigned.txHex)[0];
  if (fromCosigned) return fromCosigned;
  const refund = transactions.find(tx => tx.kind === 'refund' && tx.nodeId === leafId);
  const sweep = transactions.find(tx => tx.kind === 'sweep');
  const fromSweep = refund && sweep && inputOutpoints(sweep.txHex).find(outpoint => outpoint.startsWith(`${refund.txid}:`));
  if (fromSweep) return fromSweep;
  const failure = failed.find(f => f.leafId === leafId);
  return failure && `${failure.outputTxid}:${failure.outputVout}`;
}

/**
 * The ledger with a waiting entry for each of `ids` that `quote` lists nowhere,
 * which means it landed; with no quote, each of them. Recorded now, because
 * the build about to be replaced is the last place its outpoint exists.
 */
export function withLanded(
  plan: UnilateralExitPlan,
  quote: PrepareRecoverFundsResponse | null,
  ids: string[] = namedLeavesOf(plan).map(leaf => leaf.leafId),
): Landing[] | undefined {
  const listed = new Set(quote ? [...quote.leaves, ...quote.skipped].map(leaf => leaf.leafId) : []);
  const covered = new Set((plan.landed ?? []).flatMap(entry => entry.leafIds));
  const values = new Map([...namedLeavesOf(plan), ...plan.exit.leaves].map(leaf => [leaf.leafId, leaf.valueSats]));
  const added = ids.flatMap(leafId => {
    if (listed.has(leafId) || covered.has(leafId)) return [];
    const outpoint = landingOutpoint(plan, leafId);
    return outpoint ? [{ leafIds: [leafId], valueSat: values.get(leafId) ?? 0, outpoint }] : [];
  });
  return added.length > 0 ? [...(plan.landed ?? []), ...added] : plan.landed;
}

/** Quotes exactly `leafIds`, whatever each costs to move. */
export function quoteLeaves(
  sdk: Pick<ExitSdk, 'prepareRecoverFunds'>,
  leafIds: string[],
  { feeRateSatPerVbyte, destination }: { feeRateSatPerVbyte: number; destination: string },
): Promise<PrepareRecoverFundsResponse> {
  // The sdk refuses a selection that names nothing.
  if (leafIds.length === 0) return Promise.reject(new Error('No leaves to recover'));
  return sdk.prepareRecoverFunds({
    feeRateSatPerVbyte,
    fundingKind: P2WPKH,
    destination,
    selection: { type: 'specific', leafIds },
  });
}

/**
 * Quotes the plan's own leaves again, by name: the dependable way to pick an
 * exit back up, a leaf waiting out its refund timelock included.
 */
export const quoteNamed = (
  sdk: Pick<ExitSdk, 'prepareRecoverFunds'>,
  plan: UnilateralExitPlan,
  { feeRateSatPerVbyte = plan.feeRateSatPerVbyte, destination = plan.destination } = {},
): Promise<PrepareRecoverFundsResponse> =>
  quoteLeaves(
    sdk,
    namedLeavesOf(plan).map(leaf => leaf.leafId),
    { feeRateSatPerVbyte, destination },
  );

/**
 * The leaves of a kept co-signed recovery that it is moving, refused or not.
 * Glow builds a stuck recovery again instead of letting its leaves go, so
 * their amount never also shows as Recoverable Funds.
 */
export function heldRecoveryLeaves(recovery: UnilateralExitPlan): RecoverFundsLeaf[] {
  if (recovery.phase === 'complete') return [];
  const held = new Set(recovery.exit.transactions.filter(isCooperative).map(tx => tx.nodeId));
  return recovery.exit.leaves.filter(leaf => held.has(leaf.leafId));
}

/** Leaves the kept co-signed recoveries are moving, which a new quote leaves to them. */
export const keptLeafIds = (recoveries: UnilateralExitPlan[]): Set<string> =>
  new Set(recoveries.flatMap(heldRecoveryLeaves).map(leaf => leaf.leafId));

/**
 * Whether a kept recovery can be built again at a higher fee. Once part of it
 * confirms, a bump rebuilds only the rest, and two records would claim the
 * leaves still open.
 */
export const canBumpRecovery = (recovery: UnilateralExitPlan): boolean =>
  recovery.phase === 'active' && !recovery.exit.transactions.some(tx => tx.status.type === 'confirmed');

/** `quote` with nothing left in it to build. */
const emptyQuote = (quote: PrepareRecoverFundsResponse): PrepareRecoverFundsResponse => ({
  ...quote,
  funding: undefined,
  leaves: [],
  recoverableValueSats: 0,
  totalFeeSats: 0,
  cooperativeFeeSats: 0,
  cpfpFeeSats: 0,
  fanoutFeeSats: 0,
  sweepFeeSats: 0,
});

const coversLeaves = (leaves: RecoverFundsLeaf[], ids: string[]): boolean => {
  const got = new Set(leaves.map(leaf => leaf.leafId));
  return ids.every(id => got.has(id));
};

/**
 * A quote of what the wallet holds now: everything for an exit, only what left
 * the balance for a recovery. Either selection also takes leaves a kept
 * recovery is already moving, and building those would compete with it, so
 * the rest is quoted again by name. Nothing left gives an empty quote.
 */
export async function quoteFresh(
  sdk: Pick<ExitSdk, 'prepareRecoverFunds'>,
  { feeRateSatPerVbyte, destination }: { feeRateSatPerVbyte: number; destination: string },
  mode: ExitMode | undefined,
  kept: Set<string>,
): Promise<PrepareRecoverFundsResponse> {
  const first = await sdk.prepareRecoverFunds({
    feeRateSatPerVbyte,
    fundingKind: P2WPKH,
    destination,
    selection: mode === 'recover' ? { type: 'recoverableOnly' } : { type: 'all' },
  });
  const skipped = first.skipped.filter(leaf => !kept.has(leaf.leafId));
  if (!first.leaves.some(leaf => kept.has(leaf.leafId))) return { ...first, skipped };

  // Only leaves the first quote kept: a named leaf is taken whatever it costs.
  const rest = first.leaves.filter(leaf => !kept.has(leaf.leafId)).map(leaf => leaf.leafId);
  if (rest.length === 0) return { ...emptyQuote(first), skipped };
  const second = await quoteLeaves(sdk, rest, { feeRateSatPerVbyte, destination });
  const own = new Set(second.skipped.map(leaf => leaf.leafId));
  return { ...second, skipped: [...second.skipped, ...skipped.filter(leaf => !own.has(leaf.leafId))] };
}

/**
 * A build that came back with no transactions: every co-signed leaf failed, or
 * landed meanwhile. Or a fee bump that left out a leaf it had to replace.
 * Shown as a retry; the failures go to the log.
 */
export class EmptyRecoveryError extends Error {
  readonly failed: CooperativeRecoveryFailure[];

  constructor(failed: CooperativeRecoveryFailure[]) {
    super('Please try again.');
    this.name = 'EmptyRecoveryError';
    this.failed = failed;
  }
}

/** A rebuild found nothing to build yet: the chain has not shown where a leaf's funds went. */
export class RebuildLaterError extends Error {
  constructor() {
    super('Nothing is left to rebuild. The exit updates on its next check.');
    this.name = 'RebuildLaterError';
  }
}

const describeFailure = ({ error }: CooperativeRecoveryFailure): string =>
  error.type === 'replacementFeeTooLow'
    ? `replacementFeeTooLow (needs ${error.requiredFeeRateSatPerVbyte} sat/vB)`
    : `${error.type}: ${error.message}`;

/**
 * The one build call, for every start and rebuild. A quote that needs funding
 * spends `funding` and signs for it; one that needs none takes no inputs and
 * no signer, whatever it is handed.
 */
export async function buildFromQuote(
  sdk: Pick<ExitSdk, 'recoverFunds'>,
  prepared: PrepareRecoverFundsResponse,
  funding: BuildFunding | null,
): Promise<RecoverFundsResponse> {
  let built: RecoverFundsResponse;
  if (!needsFunding(prepared) || !funding) {
    built = await sdk.recoverFunds({ prepared });
  } else {
    // Holds the key in wasm memory until freed.
    const signer = singleKeyCpfpSigner(funding.secretKey);
    try {
      built = await sdk.recoverFunds({ prepared, fundingInputs: funding.inputs }, signer);
    } finally {
      signer.free();
    }
  }
  if (built.failed.length > 0) {
    logger.warn(LogCategory.SDK, 'The operators did not co-sign every recovery', {
      failures: built.failed.map(describeFailure).join('; '),
    });
  }
  if (built.transactions.length === 0) throw new EmptyRecoveryError(built.failed);
  return built;
}

/** Coins at the exit fee address, as a build spends them. */
export const fundingInputsOf = (coins: { txid: string; vout: number; value: number }[], pubkey: string): CpfpInput[] =>
  coins.map(({ txid, vout, value }) => ({ type: 'p2wpkh', txid, vout, valueSats: value, pubkey }));

/** What a plan keeps besides the build: where the money goes, how it was funded, and what kind of record it is. */
export type BuildMeta = Pick<PlanMeta, 'network' | 'fundingAddressIndex' | 'mode'> & ExitFeeRecord;

/**
 * The plan a build of `quote` makes. A rebuild of `resuming` carries over the
 * leaves it names, its ledger, the leaves it dropped, adding those the quote
 * found unrecoverable, and its fee floor; a first build records which part of
 * it was already outside the balance. The retry clock carries too: a rebuild
 * hands back the same stuck recovery.
 */
export function planFromBuild(
  quote: PrepareRecoverFundsResponse,
  built: RecoverFundsResponse,
  resuming: UnilateralExitPlan | null,
  meta: BuildMeta,
): UnilateralExitPlan {
  const named = resuming ? namedLeavesOf(resuming).map(leaf => leaf.leafId) : [];
  return planFromExitResponse(built, {
    ...meta,
    destination: quote.destination,
    feeRateSatPerVbyte: quote.feeRateSatPerVbyte,
    quotedSweepFeeSat: builtSweepFeeSat(quote, built, resuming),
    namedLeaves: resuming
      ? stillNamed(resuming, quote)
      : quote.leaves.map(({ leafId, valueSats }) => ({ leafId, valueSats })),
    landed: resuming ? withLanded(resuming, quote) : undefined,
    droppedLeaves: resuming ? withDropped(resuming.droppedLeaves, leavingSkips(quote, named).dropped) : undefined,
    retrySince: resuming?.retrySince,
    retriedAt: resuming?.retriedAt,
    recoverableFundsSat: resuming ? resuming.recoverableFundsSat : cooperativeValueSat(built) || undefined,
  });
}

/**
 * Quotes a kept co-signed recovery's leaves again at `feeRateSatPerVbyte`, to
 * its own address. A partial replacement beside the original would list the
 * same leaves twice, so a quote that cannot co-sign every leaf comes back empty.
 */
export async function quoteRecoveryBump(
  sdk: Pick<ExitSdk, 'prepareRecoverFunds'>,
  recovery: UnilateralExitPlan,
  feeRateSatPerVbyte: number,
): Promise<PrepareRecoverFundsResponse> {
  const ids = recovery.exit.leaves.map(leaf => leaf.leafId);
  const quote = await quoteLeaves(sdk, ids, { feeRateSatPerVbyte, destination: recovery.destination });
  const whole = !needsFunding(quote) && quote.leaves.every(isCooperativeLeaf) && coversLeaves(quote.leaves, ids);
  return whole ? quote : emptyQuote(quote);
}

/**
 * Builds the bump, which replaces `recovery` once kept. Nothing is broadcast
 * yet, so a build that left out a leaf (a replacement fee too low, operators
 * unavailable, or a leaf that landed meanwhile) is dropped rather than kept.
 * What the recovery dropped and what landed elsewhere carry over.
 */
export async function buildRecoveryBump(
  sdk: Pick<ExitSdk, 'recoverFunds'>,
  recovery: UnilateralExitPlan,
  quote: PrepareRecoverFundsResponse,
): Promise<UnilateralExitPlan> {
  const built = await buildFromQuote(sdk, quote, null);
  if (!coversLeaves(built.leaves, recovery.exit.leaves.map(leaf => leaf.leafId))) throw new EmptyRecoveryError(built.failed);
  const { network, fundingAddressIndex, mode, landed, droppedLeaves } = recovery;
  return { ...planFromBuild(quote, built, null, { network, fundingAddressIndex, mode }), landed, droppedLeaves };
}

/**
 * Builds a pending exit from its confirmed fee coins, on the user's tap. It
 * quotes again first, so it exits what the wallet holds now: a payment or a
 * leaf swap since the first quote would fail a build that names the leaves
 * that quote picked. Leaves a kept co-signed recovery holds (`kept`) are left
 * to it.
 *
 * The key is read before anything else, while the tap is fresh enough for a
 * passkey prompt. `key` is one the wizard already derived.
 */
export async function startExit(
  pending: PendingExit,
  coins: ChainUtxo[],
  sdk: ExitSdk,
  identityPubkey: string,
  key?: FundingKey,
  kept: Set<string> = new Set(),
): Promise<StartOutcome> {
  const { network, destination, feeRateSatPerVbyte, fundingAddressIndex, mode } = pending;
  const { publicKeyHex, secretKey } =
    key ?? deriveFundingKey(await readWalletMnemonic({ interactive: true }), network, fundingAddressIndex);
  await restoreExitState(sdk, null, await loadExitState(identityPubkey).catch(() => null));

  const quote = await quoteFresh(sdk, { feeRateSatPerVbyte, destination }, mode, kept);
  if (!isWorthExiting(quote)) return { type: 'nothingToExit' };

  let exit: RecoverFundsResponse;
  try {
    exit = await buildFromQuote(sdk, quote, { inputs: fundingInputsOf(coins, publicKeyHex), secretKey });
  } catch (e) {
    const required = requiredFundingOf(e instanceof Error ? e.message : String(e));
    if (required === null) throw e;
    return { type: 'short', required: { sat: required, inputs: coins.length } };
  }

  // Frozen now: from here the operators stop reporting the leaves this exit moves.
  const exitStateSnapshot = await sdk
    .exportUnilateralExitState()
    .then(r => r.exitState)
    .catch(() => undefined);
  // The user paid the fee even if this quote no longer needs it. Glow then
  // builds without it and keeps the pending exit's record of where it went.
  const fee = builtExitFeeRecord(quote, { quotedExitFeeSat: pending.required.sat, exitFeeAddress: pending.fundingAddress });
  const plan = planFromBuild(quote, exit, null, { network, fundingAddressIndex, mode, ...fee });
  return { type: 'started', plan: { ...plan, exitStateSnapshot } };
}

export interface PlanProgress {
  confirmed: number;
  total: number;
  isComplete: boolean;
}

/**
 * `isComplete` follows the sdk's verdict: every transaction confirmed, co-signed
 * ones included. A transaction an earlier build landed counts as one of them,
 * and a leaf no build holds yet as one still to go.
 */
export function planProgress(plan: UnilateralExitPlan): PlanProgress {
  const { transactions } = plan.exit;
  const prior = paidOut(priorLandings(plan)).txids.length;
  const confirmed = transactions.filter(tx => tx.status.type === 'confirmed').length + prior;
  const total = transactions.length + prior + leftoverIdsOf(plan).length;
  return { confirmed, total, isComplete: plan.phase === 'complete' };
}

export interface NextAction {
  blocks: number;
  /** How many steps that wait releases. */
  transactions: number;
}

/**
 * The next timelock to mature, and what it frees. A step that is ready is
 * already being sent, so it is not something to wait for.
 */
export function nextAction(all: RecoveryTransaction[], tipHeight: number): NextAction | null {
  const waits = all.flatMap(tx =>
    tx.status.type === 'waitingForTimelock' && tx.status.spendableAtHeight !== undefined
      ? [Math.max(0, tx.status.spendableAtHeight - tipHeight)]
      : [],
  );
  if (waits.length === 0) return null;
  const blocks = Math.min(...waits);
  return { blocks, transactions: waits.filter(w => w === blocks).length };
}

const phaseOf = (verdict: RecoveryVerdict): ExitPhase => {
  switch (verdict.type) {
    case 'done':
      return 'complete';
    case 'redo':
      return 'redo';
    default:
      return 'active';
  }
};

/** Reads the exit back against the chain. Needs nothing but the stored response, so it works with the leaves gone from the operators' view. */
export async function checkExit(plan: UnilateralExitPlan, sdk: Pick<ExitSdk, 'checkRecoverFunds'>): Promise<UnilateralExitPlan> {
  const checked = await sdk.checkRecoverFunds({ recovery: plan.exit });
  return applyExitCheck(plan, checked.recovery, phaseOf(checked.verdict));
}

const RETRY_LATER_REASONS = new Set(['unverified', 'fundsNotFound']);

/**
 * Builds the exit again over whatever the chain now holds, naming its leaves
 * and keeping its destination, fee rate and funding. When the quote has no
 * leaves left, the plan comes back `complete`, its ledger naming what landed
 * since the build; a leaf whose funds the chain has not shown yet throws
 * `RebuildLaterError` instead.
 *
 * Glow reads the recovery phrase only when the rebuild has funding to sign
 * for, and quotes first to find out. From the tracker's button (`interactive`)
 * Glow reads it first instead, while the tap is fresh enough for a passkey
 * prompt. In the background Glow cannot prompt, so on a passkey wallet the
 * read fails and the tracker offers the rebuild as that button.
 */
export async function rebuildExit(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  identityPubkey: string,
  { interactive = false }: { interactive?: boolean } = {},
): Promise<UnilateralExitPlan> {
  const finish = (quote: PrepareRecoverFundsResponse | null): UnilateralExitPlan => {
    const { leaving, dropped } = quote ? leavingSkips(quote) : { leaving: new Set<string>(), dropped: [] };
    return {
      ...plan,
      landed: withLanded(plan, quote),
      namedLeaves: leaving.size > 0 ? namedLeavesOf(plan).filter(leaf => !leaving.has(leaf.leafId)) : plan.namedLeaves,
      droppedLeaves: withDropped(plan.droppedLeaves, dropped),
      phase: 'complete',
      needsRebuild: undefined,
    };
  };
  const named = new Set(namedLeavesOf(plan).map(leaf => leaf.leafId));
  if (named.size === 0) return finish(null);

  const readKey = async () =>
    deriveFundingKey(await readWalletMnemonic({ interactive }), plan.network, plan.fundingAddressIndex);
  const tapKey = interactive ? await readKey() : null;
  await restoreExitState(sdk, plan, await loadExitState(identityPubkey).catch(() => null));

  const prepared = await quoteNamed(sdk, plan);
  if (prepared.leaves.length === 0) {
    // A leaf left out as too dear or unrecoverable leaves the exit, so it
    // finishes. Only an unrecoverable one stays hidden; Recover Funds offers a
    // dear one once this exit is done.
    const waiting = prepared.skipped.some(leaf => named.has(leaf.leafId) && RETRY_LATER_REASONS.has(leaf.reason.type));
    if (waiting) throw new RebuildLaterError();
    return finish(prepared);
  }

  const key = needsFunding(prepared) ? (tapKey ?? (await readKey())) : null;
  let rebuilt: RecoverFundsResponse;
  try {
    rebuilt = await buildFromQuote(sdk, prepared, key && { inputs: plan.exit.fundingInputs, secretKey: key.secretKey });
  } catch (e) {
    // Everything it named landed between the quote and the build. What the
    // quote skipped did not.
    if (e instanceof EmptyRecoveryError && e.failed.length === 0) return finish({ ...prepared, leaves: [] });
    throw e;
  }

  // A leaf the watchtower moved comes back co-signed, and that fee comes off
  // what arrives too. The fee record carries over: at the same rate and with
  // the same funding, the user paid the fee address what they paid before.
  const { network, fundingAddressIndex, mode } = plan;
  const next = planFromBuild(prepared, rebuilt, plan, { network, fundingAddressIndex, mode, ...exitFeeRecordOf(plan) });
  return { ...next, exitStateSnapshot: plan.exitStateSnapshot };
}

/** Six blocks is the SDK's own re-check depth. */
const UNREAD_LANDING_BLOCKS = 6;

/**
 * Reads what paid each waiting entry out, one at a time to go easy on the
 * chain service's rate limit. An entry nothing spent in a block for six blocks
 * is dropped, so an exit never waits forever on an output it misjudged.
 */
export async function settleLanded(
  plan: UnilateralExitPlan,
  chain: ChainClient,
  tipHeight: number,
): Promise<UnilateralExitPlan> {
  if (!hasWaitingLanding(plan)) return plan;
  const destination = plan.destination.toLowerCase();
  const landed: Landing[] = [];
  for (const entry of plan.landed ?? []) {
    if (entry.txid) {
      landed.push(entry);
      continue;
    }
    // With nothing to read it by, an entry could only hold the exit up.
    const split = entry.outpoint?.lastIndexOf(':') ?? -1;
    if (!entry.outpoint || split < 0) continue;
    try {
      const spend = await chain.confirmedSpender(entry.outpoint.slice(0, split), Number(entry.outpoint.slice(split + 1)));
      if (spend) {
        const paidSat = spend.outputs
          .filter(output => output.address?.toLowerCase() === destination)
          .reduce((sum, output) => sum + output.value, 0);
        landed.push({ ...entry, txid: spend.txid, blockHeight: spend.blockHeight, paidSat, unreadSince: undefined });
        continue;
      }
      const unreadSince = entry.unreadSince ?? tipHeight;
      if (tipHeight - unreadSince < UNREAD_LANDING_BLOCKS) landed.push({ ...entry, unreadSince });
      else logger.warn(LogCategory.SDK, 'Gave up on reading what spent an exit output');
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Failed to read what spent an exit output', {
        error: e instanceof Error ? e.message : String(e),
      });
      landed.push(entry);
    }
  }
  return { ...plan, landed };
}

/**
 * Sends every step whose turn has come, again on every pass: a node already
 * holding one answers as if it were sent, and one the mempool has since dropped
 * is put back. A refusal is kept on the step and retried, since the operators'
 * watchtower may settle it with its own copy.
 */
export async function broadcastReadyTransactions(
  plan: UnilateralExitPlan,
  chain: ChainClient,
): Promise<UnilateralExitPlan> {
  const refusals = { ...plan.refusals };
  for (const tx of plan.exit.transactions.filter(isSendable)) {
    try {
      if (tx.cpfpTxHex) await chain.broadcastPackage(tx.txHex, tx.cpfpTxHex);
      else await chain.broadcast(tx.txHex);
      delete refusals[tx.txid];
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      logger.warn(LogCategory.SDK, `Failed to broadcast recovery transaction ${tx.txid}: ${reason}`);
      refusals[tx.txid] = reason;
    }
  }
  return { ...plan, refusals };
}

/**
 * Builds an exit again over a step the SDK could not read, which is how the
 * guide settles one: a fresh build reads the chain again. Same rate and
 * funding as a Redo rebuild.
 */
async function rebuildUnverified(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  identityPubkey: string,
  tipHeight: number,
): Promise<UnilateralExitPlan> {
  try {
    return { ...(await rebuildExit(plan, sdk, identityPubkey)), unverifiedRebuiltAt: tipHeight };
  } catch (e) {
    // Only the tap settles the step, but the exit stays active: pausing it
    // would leave the other leaves' steps unsent until the operators' copy
    // takes its fee from the funds.
    if (e instanceof MnemonicNeedsPasskeyError) {
      return { ...plan, needsSignIn: true, redoCause: 'unverified', unverifiedRebuiltAt: tipHeight };
    }
    if (!(e instanceof RebuildLaterError)) {
      logger.warn(LogCategory.SDK, `Failed to rebuild over an unverified step: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { ...plan, unverifiedRebuiltAt: tipHeight };
  }
}

/** What a co-signed recovery takes off its leaf, read off what it pays. */
const cosignedCostSat = (valueSats: number, tx: RecoveryTransaction): number =>
  valueSats - (outputTotalSat(tx.txHex) ?? valueSats);

/**
 * `plan` with each co-signed recovery of `built` in place of its leaf's
 * unconfirmed one, or added, and each leaf in `gone` taken out with its
 * unconfirmed recovery. `checkRecoverFunds` reads each co-signed recovery on
 * its own, so a plan holding two builds' recoveries checks as one.
 */
function withCosigned(
  plan: UnilateralExitPlan,
  built: RecoverFundsResponse | null,
  gone: Set<string>,
  dropped: NamedLeaf[],
): UnilateralExitPlan {
  const { exit } = plan;
  const values = new Map([...exit.leaves, ...(built?.leaves ?? [])].map(leaf => [leaf.leafId, leaf.valueSats]));
  const costOf = (tx: RecoveryTransaction) => {
    const valueSats = tx.nodeId ? values.get(tx.nodeId) : undefined;
    return valueSats === undefined ? 0 : cosignedCostSat(valueSats, tx);
  };
  const fresh = new Map(
    (built?.transactions ?? []).flatMap(tx => (isCooperative(tx) && tx.nodeId && !gone.has(tx.nodeId) ? [[tx.nodeId, tx] as const] : [])),
  );

  let costSat = 0;
  const swapped = new Set<string>();
  const transactions = exit.transactions.flatMap(tx => {
    if (!isCooperative(tx) || tx.status.type === 'confirmed' || !tx.nodeId) return [tx];
    if (gone.has(tx.nodeId)) {
      costSat -= costOf(tx);
      return [];
    }
    const next = fresh.get(tx.nodeId);
    if (!next) return [tx];
    swapped.add(tx.nodeId);
    if (next.txid === tx.txid) return [tx];
    costSat += costOf(next) - costOf(tx);
    return [next];
  });
  for (const [leafId, tx] of fresh) {
    if (swapped.has(leafId)) continue;
    costSat += costOf(tx);
    transactions.push(tx);
  }

  const held = new Set(exit.leaves.map(leaf => leaf.leafId));
  const added = (built?.leaves ?? []).filter(leaf => fresh.has(leaf.leafId) && !held.has(leaf.leafId));
  const removed = exit.leaves.filter(leaf => gone.has(leaf.leafId));
  const sum = (leaves: RecoverFundsLeaf[]) => leaves.reduce((total, leaf) => total + leaf.valueSats, 0);
  return {
    ...plan,
    quotedSweepFeeSat: Math.max(0, plan.quotedSweepFeeSat + costSat),
    namedLeaves: plan.namedLeaves?.filter(leaf => !gone.has(leaf.leafId)),
    droppedLeaves: withDropped(plan.droppedLeaves, dropped),
    exit: {
      ...exit,
      transactions,
      leaves: [...exit.leaves.filter(leaf => !gone.has(leaf.leafId)), ...added],
      failed: exit.failed.filter(failure => !gone.has(failure.leafId) && !fresh.has(failure.leafId)),
      recoverableValueSats: exit.recoverableValueSats + sum(added) - sum(removed),
    },
  };
}

/** Finished once nothing is built and nothing the exit named is still to come. */
const completeIfEmpty = (plan: UnilateralExitPlan): UnilateralExitPlan =>
  plan.exit.transactions.length > 0 || leftoverIdsOf(plan).length > 0 ? plan : { ...plan, phase: 'complete' };

/** A co-signed build the operators refused entirely changes nothing: what was stuck stays. */
const buildCosigned = (sdk: ExitSdk, quote: PrepareRecoverFundsResponse): Promise<RecoverFundsResponse | null> =>
  buildFromQuote(sdk, quote, null).catch(e => {
    if (e instanceof EmptyRecoveryError) return null;
    throw e;
  });

const askTopUp = (plan: UnilateralExitPlan, quote: PrepareRecoverFundsResponse): ExitTopUp => ({
  required: { sat: exitFeeSat(quote), inputs: 1 },
  // With no fee address yet, only the key can say where to pay.
  needsSignIn: exitFeeRecordOf(plan).exitFeeAddress ? undefined : true,
});

/**
 * Builds `quote` as the next part of an exit that has landed, in place of the
 * build before it, whose ledger keeps what that one paid out. Its sweep fee is
 * no floor for this part's, which pays its own.
 */
async function buildNextPart(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  quote: PrepareRecoverFundsResponse,
  funding: BuildFunding | null,
  fee: ExitFeeRecord,
): Promise<UnilateralExitPlan> {
  const built = await buildFromQuote(sdk, quote, funding);
  const { network, fundingAddressIndex, mode } = plan;
  const next = planFromBuild(quote, built, { ...plan, quotedSweepFeeSat: 0 }, { network, fundingAddressIndex, mode, ...fee });
  return { ...next, exitStateSnapshot: plan.exitStateSnapshot };
}

/**
 * Applies a quote of the leaves Glow prepares again by itself. Co-signed ones
 * are built at once and merged into the plan. In the plan slot a unilateral
 * one waits for the rest of the exit to land: it is then built as the exit's
 * next part when it needs no funding, and asks for more exit fee when it does.
 */
async function applyRetryQuote(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  quote: PrepareRecoverFundsResponse,
  targets: string[],
  inSlot: boolean,
): Promise<UnilateralExitPlan> {
  const listed = new Set([...quote.leaves, ...quote.skipped].map(leaf => leaf.leafId));
  const landedIds = targets.filter(id => !listed.has(id));
  const { leaving, dropped } = leavingSkips(quote, targets);
  const gone = new Set([...landedIds, ...leaving]);
  const unilateral = quote.leaves.some(leaf => !isCooperativeLeaf(leaf));
  const landed = isLanded(plan.exit);
  if (inSlot && unilateral && landed && !needsFunding(quote)) return buildNextPart(plan, sdk, quote, null, exitFeeRecordOf(plan));

  // On their own, so none waits on a unilateral leaf's fee (guide: recovering without funding).
  const cosigned = quote.leaves.filter(isCooperativeLeaf).map(leaf => leaf.leafId);
  const cosignedQuote = cosigned.length === 0 ? null : unilateral ? await quoteLeaves(sdk, cosigned, plan) : quote;
  const built = cosignedQuote && cosignedQuote.leaves.length > 0 ? await buildCosigned(sdk, cosignedQuote) : null;
  const asksFee = inSlot && unilateral && needsFunding(quote) && (landed || !!plan.topUp);
  const topUp = asksFee ? (plan.topUp ?? askTopUp(plan, quote)) : undefined;
  return completeIfEmpty(withCosigned({ ...plan, landed: withLanded(plan, quote, landedIds), topUp }, built, gone, dropped));
}

/**
 * Prepares again by name, at the plan's own rate and destination, the
 * co-signed recoveries stuck unverified and, in the plan slot, the leaves the
 * exit left out. At that rate the SDK hands back a recovery it kept, so a new
 * one means the funds turned up in another output. Needs no key, so it runs in
 * the background on any wallet, kept recoveries included.
 */
async function retryCosigned(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  tipHeight: number,
  identityPubkey?: string,
): Promise<UnilateralExitPlan> {
  const paced = { ...plan, retriedAt: tipHeight };
  const targets = retryTargetsOf(plan, !!identityPubkey);
  try {
    // A leftover can be unilateral, which is quoted from the frozen leaf data.
    if (identityPubkey) await restoreExitState(sdk, plan, await loadExitState(identityPubkey).catch(() => null));
    return await applyRetryQuote(paced, sdk, await quoteLeaves(sdk, targets, plan), targets, !!identityPubkey);
  } catch (e) {
    // An empty build means the operators did not co-sign: what was stuck stays.
    if (!(e instanceof EmptyRecoveryError)) {
      logger.warn(LogCategory.SDK, `Failed to build a stuck co-signed recovery again: ${e instanceof Error ? e.message : String(e)}`);
    }
    return paced;
  }
}

/**
 * Builds the leaves a landed exit left out, from the confirmed `coins` at its
 * fee address, as the exit's next part. From the fee screen's button
 * (`interactive`) the key is read first, while the tap is fresh enough for a
 * passkey prompt. In the background a passkey wallet waits for that tap.
 */
export async function buildLeftover(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  identityPubkey: string,
  coins: ChainUtxo[],
  { interactive = false }: { interactive?: boolean } = {},
): Promise<UnilateralExitPlan> {
  // Built over what is in flight, it would replace a transaction Glow follows.
  if (!isLanded(plan.exit)) throw new RebuildLaterError();
  const readKey = async () =>
    deriveFundingKey(await readWalletMnemonic({ interactive }), plan.network, plan.fundingAddressIndex);
  const tapKey = interactive ? await readKey() : null;
  await restoreExitState(sdk, plan, await loadExitState(identityPubkey).catch(() => null));

  const targets = leftoverIdsOf(plan);
  const quote = await quoteLeaves(sdk, targets, plan);
  if (!needsFunding(quote)) return applyRetryQuote({ ...plan, topUp: undefined }, sdk, quote, targets, true);

  let key: FundingKey;
  try {
    key = tapKey ?? (await readKey());
  } catch (e) {
    if (interactive || !(e instanceof MnemonicNeedsPasskeyError)) throw e;
    return { ...plan, topUp: { ...(plan.topUp ?? askTopUp(plan, quote)), needsSignIn: true } };
  }
  const { quotedExitFeeSat, exitFeeAddress } = exitFeeRecordOf(plan);
  const address = exitFeeAddress ?? key.address;
  const required = plan.topUp?.required ?? { sat: exitFeeSat(quote), inputs: 1 };
  const funding = {
    inputs: mergeFunding(plan.exit.fundingInputs, fundingInputsOf(coins, key.publicKeyHex)),
    secretKey: key.secretKey,
  };
  try {
    // The fee paid grows by what was sent for this part, not what the address already held.
    return await buildNextPart(plan, sdk, quote, funding, {
      quotedExitFeeSat: (quotedExitFeeSat ?? 0) + Math.max(0, required.sat - (plan.topUp?.heldSat ?? 0)),
      exitFeeAddress: address,
    });
  } catch (e) {
    const sat = requiredFundingOf(e instanceof Error ? e.message : String(e));
    if (sat === null) throw e;
    return { ...plan, exitFeeAddress: address, topUp: { required: { sat, inputs: coins.length }, heldSat: plan.topUp?.heldSat } };
  }
}

/** Whether a leftover's fee has confirmed, so its build can go ahead. Once a block: a confirmation comes with one. */
const leftoverFunded = (plan: UnilateralExitPlan, confirmed: ChainUtxo[], tipHeight: number): boolean =>
  !!plan.topUp &&
  !plan.topUp.needsSignIn &&
  plan.retriedAt !== tipHeight &&
  isLanded(plan.exit) &&
  leftoverTopUp(plan, confirmed).stillToSendSat === 0;

async function buildFundedLeftover(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  identityPubkey: string,
  confirmed: ChainUtxo[],
  tipHeight: number,
): Promise<UnilateralExitPlan> {
  const paced = { ...plan, retriedAt: tipHeight };
  try {
    return await buildLeftover(paced, sdk, identityPubkey, confirmed);
  } catch (e) {
    if (!(e instanceof EmptyRecoveryError)) {
      logger.warn(LogCategory.SDK, `Failed to build what the exit left out: ${e instanceof Error ? e.message : String(e)}`);
    }
    return paced;
  }
}

/** Lets go of what is still stuck at the deadline, leftovers included. Not dropped, so it shows as Recoverable Funds again. */
const releaseStuck = (plan: UnilateralExitPlan, withLeftovers: boolean): UnilateralExitPlan =>
  completeIfEmpty({
    ...withCosigned(plan, null, new Set(retryTargetsOf(plan, withLeftovers)), []),
    retrySince: undefined,
    retriedAt: undefined,
    topUp: undefined,
  });

/**
 * Builds a converted 0.26 exit again with this SDK. Best effort: until it
 * works, the converted set keeps running as it is, and one with nothing left
 * to build simply finishes that way.
 */
async function rebuildConverted(plan: UnilateralExitPlan, sdk: ExitSdk, identityPubkey: string): Promise<UnilateralExitPlan> {
  try {
    const rebuilt = await rebuildExit(plan, sdk, identityPubkey);
    return rebuilt.phase === 'complete' ? { ...plan, needsRebuild: undefined, landed: rebuilt.landed } : rebuilt;
  } catch (e) {
    // The set runs as it is, except a step it could not read, which only the
    // tap's rebuild settles.
    if (e instanceof MnemonicNeedsPasskeyError) {
      return { ...plan, needsSignIn: true, redoCause: hasUnverifiedStep(plan) ? 'unverified' : undefined };
    }
    if (!(e instanceof RebuildLaterError)) {
      logger.warn(LogCategory.SDK, `Failed to rebuild the converted exit: ${e instanceof Error ? e.message : String(e)}`);
    }
    return plan;
  }
}

/**
 * One pass over an exit. `identityPubkey` marks the plan slot, the one place a
 * leaf the exit left out stays part of it. `feeCoins` are what its fee
 * address holds while a leftover waits on more exit fee.
 */
export async function advanceUnilateralExit(
  plan: UnilateralExitPlan,
  chain: ChainClient,
  sdk?: ExitSdk,
  identityPubkey?: string,
  feeCoins?: ChainUtxo[],
): Promise<{ plan: UnilateralExitPlan; tipHeight: number }> {
  const tipHeight = await chain.tipHeight();
  // Finished, whatever a check would now say: it only waits for its ledger to
  // be read, and then to be archived.
  if (plan.phase === 'complete') return { plan: await settleLanded(recordLanded(plan), chain, tipHeight), tipHeight };

  const inSlot = !!identityPubkey;
  let next = plan;
  let checked = false;
  let doneSet = false;
  if (sdk) {
    try {
      // With nothing built there is nothing to read back, only leftovers to try.
      const unbuilt = inSlot && next.exit.transactions.length === 0 && leftoverIdsOf(next).length > 0;
      next = unbuilt ? next : await checkExit(next, sdk);
      if (inSlot && next.phase === 'complete' && leftoverIdsOf(next).length > 0) {
        // The Done verdict covers only the set, so a leaf it left out is still
        // part of the exit. On the pass the set lands, the clock starts over
        // and the leftovers are tried at once.
        doneSet = true;
        next = { ...next, phase: 'active', ...(isLanded(plan.exit) ? {} : { retrySince: tipHeight, retriedAt: undefined }) };
      }
      next = paceRetry(next, tipHeight, inSlot);
      checked = true;
    } catch (e) {
      // Not shown: the next pass tries again, and the log keeps the reason.
      const error = e instanceof Error ? e.message : String(e);
      logger.warn(LogCategory.SDK, `Failed to read the exit back from the sdk: ${error}`);
    }
  }
  const checkedExit = next.exit;

  if (next.phase === 'redo' && sdk && identityPubkey) {
    // The chain diverging is routine: the operators' watchtower publishes its
    // own copy of a refund. The exit is rebuilt over what is now on-chain.
    try {
      next = await rebuildExit(next, sdk, identityPubkey);
    } catch (e) {
      if (e instanceof MnemonicNeedsPasskeyError) {
        // Waiting on the user to sign in is the designed path, not a fault: the
        // exit stays in `redo` and the tracker offers the rebuild as a button.
        next = { ...next, needsSignIn: true };
      } else {
        // Waiting on the chain is not a failure: the next pass tries again, so
        // only another error asks for the tap.
        const failed = !(e instanceof RebuildLaterError);
        if (failed) {
          const error = e instanceof Error ? e.message : String(e);
          logger.warn(LogCategory.SDK, `Failed to rebuild the exit: ${error}`);
        }
        next = { ...next, rebuildFailed: failed ? true : undefined };
      }
    }
  } else if (
    checked &&
    sdk &&
    identityPubkey &&
    !next.needsSignIn &&
    next.phase === 'active' &&
    // A rebuild now would conflict with what is in the mempool at the same fee.
    // A co-signed recovery does not: at that rate the SDK hands back the one it
    // kept.
    !next.exit.transactions.some(tx => isSendable(tx) && !isCooperative(tx))
  ) {
    if (next.needsRebuild) next = await rebuildConverted(next, sdk, identityPubkey);
    else if (hasUnverifiedStep(next) && next.unverifiedRebuiltAt !== tipHeight) {
      next = await rebuildUnverified(next, sdk, identityPubkey, tipHeight);
    }
  }

  const confirmedFee = (feeCoins ?? []).filter(coin => coin.confirmed);
  if (next.topUp && feeCoins && next.topUp.heldSat === undefined) {
    next = { ...next, topUp: { ...next.topUp, heldSat: confirmedFee.reduce((sum, coin) => sum + coin.value, 0) } };
  }

  // Skipped in a pass that rebuilt, which already prepared every leaf again.
  if (checked && sdk && next.phase === 'active' && next.exit === checkedExit) {
    const retryNow = doneSet && next.retriedAt === undefined;
    if (identityPubkey && feeCoins && leftoverFunded(next, confirmedFee, tipHeight)) {
      next = await buildFundedLeftover(next, sdk, identityPubkey, confirmedFee, tipHeight);
    } else if (releaseDue(next, tipHeight)) next = releaseStuck(next, inSlot);
    else if (retryNow || retryDue(next, tipHeight)) next = await retryCosigned(next, sdk, tipHeight, identityPubkey);
  }
  // What the Done verdict waited on is settled, so the exit is finished.
  if (doneSet && next.phase === 'active' && isLanded(next.exit) && leftoverIdsOf(next).length === 0) {
    next = { ...next, phase: 'complete' };
  }

  // Sent before the reads, so a failing chain service never holds a step back.
  const sent = next.phase === 'active' ? await broadcastReadyTransactions(next, chain) : next;
  return { plan: await settleLanded(sent, chain, tipHeight), tipHeight };
}
