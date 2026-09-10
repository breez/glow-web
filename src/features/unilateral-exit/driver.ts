import { singleKeyCpfpSigner } from '@breeztech/breez-sdk-spark';
import type {
  BreezSdk,
  CheckUnilateralExitResponse,
  InputType,
  PrepareUnilateralExitResponse,
  UnilateralExitResponse,
  UnilateralExitTransaction,
} from '@breeztech/breez-sdk-spark';
import type { ChainClient } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { outputTotalSat } from '@/utils/rawTx';
import { loadExitState, restoreExitState, saveExitState } from './exitState';
import { deriveFundingKey, MnemonicNeedsPasskeyError, readWalletMnemonic } from './funding';

/**
 * `complete` is the sdk's `done` verdict. `redo` is its `redo`: the chain no
 * longer matches these transactions, so the exit has to be built again.
 */
export type ExitPhase = 'active' | 'complete' | 'redo';

export interface UnilateralExitPlan {
  version: 4;
  network: string;
  destination: string;
  feeRateSatPerVbyte: number;
  fundingAddressIndex: number;
  /**
   * The sweep fee the exit was quoted at: the one fee that comes off the
   * balance, so the figure shown is the balance less this. The fees the
   * funding pays do not reduce what arrives.
   */
  quotedSweepFeeSat: number;
  /** The sdk's latest word on the exit, handed back to `checkUnilateralExit` unchanged. */
  exit: UnilateralExitResponse;
  /**
   * Why the network last refused each transaction, by txid, for diagnostics. The
   * tracker shows none: Glow retries a refusal on every check. Cleared once the
   * transaction is accepted or confirms.
   */
  refusals: Record<string, string>;
  phase: ExitPhase;
  /** Frozen when the exit was built: the operators stop reporting the leaves it moves. */
  exitStateSnapshot?: string;
}

const PLAN_VERSION = 4;

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
}

const storageKey = ({ identityPubkey, network }: WalletKey): string =>
  `recovery-plan:${identityPubkey.slice(0, 16)}:${network}`;

export function planFromExitResponse(exit: UnilateralExitResponse, meta: PlanMeta): UnilateralExitPlan {
  return { version: PLAN_VERSION, ...meta, exit, refusals: {}, phase: 'active' };
}

