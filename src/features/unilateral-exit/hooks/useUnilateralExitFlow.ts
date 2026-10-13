import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InputType, PrepareRecoverFundsResponse } from '@breeztech/breez-sdk-spark';
import { useWallet, useWalletInfo } from '@/contexts/WalletContext';
import { holdIdleLock } from '@/services/appLock';
import { createChainClient } from '@/services/chain';
import type { ChainUtxo, FeeRates } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { destinationErrorMessage } from '@/utils/destinationAddress';
import {
  asKeptRecovery,
  awaitsUpdate,
  buildFromQuote,
  buildLeftover,
  buildRecoveryBump,
  destinationAddressOf,
  fundingInputsOf,
  isUnilateralLanded,
  leftoverTopUp,
  mergeFunding,
  planFromBuild,
  quoteFresh,
  quoteLeaves,
  quoteNamed,
  quoteRecoveryBump,
  RebuildLaterError,
  rebuildExit,
  requiredFundingOf,
  sentFunding,
  topUpFor,
  type ExitMode,
  type Funding,
  type TopUp,
  type WalletKey,
} from '../driver';
import {
  builtExitFeeRecord,
  exitFeeRecordOf,
  isCooperative,
  isCooperativeLeaf,
  quoteFigures,
  willReceiveSat,
  type QuoteFigures,
} from '../quote';
import {
  advanceNow,
  excludedLeafIds,
  keepRecovery,
  noteDropped,
  setPendingExit,
  setUnilateralExitPlan,
  type UnilateralExitEngineState,
} from '../engine';
import { recoveryTxid } from '../archive';
import { loadExitState, restoreExitState } from '../exitState';
import { deriveFundingKey, readWalletMnemonic, type FundingKey } from '../funding';
import { useUnilateralExitEngineState } from './useUnilateralExitEngineLifecycle';

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

export type FeeChoice = 'slow' | 'medium' | 'fast';

const FUNDING_POLL_MS = 15_000;
const FALLBACK_FEE_RATES: FeeRates = { slow: 2, medium: 5, fast: 10 };

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// A replacement pays at least a sat/vB more than what it replaces (BIP 125).
// Each option stays a sat/vB above the one before, so a floor above today's
// rates does not leave three that read the same.
const liftRates = (rates: FeeRates, floor: number): FeeRates => {
  if (floor <= 0) return rates;
  const slow = Math.max(rates.slow, floor);
  const medium = Math.max(rates.medium, slow + 1);
  return { slow, medium, fast: Math.max(rates.fast, medium + 1) };
};

export interface DestinationFields {
  destination: string;
  onChange: (value: string) => void;
  error: string | null;
}

export interface FeeFields {
  feeRates: FeeRates | null;
  feeChoice: FeeChoice;
  effectiveFeeRate: number;
  onSelect: (choice: FeeChoice) => void;
}

export interface QuoteFields {
  quote: PrepareRecoverFundsResponse | null;
  /** Everything the step shows, read off the quote. Null until one lands. */
  figures: QuoteFigures | null;
  isQuoting: boolean;
  error: string | null;
}

/** An exit under way keeps its funding address, and what it holds pays for the rest. */
export interface FundingFields {
  address: string;
  isFunded: boolean;
  /** What to send after a build at this quote fell short, or null before one does. */
  topUp: TopUp | null;
  /** Nothing is left to send, but the build waits for a confirmation: of what was sent, or of the exit's own steps. */
  waitsForConfirmation: boolean;
  /** The quote's rate, which the build pays. */
  feeRate: number;
  /** The rate the exit runs at until the build replaces it. */
  currentFeeRate: number | null;
  /**
   * The slowest rate the network is taking. Null before the rates load, and
   * where fees dropping would not continue the exit: a leftover, or an exit
   * that waits on the update tap.
   */
  networkFloorFeeRate: number | null;
  /** When the quote the figures come from was taken, in ms. */
  quotedAt: number | null;
}

/**
 * Whether the quote is one an exit can be started from. The step renders a dead
 * end for each of these, and the page's call to action follows it.
 */
export function canContinueFromQuote({ isQuoting, error, figures }: QuoteFields): boolean {
  return !isQuoting && !error && !!figures?.isWorthMoving;
}

