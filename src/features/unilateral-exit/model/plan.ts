import type { RecoverFundsLeaf, RecoverFundsResponse } from '@breeztech/breez-sdk-spark';
import { isCooperative, unbuiltLeaves } from '../quote';

/** A leaf an exit set out to move, at the value it was quoted. */
export interface NamedLeaf {
  leafId: string;
  valueSats: number;
  /**
   * What the quote that last priced the leaf takes off its value. Absent on a
   * plan from before this was kept, which counts the whole value.
   */
  feeSat?: number;
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
  version: 6;
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
  /**
   * Leaves outside the balance before the exit began: the first quote's
   * co-signed ones, whether or not the operators co-signed them at once, and
   * those of a recovery the exit took in.
   */
  recoverableLeafIds?: string[];
  /**
   * What a plan from before `recoverableLeafIds` kept instead: the co-signed
   * part of its first build. Carried over, never written fresh.
   */
  recoverableFundsSat?: number;
  /**
   * Why the network last refused each transaction, by txid, for diagnostics. The
   * tracker shows none: Glow retries a refusal on every check. Cleared once the
   * transaction is accepted or confirms.
   */
  refusals: Record<string, string>;
  status: ExitStatus;
  /** Frozen when the exit was built: the operators stop reporting the leaves it moves. */
  exitStateSnapshot?: string;
  mode?: ExitMode;
  /**
   * The tip of the first background rebuild of a diverged exit to fail in a
   * row, for a reason other than waiting on the chain. Failures across a block
   * ask for the update tap; one passing outage within a block asks nothing.
   */
  rebuildFailingSince?: number;
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
}

/** Where the exit stands. */
export type ExitStatus =
  /**
   * Glow sends each step as its turn comes. `converted`: stored under SDK
   * 0.26, and built again with this SDK once nothing of it is in flight.
   */
  | { type: 'running'; converted?: true }
  /** The chain no longer matches the build (the SDK's Redo), so Glow builds it again on every pass. */
  | { type: 'rebuilding' }
  /**
   * Waits on the update tap: a diverged exit whose rebuild needs the passkey
   * (`signIn`) or failed across a block (`rebuildFailed`). With `cause` it has
   * not diverged: a step the SDK could not read needs a rebuild only the
   * passkey can sign, and the rest keeps running meanwhile.
   */
  | { type: 'needsUpdate'; why: 'signIn' | 'rebuildFailed'; cause?: 'unverified' }
  /** A unilateral leaf the exit left out waits on more exit fee. Plan slot only. */
  | { type: 'needsExitFee'; topUp: ExitTopUp }
  /** The SDK's Done verdict, or nothing left to move: it waits only for its ledger to be read, then the archive. */
  | { type: 'done' };

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
 * started an exit. `exit`, or absent, is a unilateral exit the user started.
 */
export type ExitMode = 'recover' | 'exit';

export const PLAN_VERSION = 6;

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
  recoverableLeafIds?: string[];
  recoverableFundsSat?: number;
  mode?: ExitMode;
}

export interface Funding {
  sat: number;
  inputs: number;
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

export function planFromExitResponse(exit: RecoverFundsResponse, meta: PlanMeta): UnilateralExitPlan {
  return { version: PLAN_VERSION, ...meta, exit, refusals: {}, status: { type: 'running' } };
}

/** A unilateral step the SDK could not read while building: never sent, and a check never settles it. */
export const hasUnverifiedStep = ({ exit }: Pick<UnilateralExitPlan, 'exit'>): boolean =>
  exit.transactions.some(tx => tx.status.type === 'unverified' && !isCooperative(tx));

export const awaitsUpdate = ({ status }: Pick<UnilateralExitPlan, 'status'>): boolean => status.type === 'needsUpdate';

/** The chain no longer matches the build, so it is built again before anything more is sent. */
export const isDiverged = ({ status }: Pick<UnilateralExitPlan, 'status'>): boolean =>
  status.type === 'rebuilding' || (status.type === 'needsUpdate' && !status.cause);

/** Neither finished nor diverged: each step goes out as its turn comes. */
export const isActive = (plan: Pick<UnilateralExitPlan, 'status'>): boolean =>
  plan.status.type !== 'done' && !isDiverged(plan);

/** What a leftover waiting on more exit fee asks for. */
export const topUpOf = ({ status }: Pick<UnilateralExitPlan, 'status'>): ExitTopUp | undefined =>
  status.type === 'needsExitFee' ? status.topUp : undefined;

/** Every leaf a plan names. One from before `namedLeaves` names its exit's leaves and failures. */
export function namedLeavesOf(plan: UnilateralExitPlan): NamedLeaf[] {
  if (plan.namedLeaves) return plan.namedLeaves;
  const built = plan.exit.leaves.map(({ leafId, valueSats }) => ({ leafId, valueSats }));
  const seen = new Set(built.map(leaf => leaf.leafId));
  const failed = [...new Set(plan.exit.failed.map(f => f.leafId))].filter(id => !seen.has(id));
  return [...built, ...failed.map(leafId => ({ leafId, valueSats: 0 }))];
}

/**
 * Leaves the exit named that no build of it holds and its ledger does not
 * record as landed: one whose co-signing failed, or one a rebuild skipped for
 * now. Each stays part of the exit until it lands, is found unrecoverable, or
 * is let go at the deadline.
 */
export const leftoverIdsOf = (plan: UnilateralExitPlan): string[] =>
  unbuiltLeaves(plan, namedLeavesOf(plan)).map(leaf => leaf.leafId);

/** Nothing of the build is in flight. True of a plan with no transactions, which has nothing to replace. */
export const isLanded = (exit: RecoverFundsResponse): boolean => exit.transactions.every(tx => tx.status.type === 'confirmed');

/** No unilateral step is in flight: only co-signed recoveries can be, which a build of the next part hands back. */
export const isUnilateralLanded = (exit: RecoverFundsResponse): boolean =>
  exit.transactions.every(tx => isCooperative(tx) || tx.status.type === 'confirmed');

/**
 * A kept recovery names only the leaves it built: one whose co-signing failed
 * is left to the Recoverable Funds row, so a kept recovery has no leftovers.
 */
export const asKeptRecovery = (recovery: UnilateralExitPlan): UnilateralExitPlan => ({
  ...recovery,
  namedLeaves: recovery.exit.leaves.map(({ leafId, valueSats }) => ({ leafId, valueSats })),
});

/**
 * The leaves of a kept co-signed recovery that it is moving, refused or not.
 * Glow builds a stuck recovery again instead of letting its leaves go, so
 * their amount never also shows as Recoverable Funds.
 */
export function heldRecoveryLeaves(recovery: UnilateralExitPlan): RecoverFundsLeaf[] {
  if (recovery.status.type === 'done') return [];
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
  recovery.status.type === 'running' && !recovery.exit.transactions.some(tx => tx.status.type === 'confirmed');
