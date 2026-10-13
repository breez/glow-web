import type { RecoverFundsResponse, RecoveryVerdict } from '@breeztech/breez-sdk-spark';
import { logger, LogCategory } from '@/services/logger';
import { recordLanded } from './ledger';
import { paceRetry } from './leftovers';
import {
  hasUnverifiedStep,
  isLanded,
  isUnilateralLanded,
  leftoverIdsOf,
  type ExitPhase,
  type UnilateralExitPlan,
} from './model/plan';
import type { ExitSdk } from './quoting';

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

/** Reads the exit back against the chain. Needs nothing but the stored response, so it works with the leaves gone from the operators' view. */
export async function checkExit(plan: UnilateralExitPlan, sdk: Pick<ExitSdk, 'checkRecoverFunds'>): Promise<UnilateralExitPlan> {
  const checked = await sdk.checkRecoverFunds({ recovery: plan.exit });
  return applyExitCheck(plan, checked.recovery, phaseOf(checked.verdict));
}

export interface PassCheck {
  plan: UnilateralExitPlan;
  checked: boolean;
  doneSet: boolean;
  retryNow: boolean;
}

export async function checkAndPace(
  plan: UnilateralExitPlan,
  sdk: ExitSdk | undefined,
  tipHeight: number,
  inSlot: boolean,
): Promise<PassCheck> {
  if (!sdk) return { plan, checked: false, doneSet: false, retryNow: false };
  let next = plan;
  let doneSet = false;
  let landsNow: boolean;
  try {
    // With nothing built there is nothing to read back, only leftovers to try.
    const unbuilt = inSlot && next.exit.transactions.length === 0 && leftoverIdsOf(next).length > 0;
    next = unbuilt ? next : await checkExit(next, sdk);
    if (inSlot && next.phase === 'complete' && leftoverIdsOf(next).length > 0) {
      // The Done verdict covers only the set, so a leaf it left out is still
      // part of the exit.
      doneSet = true;
      next = { ...next, phase: 'active' };
    }
    // The week runs from the pass the last unilateral step lands, whatever
    // the verdict: the leftovers are tried at once then, so a fee they need
    // is asked with the whole week to pay it.
    landsNow =
      inSlot &&
      next.phase === 'active' &&
      leftoverIdsOf(next).length > 0 &&
      !isUnilateralLanded(plan.exit) &&
      isUnilateralLanded(next.exit);
    if (landsNow) next = { ...next, retrySince: tipHeight, retriedAt: undefined };
    next = paceRetry(next, tipHeight, inSlot);
  } catch (e) {
    // Not shown: the next pass tries again, and the log keeps the reason.
    const error = e instanceof Error ? e.message : String(e);
    logger.warn(LogCategory.SDK, `Failed to read the exit back from the sdk: ${error}`);
    return { plan: next, checked: false, doneSet, retryNow: false };
  }
  // At once on the first Done verdict too, which can come after the last
  // unilateral step landed, once a co-signed recovery confirms.
  const retryNow = landsNow || (doneSet && (!isLanded(plan.exit) || plan.retriedAt === undefined));
  return { plan: next, checked: true, doneSet, retryNow };
}