export interface UnilateralExitFlow {
  phase: UnilateralExitPhase;
  /** A saved exit's own, else the one the sheet was opened for. */
  mode: ExitMode | undefined;
  engine: UnilateralExitEngineState;
  /** False where back leaves the flow: the first step, and an exit already saved. */
  canGoBack: boolean;
  destination: DestinationFields;
  fee: FeeFields;
  quote: QuoteFields;
  /** Null until the recovery phrase is unlocked, which the funding key derives from, or a leftover asks for more exit fee. */
  funding: FundingFields | null;
  submitDestination: () => Promise<void>;
  submitFee: () => Promise<void>;
  /** The quote step's call to action, for either flow's screens. */
  continueFromQuote: () => Promise<void>;
  /** Why building a quote that needs no funding failed, shown on that quote. */
  startError: string | null;
  unlock: () => Promise<void>;
  unlockError: string | null;
  build: () => Promise<void>;
  buildError: string | null;
  /** What the co-signed recovery just sent will deliver. */
  sentSat: number;
  /** Raises the fee of a kept co-signed recovery, and starts nothing. */
  bumping: boolean;
  /** The kept recovery that holds the bumped leaves now, by its txid. Null while none does. */
  bumpedTxid: string | null;
  rebuild: () => void;
  /** Rebuilds a diverged exit in place, at its own fee rate, without the wizard, or builds a leftover whose fee arrived. */
  continueExit: () => Promise<void>;
  isContinuing: boolean;
  continueError: string | null;
  goTo: (phase: UnilateralExitPhase) => void;
  back: () => void;
}

/**
 * `openedMode` is what the sheet was opened for: `recover` from the Recoverable
 * Funds row. `bumpTxid` is a kept co-signed recovery to build again at a
 * higher fee, from its tracker.
 */