/** Folds a check onto the plan. The sdk owns the exit and the phase; glow keeps only what the network told it about its own sends. */
export function applyExitCheck(
  plan: UnilateralExitPlan,
  checked: UnilateralExitResponse,
  phase: ExitPhase,
): UnilateralExitPlan {
  const open = new Set(
    checked.transactions.filter(tx => tx.status.type !== 'confirmed').map(tx => tx.txid),
  );
  const refusals = Object.fromEntries(
    Object.entries(plan.refusals).filter(([txid]) => open.has(txid)),
  );
  return { ...plan, exit: checked, refusals, phase };
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

export function loadPlan(wallet: WalletKey): UnilateralExitPlan | null {
  const raw = localStorage.getItem(storageKey(wallet));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as UnilateralExitPlan;
    if (!Array.isArray(parsed?.exit?.transactions)) return null;
    return parsed.version === PLAN_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPlan(wallet: WalletKey): void {
  localStorage.removeItem(storageKey(wallet));
}

/**
 * The sweep fee an exit is held to. A rebuild is quoted on the refunds it has
 * left to sweep, so an earlier quote stays the floor; a quote at a higher rate
 * replaces it.
 */
export function quotedSweepFeeSat(
  quote: PrepareUnilateralExitResponse,
  resuming: UnilateralExitPlan | null,
): number {
  return Math.max(quote.sweepFeeSat, resuming?.quotedSweepFeeSat ?? 0);
}

/**
 * What the destination address ends up with: the balance less the sweep's fee,
 * until the sweep confirms and the figure is read off the sweep itself.
 *
 * The funding is not counted. It pays the other fees, and what it has left
 * comes back only if the sweep glow built is the one that lands.
 */
export function willReceiveSat(
  exit: PrepareUnilateralExitResponse | UnilateralExitPlan,
  resuming: UnilateralExitPlan | null = null,
): number {
  if (!('exit' in exit)) {
    return Math.max(0, exit.recoverableValueSat - quotedSweepFeeSat(exit, resuming));
  }
  const sweep = exit.exit.transactions.find(tx => tx.kind === 'sweep');
  const swept = sweep?.status.type === 'confirmed' ? outputTotalSat(sweep.txHex) : null;
  return swept ?? Math.max(0, exit.exit.recoverableValueSat - exit.quotedSweepFeeSat);
}

/**
 * Where the money is. A leaf sits in Spark until its refund is on-chain, then
 * in an output only the owner can spend, and reaches the destination when the
 * sweep confirms.
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
  if (transactions.find(tx => tx.kind === 'sweep')?.status.type === 'confirmed') {
    return { inSpark: 0, onChain: 0, delivered: willReceive, willReceive };
  }

  const refunded = new Set(
    transactions.filter(tx => tx.kind === 'refund' && tx.status.type === 'confirmed').map(tx => tx.nodeId),
  );
  const total = leaves.reduce((sum, leaf) => sum + leaf.value, 0);
  const onChain = leaves.filter(leaf => refunded.has(leaf.leafId)).reduce((sum, leaf) => sum + leaf.value, 0);
  return { inSpark: total - onChain, onChain, delivered: 0, willReceive };
}

/**
 * Blocks until the last step could confirm: the longest path left through the
 * set, each step costing its remaining timelock plus a block to confirm in.
 * Null once nothing is left to send. Relies on the sdk returning the set in
 * broadcast order, so a dependency is always reached before what depends on it.
 */
export function blocksToFinish(all: UnilateralExitTransaction[], tipHeight: number): number | null {
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
  'checkUnilateralExit' | 'prepareUnilateralExit' | 'unilateralExit' | 'importUnilateralExitState'
>;

/** The sdk resolves this against the chain tip, timelock included. */
export const isReady = (tx: UnilateralExitTransaction): boolean => tx.status.type === 'ready';

/**
 * Whether each branch is down to the fee coin the fan-out gave it. From then on
 * a rebuild cannot draw on the exit fee address, so more there cannot pay a
 * higher fee.
 */
export const hasFixedFeeBudget = (plan: UnilateralExitPlan): boolean =>
  plan.exit.transactions.some(tx => tx.kind === 'fanOut' && tx.status.type === 'confirmed');

/** The on-chain address a destination names. A scanned receive QR is a BIP21 URI, and the exit sweeps to the address in it. */
export function destinationAddressOf(parsed: InputType | null): string | undefined {
  if (parsed?.type === 'bitcoinAddress') return parsed.address;
  if (parsed?.type !== 'bip21') return undefined;
  return parsed.paymentMethods.flatMap(method => (method.type === 'bitcoinAddress' ? [method.address] : []))[0];
}

/** What a build said it needs: the sdk's error reaches the page only as its message. */
export function requiredFundingOf(error: string): number | null {
  const match = /need at least (\d+) sats/i.exec(error);
  return match ? Number(match[1]) : null;
}

export interface PlanProgress {
  confirmed: number;
  total: number;
  isComplete: boolean;
}

/** `isComplete` follows the sdk's verdict: only a confirmed sweep finishes an exit. */
export function planProgress(plan: UnilateralExitPlan): PlanProgress {
  const { transactions } = plan.exit;
  const confirmed = transactions.filter(tx => tx.status.type === 'confirmed').length;
  return { confirmed, total: transactions.length, isComplete: plan.phase === 'complete' };
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
export function nextAction(all: UnilateralExitTransaction[], tipHeight: number): NextAction | null {
  const waits = all.flatMap(tx =>
    tx.status.type === 'waitingForTimelock' && tx.status.spendableAtHeight !== undefined
      ? [Math.max(0, tx.status.spendableAtHeight - tipHeight)]
      : [],
  );
  if (waits.length === 0) return null;
  const blocks = Math.min(...waits);
  return { blocks, transactions: waits.filter(w => w === blocks).length };
}

const phaseOf = (verdict: CheckUnilateralExitResponse['verdict']): ExitPhase => {
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
export async function checkExit(plan: UnilateralExitPlan, sdk: ExitSdk): Promise<UnilateralExitPlan> {
  const checked = await sdk.checkUnilateralExit({ exit: plan.exit });
  return applyExitCheck(plan, checked.exit, phaseOf(checked.verdict));
}

/**
 * Builds the exit again over whatever the chain now holds, keeping its leaves,
 * destination, fee rate and funding. Null when there is nothing left to build,
 * which leaves the stored exit as it was.
 *
 * A background pass never asks for the recovery phrase: a wallet that keeps
 * none on the device throws, and the tracker offers the rebuild as a button.
 * The button passes `interactive`, since its tap is what lets a passkey
 * prompt run. The phrase is read first, while that tap is still fresh.
 */
export async function rebuildExit(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  identityPubkey: string,
  { interactive = false }: { interactive?: boolean } = {},
): Promise<UnilateralExitPlan | null> {
  const key = deriveFundingKey(
    await readWalletMnemonic({ interactive }),
    plan.network,
    plan.fundingAddressIndex,
  );
  await restoreExitState(sdk, plan, await loadExitState(identityPubkey).catch(() => null));

  // Named, not reselected: `auto` can drop a leaf that is part-way out.
  const prepared = await sdk.prepareUnilateralExit({
    feeRateSatPerVbyte: plan.feeRateSatPerVbyte,
    fundingKind: { type: 'p2wpkh' },
    destination: plan.destination,
    selection: { type: 'specific', leafIds: plan.exit.leaves.map(leaf => leaf.leafId) },
  });
  if (prepared.leaves.length === 0) return null;

  const rebuilt = await sdk.unilateralExit(
    { prepared, fundingInputs: plan.exit.fundingInputs },
    singleKeyCpfpSigner(key.secretKey),
  );
  if (rebuilt.transactions.length === 0) return null;

  const { network, destination, feeRateSatPerVbyte, fundingAddressIndex, quotedSweepFeeSat } = plan;
  return {
    ...planFromExitResponse(rebuilt, { network, destination, feeRateSatPerVbyte, fundingAddressIndex, quotedSweepFeeSat }),
    exitStateSnapshot: plan.exitStateSnapshot,
  };
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
  for (const tx of plan.exit.transactions.filter(isReady)) {
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

export async function advanceUnilateralExit(
  plan: UnilateralExitPlan,
  chain: ChainClient,
  sdk?: ExitSdk,
  identityPubkey?: string,
): Promise<{ plan: UnilateralExitPlan; tipHeight: number }> {
  const tipHeight = await chain.tipHeight();
  let next = plan;
  if (sdk) {
    try {
      next = await checkExit(next, sdk);
    } catch (e) {
      // Not shown: the next pass tries again, and the log keeps the reason.
      const error = e instanceof Error ? e.message : String(e);
      logger.warn(LogCategory.SDK, `Failed to read the exit back from the sdk: ${error}`);
    }
  }

  // The chain diverging is routine: the operators' watchtower publishes its own
  // copy of a refund. The exit is rebuilt over what is now on-chain.
  if (next.phase === 'redo' && sdk && identityPubkey) {
    try {
      next = (await rebuildExit(next, sdk, identityPubkey)) ?? next;
    } catch (e) {
      // Waiting on the user to sign in is the designed path, not a fault: the
      // exit stays in `redo` and the tracker offers the rebuild as a button.
      if (e instanceof MnemonicNeedsPasskeyError) return { plan: next, tipHeight };
      const error = e instanceof Error ? e.message : String(e);
      logger.warn(LogCategory.SDK, `Failed to rebuild the exit: ${error}`);
    }
  }

  if (next.phase !== 'active') return { plan: next, tipHeight };
  return { plan: await broadcastReadyTransactions(next, chain), tipHeight };
}
