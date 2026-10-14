import { useCallback, useEffect, useRef, useState } from 'react';
import type { BreezSdk, PrepareRecoverFundsResponse } from '@breeztech/breez-sdk-spark';
import { holdIdleLock } from '@/services/appLock';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';
import { asKeptRecovery, type ExitMode, type UnilateralExitPlan, type WalletKey } from '../model/plan';
import { buildFromQuote, fundingInputsOf, mergeFunding, planFromBuild, planTakingIn } from '../building';
import { buildRecoveryBump } from '../recoveries';
import { quoteLeaves } from '../quoting';
import { requiredFundingOf, sentSince } from '../exitFee';
import { keepRecovery, setUnilateralExitPlan } from '../engine/api';
import { loadExitState, restoreExitState } from '../exitState';
import { builtExitFeeRecord, exitFeeRecordOf, isCooperative, isCooperativeLeaf, willReceiveSat } from '../quote';
import type { useContinueExit } from './useContinueExit';
import type { useExitFeeAddress, useFeeKey } from './useExitFeeAddress';
import type { useExitQuote } from './useExitQuote';
import type { UnilateralExitPhase } from './useExitWizard';

interface BuildInputs {
  wallet: BreezSdk;
  walletKey: WalletKey | null;
  network: string;
  plan: UnilateralExitPlan | null;
  mode: ExitMode | undefined;
  /** A new exit takes in the recovery under way in `plan`. */
  takesIn: boolean;
  bumping: boolean;
  bumpTarget: UnilateralExitPlan | null;
  phase: UnilateralExitPhase;
  goTo: (phase: UnilateralExitPhase) => void;
  quoting: Pick<ReturnType<typeof useExitQuote>, 'quote' | 'setStartError' | 'setShortfall' | 'setSplitOff' | 'forgetQuote'>;
  feeKey: Pick<ReturnType<typeof useFeeKey>, 'key' | 'holdsPhrase' | 'forgetPhrase'>;
  feeAddress: Pick<ReturnType<typeof useExitFeeAddress>, 'confirmedUtxos' | 'sent'>;
  continuing: Pick<ReturnType<typeof useContinueExit>, 'continueExit' | 'clearContinueError'>;
}