export function useUnilateralExitFlow(network: string, openedMode?: ExitMode, bumpTxid?: string): UnilateralExitFlow {
  const wallet = useWallet();
  const info = useWalletInfo();
  const identityPubkey = info?.identityPubkey;
  const walletKey = useMemo<WalletKey | null>(
    () => (identityPubkey ? { identityPubkey, network } : null),
    [identityPubkey, network],
  );
  const chain = useMemo(() => createChainClient(network), [network]);
  const engine = useUnilateralExitEngineState();
  const { plan, pending, pendingCoins, recoveries, archive, accounting, tipHeight } = engine;
  // Every bump branch keys on the prop, so a bump never falls through to the
  // exit's quote or plan slot, whether or not its recovery is still there.
  const bumping = !!bumpTxid;
  // A snapshot: a retry can swap the recovery's transaction while the sheet is
  // open, but not its leaves, address or rate.
  const [bumpTarget] = useState(() => (bumpTxid ? (recoveries.find(r => recoveryTxid(r) === bumpTxid) ?? null) : null));
  const bumpedTxid = useMemo(() => {
    const ids = new Set(bumpTarget?.exit.leaves.map(leaf => leaf.leafId));
    const holder = recoveries.find(r => r.exit.leaves.some(leaf => ids.has(leaf.leafId)));
    return holder ? recoveryTxid(holder) : null;
  }, [bumpTarget, recoveries]);
  // A saved record keeps what it is, whichever row opened the sheet.
  const mode = bumping ? 'recover' : plan ? plan.mode : pending ? pending.mode : openedMode;

  // A saved exit decides where the sheet opens: one under way on its tracker,
  // one waiting on its fee on where to pay it. The engine moves it from one to
  // the other, so these steps follow it rather than holding their own place.
  // A recovery has no intro: it opens on where to send the funds. A bump keeps
  // the recovery's address, so it opens on the fee.
  const freshRecovery = mode === 'recover' && !plan && !pending;
  const [step, setPhase] = useState<UnilateralExitPhase>(() =>
    bumping ? 'fee' : freshRecovery ? 'destination' : 'intro',
  );
  const [fundingKey, setFundingKey] = useState<FundingKey | null>(null);
  // A leftover waiting on more exit fee is the engine's too: its fee screen
  // follows the plan, unless the wizard raising the fee holds its own key.
  const followsEngine =
    step === 'intro' || step === 'pending' || step === 'tracker' || ((step === 'fund' || step === 'topUp') && !fundingKey);
  const phase: UnilateralExitPhase = followsEngine
    ? plan
      ? plan.topUp
        ? step === 'topUp'
          ? 'topUp'
          : 'fund'
        : 'tracker'
      : pending
        ? 'pending'
        : 'intro'
    : step;
  // A rebuild re-enters the wizard; retyping the address is a chance to get it
  // wrong. A sheet opened while the exit waits on its fee can rebuild it once it
  // starts, so a pending exit seeds the address too.
  const [destination, setDestination] = useState(() => (plan ?? pending)?.destination ?? '');
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [feeRates, setFeeRates] = useState<FeeRates | null>(null);
  const [feeChoice, setFeeChoice] = useState<FeeChoice>('medium');
  const [quote, setQuote] = useState<PrepareRecoverFundsResponse | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const quoteRequest = useRef(0);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [fundingUtxos, setFundingUtxos] = useState<ChainUtxo[]>([]);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // The co-signed part of a mixed recovery went out on its own, so the exit fee
  // pays for the rest alone.
  const [splitOff, setSplitOff] = useState(false);
  const [sentSat, setSentSat] = useState(0);
  // Only the build knows what an exit still needs, and it says so by refusing.
  // Held with the inputs it had, for this quote's rate, so a new quote clears it.
  const [shortfall, setShortfall] = useState<Funding | null>(null);
  const [quotedAt, setQuotedAt] = useState<number | null>(null);
  // A resumed exit tries its build once per quote before asking for anything.
  /** The last build attempt: its quote and the money that was at the address. */
  const tried = useRef<{ quote: PrepareRecoverFundsResponse; sat: number; inputs: number } | null>(
    null,
  );
  const mnemonicRef = useRef<string | null>(null);

  useEffect(() => () => {
    mnemonicRef.current = null;
  }, []);

  // A bump offers no rate at or below the recovery's own.
  const bumpFloor = bumpTarget ? bumpTarget.feeRateSatPerVbyte + 1 : 0;
  useEffect(() => {
    if (phase !== 'fee' || feeRates) return;
    let cancelled = false;
    chain
      .feeRates()
      .catch(e => {
        logger.warn(LogCategory.SDK, 'Failed to read fee rates', { error: message(e) });
        return FALLBACK_FEE_RATES;
      })
      .then(rates => {
        if (!cancelled) setFeeRates(liftRates(rates, bumpFloor));
      });
    return () => {
      cancelled = true;
    };
  }, [phase, feeRates, chain, bumpFloor]);

  useEffect(() => {
    if ((phase !== 'fund' && phase !== 'topUp') || !fundingKey) return;
    let cancelled = false;
    const check = async () => {
      try {
        const utxos = await chain.addressUtxos(fundingKey.address);
        if (!cancelled) setFundingUtxos(utxos);
      } catch (e) {
        logger.warn(LogCategory.SDK, 'Failed to read funding utxos', { error: message(e) });
      }
    };
    void check();
    const timer = setInterval(() => void check(), FUNDING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, fundingKey, chain]);

  const effectiveFeeRate = feeRates?.[feeChoice] ?? 0;

  const submitDestination = useCallback(async () => {
    const trimmed = destination.trim();
    if (!trimmed) {
      setDestinationError('Enter a Bitcoin address');
      return;
    }
    const parsed = await wallet.parse(trimmed).catch(e => e as unknown);
    const address = parsed instanceof Error ? undefined : destinationAddressOf(parsed as InputType);
    if (!address) {
      setDestinationError(destinationErrorMessage(parsed, 'That is not an on-chain Bitcoin address'));
      return;
    }
    setDestination(address);
    setDestinationError(null);
    setPhase('fee');
  }, [destination, wallet]);

  const refreshQuote = useCallback(async () => {
    if (effectiveFeeRate <= 0 || (bumping && !bumpTarget)) return;
    // Back is open while a quote is out, so a slower, older one can land last.
    const request = ++quoteRequest.current;
    setIsQuoting(true);
    setQuoteError(null);
    setStartError(null);
    setShortfall(null);
    setSplitOff(false);
    try {
      // Quoted against the backed-up leaf data, not only what the operators still report.
      if (walletKey) {
        await restoreExitState(wallet, plan, await loadExitState(walletKey.identityPubkey));
      }
      const at = { feeRateSatPerVbyte: effectiveFeeRate, destination: destination.trim() };
      // A resumed exit names its leaves: a fresh selection can drop one part-way out.
      const prepared =
        bumping && bumpTarget
          ? await quoteRecoveryBump(wallet, bumpTarget, effectiveFeeRate)
          : plan
            ? await quoteNamed(wallet, plan, at)
            : await quoteFresh(wallet, at, mode, excludedLeafIds({ recoveries, archive, accounting }));
      if (request !== quoteRequest.current) return;
      setQuote(prepared);
      setQuotedAt(Date.now());
      if (walletKey && mode === 'recover' && !plan && !bumping) {
        const dropped = prepared.skipped.filter(leaf => leaf.reason.type === 'notRecoverable');
        noteDropped(walletKey, dropped.map(({ leafId, valueSats }) => ({ leafId, valueSats })));
      }
      // Preparing records a recovery the SDK finds in a block, but the total only
      // drops at the next sync, so until then the row still offers those funds.
      if (mode === 'recover' && !plan && prepared.leaves.length === 0 && prepared.skipped.length === 0) {
        void wallet.syncWallet({}).catch(e => logger.warn(LogCategory.SDK, 'Sync after an empty quote failed', { error: message(e) }));
      }
    } catch (e) {
      if (request !== quoteRequest.current) return;
      logger.error(LogCategory.SDK, 'Failed to quote unilateral exit', { error: message(e) });
      setQuoteError(message(e));
      setQuote(null);
    } finally {
      if (request === quoteRequest.current) setIsQuoting(false);
    }
  }, [wallet, destination, effectiveFeeRate, walletKey, plan, mode, recoveries, archive, accounting, bumping, bumpTarget]);

  const submitFee = useCallback(async () => {
    setPhase('quote');
    await refreshQuote();
  }, [refreshQuote]);

  // An exit under way sets no floor on a bump's figures, which are its own.
  const resuming = bumping ? null : plan;
  const figures = useMemo(() => (quote ? quoteFigures(quote, { resuming }) : null), [quote, resuming]);

  // The index, not the plan, and no figures, which follow the plan: every
  // engine pass emits a new plan object, and the page re-runs unlock whenever
  // this callback changes.
  const planFundingIndex = plan?.fundingAddressIndex;
  const unlock = useCallback(async () => {
    if (!walletKey || !quote) return;
    setUnlockError(null);
    try {
      const mnemonic = await readWalletMnemonic({ interactive: true });
      // Every exit pays from the same address, so coins one exit leaves there
      // count toward the next. An exit under way keeps the index it was built with.
      const index = planFundingIndex ?? 0;
      const key = deriveFundingKey(mnemonic, network, index);
      if (planFundingIndex !== undefined) {
        mnemonicRef.current = mnemonic;
        setFundingKey(key);
        setPhase('fund');
        return;
      }
      // Saved before anything is paid, so closing the sheet keeps the address
      // and the amount.
      const figures = quoteFigures(quote);
      setPendingExit(
        walletKey,
        {
          network,
          destination: quote.destination,
          feeRateSatPerVbyte: quote.feeRateSatPerVbyte,
          fundingAddressIndex: index,
          fundingAddress: key.address,
          required: { sat: figures.exitFeeSat, inputs: 1 },
          willReceiveSat: splitOff ? figures.balanceReceiveSat : figures.willReceiveSat,
          mode,
        },
        key,
      );
      setPhase('pending');
    } catch (e) {
      setUnlockError(message(e));
    }
  }, [walletKey, quote, network, planFundingIndex, splitOff, mode]);

  const confirmedUtxos = useMemo(() => fundingUtxos.filter(utxo => utxo.confirmed), [fundingUtxos]);
  const sent = useMemo(() => sentFunding(plan, confirmedUtxos), [plan, confirmedUtxos]);
  const topUp = shortfall && quote ? topUpFor(shortfall, sent, quote.feeRateSatPerVbyte) : null;
  // An exit under way is not held to its quote: most of what the quote covers
  // is already on-chain, and only the build knows what is really needed. Once a
  // build has said what it needs, the address has to hold it.
  const isFunded = quote !== null && (!topUp || topUp.stillToSendSat === 0);

  // The redo card's button: the rebuild the engine runs on its own, from a tap.
  // A diverged exit needs no new fee rate or funding, so the wizard would only
  // add steps, and the tap is what lets a passkey wallet sign. A leftover whose
  // fee arrived is built the same way, from the coins the engine read.
  const [isContinuing, setIsContinuing] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);
  const continueExit = useCallback(async () => {
    if (!plan || !walletKey) return;
    setIsContinuing(true);
    setContinueError(null);
    try {
      if (plan.topUp) {
        const confirmed = pendingCoins.filter(coin => coin.confirmed);
        const built = await buildLeftover(plan, wallet, walletKey.identityPubkey, confirmed, { interactive: true });
        setUnilateralExitPlan(walletKey, built);
        return;
      }
      // A rebuild with nothing left comes back complete, and the engine archives it.
      const rebuilt = await rebuildExit(plan, wallet, walletKey.identityPubkey, { interactive: true });
      // This build just read the chain, so a step it still could not read waits
      // for the next block instead of asking for the tap again at once. Read
      // here, after the prompt: the engine's tip is stale while a redo waits.
      const tip = await chain.tipHeight().catch(() => tipHeight ?? undefined);
      setUnilateralExitPlan(walletKey, { ...rebuilt, unverifiedRebuiltAt: tip });
    } catch (e) {
      // Nothing to build until the chain shows where a leaf went: waiting, not
      // failure. A sign-in request stays until a tap lifts it, so this one
      // does. A failed rebuild is the engine's to clear on its next pass, and
      // the plan held here may already be stale.
      if (e instanceof RebuildLaterError) {
        if (plan.needsSignIn) {
          setUnilateralExitPlan(walletKey, { ...plan, needsSignIn: undefined, rebuildFailed: undefined, rebuildFailingSince: undefined });
        } else void advanceNow();
        return;
      }
      logger.error(LogCategory.SDK, 'Failed to continue unilateral exit', { error: message(e) });
      setContinueError(message(e));
    } finally {
      setIsContinuing(false);
    }
  }, [plan, wallet, walletKey, chain, tipHeight, pendingCoins]);

  // Builds the reviewed quote: an exit under way from the coins at its fee
  // address, or, when the quote needs no funding, any exit straight away. A
  // leftover's fee screen has no quote: its button continues the exit. A bump
  // keeps to its own recovery, whatever the exit beside it waits on.
  const build = useCallback(async () => {
    if (!bumping && !fundingKey && plan?.topUp) return continueExit();
    if (!walletKey || !quote || !figures || (bumping && !bumpTarget)) return;
    const funded = figures.needsFunding;
    if (funded && (!plan || !fundingKey || !mnemonicRef.current)) return;
    setPhase('building');
    setBuildError(null);
    setStartError(null);
    const release = holdIdleLock();
    try {
      // Before anything that reads the exit: a bump never writes to its slot.
      if (bumping && bumpTarget) {
        const next = await buildRecoveryBump(wallet, bumpTarget, quote);
        keepRecovery(walletKey, next);
        setSentSat(willReceiveSat(next));
        setPhase('sent');
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
      const built = planFromBuild(quote, response, plan, {
        network,
        fundingAddressIndex: plan?.fundingAddressIndex ?? 0,
        mode,
        ...builtExitFeeRecord(quote, plan ? exitFeeRecordOf(plan) : {}, fundingKey?.address),
      });
      // Only co-signed funds: kept beside the plan slot, since they need no
      // tracker of the exit's and hold up no exit.
      if (!plan && mode === 'recover' && response.transactions.every(isCooperative)) {
        keepRecovery(walletKey, built);
        setSentSat(willReceiveSat(asKeptRecovery(built)));
        setPhase('sent');
        return;
      }
      // Frozen against the leaves this exit moves: from here the operators stop
      // reporting them, so a later export is worth less. An exit already
      // holding a snapshot keeps it.
      const exitStateSnapshot =
        plan?.exitStateSnapshot ??
        (await wallet
          .exportUnilateralExitState()
          .then(r => r.exitState)
          .catch(() => undefined));
      setUnilateralExitPlan(walletKey, { ...built, exitStateSnapshot });
      mnemonicRef.current = null;
      setPhase('tracker');
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to build unilateral exit', { error: message(e) });
      if (!funded) {
        setStartError(message(e));
        setPhase('quote');
        return;
      }
      setBuildError(message(e));
      const required = requiredFundingOf(message(e));
      setShortfall(required === null ? null : { sat: required, inputs: sent.inputs });
      setPhase('fund');
    } finally {
      release();
    }
  }, [wallet, walletKey, quote, figures, fundingKey, confirmedUtxos, sent, network, plan, mode, bumping, bumpTarget, continueExit]);

  // A quote that needs funding goes on to the phrase and the fee address. One
  // that needs none has nothing to sign and nothing to wait for, so it builds.
  // A recovery sends its co-signed part on this tap, before the exit fee
  // (guide: recovering without funding).
  const continueFromQuote = useCallback(async () => {
    if (!figures || !quote || !walletKey) return;
    if (!figures.needsFunding) return build();
    if (mode !== 'recover' || plan || figures.recoverableSat === 0) {
      setPhase('unlock');
      return;
    }
    setPhase('building');
    setStartError(null);
    const release = holdIdleLock();
    try {
      const at = { feeRateSatPerVbyte: quote.feeRateSatPerVbyte, destination: quote.destination };
      const cosigned = await quoteLeaves(wallet, quote.leaves.filter(isCooperativeLeaf).map(leaf => leaf.leafId), at);
      const response = await buildFromQuote(wallet, cosigned, null);
      keepRecovery(walletKey, planFromBuild(cosigned, response, null, { network, fundingAddressIndex: 0, mode }));
      setSplitOff(true);
      setPhase('unlock');
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to recover the co-signed funds', { error: message(e) });
      setStartError(message(e));
      setPhase('quote');
    } finally {
      release();
    }
  }, [figures, quote, walletKey, mode, plan, build, wallet, network]);

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
    setQuote(null);
    setQuoteError(null);
    setBuildError(null);
    // The failed tap that offered this belongs to the tracker, not the wizard's screens.
    setContinueError(null);
    // The rates read when the page opened can be hours old by now.
    setFeeRates(null);
    setPhase('fee');
  }, []);

  // A card that comes back explains itself again rather than showing an error
  // from before. Cleared on the way out, not in the body, which would set
  // state during the effect.
  const asksForUpdate = !!plan && (awaitsUpdate(plan) || !!plan.topUp);
  useEffect(() => {
    if (!asksForUpdate) return;
    return () => setContinueError(null);
  }, [asksForUpdate]);

  const back = useCallback(() => setPhase(current => BACK[current] ?? current), []);

  // The wizard's fee screen holds its own key and quote. A leftover's has
  // neither: it shows what the plan asks for at its own address and rate,
  // against the confirmed coins the engine read there.
  const wizardFunding: FundingFields | null = fundingKey && {
    address: fundingKey.address,
    isFunded,
    topUp,
    waitsForConfirmation: false,
    feeRate: quote?.feeRateSatPerVbyte ?? 0,
    currentFeeRate: plan?.feeRateSatPerVbyte ?? null,
    // The slowest rate the network is taking: above the exit's own rate, the
    // exit is stalled by fees rather than by the rate the user just picked.
    networkFloorFeeRate: plan && awaitsUpdate(plan) ? null : (feeRates?.slow ?? null),
    quotedAt,
  };
  const leftoverFunding = useMemo<FundingFields | null>(() => {
    if (!plan?.topUp) return null;
    const address = exitFeeRecordOf(plan).exitFeeAddress;
    // With no address yet, the tap derives it and asks again. A payment on its
    // way counts toward the ask, as on the list row, so it is not asked for
    // twice; only confirmed coins fund the build.
    const asked = address ? leftoverTopUp(plan, pendingCoins) : null;
    const paid = !address || leftoverTopUp(plan, pendingCoins.filter(coin => coin.confirmed)).stillToSendSat === 0;
    const isFunded = isUnilateralLanded(plan.exit) && paid;
    return {
      address: address ?? '',
      isFunded,
      topUp: asked,
      waitsForConfirmation: !!asked && asked.stillToSendSat === 0 && !isFunded,
      feeRate: plan.feeRateSatPerVbyte,
      currentFeeRate: plan.feeRateSatPerVbyte,
      networkFloorFeeRate: null,
      quotedAt: null,
    };
  }, [plan, pendingCoins]);

  return {
    phase,
    mode,
    engine,
    /** False where back leaves the flow: the first step, and an exit already saved. */
    canGoBack:
      BACK[phase] !== undefined &&
      !(phase === 'destination' && freshRecovery) &&
      !(phase === 'fee' && bumping) &&
      !((phase === 'fund' || phase === 'topUp') && !fundingKey),
    destination: { destination, onChange: setDestination, error: destinationError },
    fee: {
      feeRates,
      feeChoice,
      effectiveFeeRate,
      onSelect: setFeeChoice,
    },
    quote: { quote, figures, isQuoting, error: quoteError },
    funding: wizardFunding ?? leftoverFunding,
    submitDestination,
    submitFee,
    continueFromQuote,
    startError,
    unlock,
    unlockError,
    build,
    buildError,
    sentSat,
    bumping,
    bumpedTxid,
    rebuild,
    continueExit,
    isContinuing,
    continueError,
    goTo: setPhase,
    back,
  };
}
