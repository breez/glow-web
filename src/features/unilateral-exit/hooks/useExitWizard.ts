import { useCallback, useReducer } from 'react';
import type { ExitMode, PendingExit, UnilateralExitPlan } from '../model/plan';

/**
 * `fund`, `topUp` and `building` raise the fee of an exit under way, or pay
 * for a leaf it left out. A fresh exit's fee is paid on `pending`. `sent` is a
 * co-signed recovery on its way.
 */
export type UnilateralExitPhase =
  | 'intro'
  | 'destination'
  | 'fee'
  | 'quote'
  | 'unlock'
  | 'pending'
  | 'fund'
  | 'topUp'
  | 'building'
  | 'tracker'
  | 'sent';

const BACK: Partial<Record<UnilateralExitPhase, UnilateralExitPhase>> = {
  destination: 'intro',
  fee: 'destination',
  quote: 'fee',
  unlock: 'quote',
  fund: 'quote',
  topUp: 'fund',
};

type WizardAction = { type: 'goTo'; phase: UnilateralExitPhase } | { type: 'back' };

const wizardReducer = (step: UnilateralExitPhase, action: WizardAction): UnilateralExitPhase =>
  action.type === 'goTo' ? action.phase : (BACK[step] ?? step);

interface WizardInputs {
  plan: UnilateralExitPlan | null;
  pending: PendingExit | null;
  mode: ExitMode | undefined;
  bumping: boolean;
  holdsFeeKey: boolean;
}

// A recovery has no intro: it opens on where to send the funds. A bump keeps
// the recovery's address, so it opens on the fee.
const openingStep = ({ bumping, freshRecovery }: { bumping: boolean; freshRecovery: boolean }): UnilateralExitPhase =>
  bumping ? 'fee' : freshRecovery ? 'destination' : 'intro';

// A saved exit decides where the sheet opens: one under way on its tracker,
// one waiting on its fee on where to pay it. The engine moves it from one to
// the other, so these steps follow it rather than holding their own place.
// A leftover waiting on more exit fee is the engine's too: its fee screen
// follows the plan, unless the wizard raising the fee holds its own key.
function shownPhase(step: UnilateralExitPhase, { plan, pending, holdsFeeKey }: WizardInputs): UnilateralExitPhase {
  const followsEngine =
    step === 'intro' || step === 'pending' || step === 'tracker' || ((step === 'fund' || step === 'topUp') && !holdsFeeKey);
  if (!followsEngine) return step;
  if (plan) return plan.status.type === 'needsExitFee' ? (step === 'topUp' ? 'topUp' : 'fund') : 'tracker';
  return pending ? 'pending' : 'intro';
}

export function useExitWizard(inputs: WizardInputs) {
  const { plan, pending, mode, bumping, holdsFeeKey } = inputs;
  const freshRecovery = mode === 'recover' && !plan && !pending;
  const [step, dispatch] = useReducer(wizardReducer, { bumping, freshRecovery }, openingStep);
  const goTo = useCallback((phase: UnilateralExitPhase) => dispatch({ type: 'goTo', phase }), []);
  const back = useCallback(() => dispatch({ type: 'back' }), []);
  const phase = shownPhase(step, inputs);
  const canGoBack =
    BACK[phase] !== undefined &&
    !(phase === 'destination' && freshRecovery) &&
    !(phase === 'fee' && bumping) &&
    !((phase === 'fund' || phase === 'topUp') && !holdsFeeKey);
  return { phase, canGoBack, goTo, back };
}