export function useExitBuild(inputs: BuildInputs) {
  const { wallet, walletKey, network, plan, mode, takesIn, bumping, bumpTarget, phase, goTo } = inputs;
  const { quote, figures } = inputs.quoting.quote;
  const { setStartError, setShortfall, setSplitOff, forgetQuote } = inputs.quoting;
  const { key: fundingKey, holdsPhrase, forgetPhrase } = inputs.feeKey;
  const { confirmedUtxos, sent } = inputs.feeAddress;
  const { continueExit, clearContinueError } = inputs.continuing;
  const [buildError, setBuildError] = useState<string | null>(null);
  const [sentSat, setSentSat] = useState(0);
  // A resumed exit tries its build once per quote before asking for anything.
  /** The last build attempt: its quote and the money that was at the address. */
  const tried = useRef<{ quote: PrepareRecoverFundsResponse; sat: number; inputs: number } | null>(null);

  // Builds the reviewed quote: an exit under way from the coins at its fee
  // address, or, when the quote needs no funding, any exit straight away. A
  // leftover's fee screen has no quote: its button continues the exit. A bump
  // keeps to its own recovery, whatever the exit beside it waits on.
  const build = useCallback(async () => {
    if (!bumping && !takesIn && !fundingKey && plan?.status.type === 'needsExitFee') return continueExit();
    if (!walletKey || !quote || !figures || (bumping && !bumpTarget)) return;
    const funded = figures.needsFunding;
    if (funded && (!plan || !fundingKey || !holdsPhrase())) return;
    goTo('building');
    setBuildError(null);
    setStartError(null);
    const release = holdIdleLock();
    try {
      // Before anything that reads the exit: a bump never writes to its slot.
      if (bumping && bumpTarget) {
        const next = await buildRecoveryBump(wallet, bumpTarget, quote);
        keepRecovery(walletKey, next);
        setSentSat(willReceiveSat(next));
        goTo('sent');
        return;
      }
      // The funding an earlier attempt was built from still pays: the sdk
      // follows a spent outpoint to what it became. Fresh coins at the same
      // address are offered alongside it.
      const funding =
        funded && plan && fundingKey
          ? {
              inputs: mergeFunding(plan.exit.fundingInputs, fundingInputsOf(confirmedUtxos, fundingKey.publicKeyHex)),
              secretKey: fundingKey.secretKey,
            }
          : null;
      await restoreExitState(wallet, plan, await loadExitState(walletKey.identityPubkey));
      const response = await buildFromQuote(wallet, quote, funding);
      // Taking in a recovery adds what was sent for the exit to what the recovery was paid.
      const sentSat = takesIn && plan ? sentSince(plan, confirmedUtxos) : undefined;
      const meta = {
        network,
        fundingAddressIndex: plan?.fundingAddressIndex ?? 0,
        mode,
        ...builtExitFeeRecord(quote, plan ? exitFeeRecordOf(plan) : {}, fundingKey?.address, sentSat),
      };
      const built = takesIn && plan ? planTakingIn(quote, response, plan, meta) : planFromBuild(quote, response, plan, meta);
      // Only co-signed funds: kept beside the plan slot, since they need no
      // tracker of the exit's and hold up no exit.
      if (!plan && mode === 'recover' && response.transactions.every(isCooperative)) {
        keepRecovery(walletKey, built);
        setSentSat(willReceiveSat(asKeptRecovery(built)));
        goTo('sent');
        return;
      }
      // Frozen against the leaves this exit moves: from here the operators stop
      // reporting them, so a later export is worth less. An exit already
      // holding a snapshot keeps it. One taking in a recovery moves the balance
      // too, which the recovery's snapshot predates.
      const exitStateSnapshot =
        (takesIn ? undefined : plan?.exitStateSnapshot) ??
        (await wallet
          .exportUnilateralExitState()
          .then(r => r.exitState)
          .catch(() => plan?.exitStateSnapshot));
      setUnilateralExitPlan(walletKey, { ...built, exitStateSnapshot });
      forgetPhrase();
      goTo('tracker');
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to build unilateral exit', { error: formatError(e) });
      if (!funded) {
        setStartError(formatError(e));
        goTo('quote');
        return;
      }
      setBuildError(formatError(e));
      const required = requiredFundingOf(formatError(e));
      setShortfall(required === null ? null : { sat: required, inputs: sent.inputs });
      goTo('fund');
    } finally {
      release();
    }
  }, [
    wallet,
    walletKey,
    quote,
    figures,
    fundingKey,
    confirmedUtxos,
    sent,
    network,
    plan,
    mode,
    takesIn,
    bumping,
    bumpTarget,
    continueExit,
    holdsPhrase,
    forgetPhrase,
    goTo,
    setStartError,
    setShortfall,
  ]);

  // A quote that needs funding goes on to the phrase and the fee address. One
  // that needs none has nothing to sign and nothing to wait for, so it builds.
  // A recovery sends its co-signed part on this tap, before the exit fee
  // (guide: recovering without funding).
  const continueFromQuote = useCallback(async () => {
    if (!figures || !quote || !walletKey) return;
    if (!figures.needsFunding) return build();
    if (mode !== 'recover' || plan || figures.recoverableSat === 0) {
      goTo('unlock');
      return;
    }
    goTo('building');
    setStartError(null);
    const release = holdIdleLock();
    try {
      const at = { feeRateSatPerVbyte: quote.feeRateSatPerVbyte, destination: quote.destination };
      const cosigned = await quoteLeaves(wallet, quote.leaves.filter(isCooperativeLeaf).map(leaf => leaf.leafId), at);
      const response = await buildFromQuote(wallet, cosigned, null);
      keepRecovery(walletKey, planFromBuild(cosigned, response, null, { network, fundingAddressIndex: 0, mode }));
      setSplitOff(true);
      goTo('unlock');
    } catch (e) {
      // The rest needs no co-signer, so it goes ahead. The co-signed funds stay
      // recoverable, and the pending recovery's start tries them again.
      logger.warn(LogCategory.SDK, 'Failed to recover the co-signed funds, continuing with the rest', { error: formatError(e) });
      setSplitOff(true);
      goTo('unlock');
    } finally {
      release();
    }
  }, [figures, quote, walletKey, mode, plan, build, wallet, network, goTo, setStartError, setSplitOff]);

  // What a resumed exit already holds may pay the new rate, and only a build can
  // tell. So it tries once, and the step asks for more only when that falls short.
  // Keyed on what the address holds as well: a confirmation changes what counts
  // as sent, and any payment, short or over, is worth another build. Amounts
  // rather than objects, since every engine pass emits a fresh plan. It cannot
  // feed itself: a build leaves this phase on its first line. Only the wizard's
  // fee screen, whose key the unlock read: a leftover's waits for the tap.
  useEffect(() => {
    if (phase !== 'fund' || !quote || !fundingKey) return;
    const attempt = { quote, sat: sent.sat, inputs: sent.inputs };
    if (
      tried.current?.quote === attempt.quote &&
      tried.current.sat === attempt.sat &&
      tried.current.inputs === attempt.inputs
    ) {
      return;
    }
    tried.current = attempt;
    void build();
  }, [phase, quote, fundingKey, sent.sat, sent.inputs, build]);

  // Keeps the destination and the leaves, and re-enters at the fee step: the
  // reason to rebuild by hand is almost always to pay more.
  const rebuild = useCallback(() => {
    forgetQuote();
    setBuildError(null);
    // The failed tap that offered this belongs to the tracker, not the wizard's screens.
    clearContinueError();
    goTo('fee');
  }, [forgetQuote, clearContinueError, goTo]);

  return { build, buildError, continueFromQuote, sentSat, rebuild };
}
