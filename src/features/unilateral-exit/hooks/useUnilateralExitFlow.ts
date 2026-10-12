import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CpfpInput, InputType, PrepareRecoverFundsResponse } from '@breeztech/breez-sdk-spark';
import { useWallet, useWalletInfo } from '@/contexts/WalletContext';
import { holdIdleLock } from '@/services/appLock';
import { createChainClient } from '@/services/chain';
import type { ChainUtxo, FeeRates } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { destinationErrorMessage } from '@/utils/destinationAddress';
import {
  buildFromQuote,
  destinationAddressOf,
  fundingInputsOf,
  keptLeafIds,
  planFromBuild,
  quoteFresh,
  quoteLeaves,
  quoteNamed,
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
  keepRecovery,
  setPendingExit,
  setUnilateralExitPlan,
  type UnilateralExitEngineState,
} from '../engine';
import { loadExitState, restoreExitState } from '../exitState';
import { deriveFundingKey, readWalletMnemonic, type FundingKey } from '../funding';
import { useUnilateralExitEngineState } from './useUnilateralExitEngineLifecycle';

/**
 * `fund`, `topUp` and `building` raise the fee of an exit under way. A fresh
 * exit's fee is paid on `pending`. `sent` is a co-signed recovery on its way.
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

const outpoint = (input: CpfpInput): string => `${input.txid}:${input.vout}`;

const mergeFunding = (stored: CpfpInput[], fresh: CpfpInput[]): CpfpInput[] => {
  const seen = new Set(stored.map(outpoint));
  return [...stored, ...fresh.filter(input => !seen.has(outpoint(input)))];
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
  /** The quote's rate, which the build pays. */
  feeRate: number;
  /** The rate the exit runs at until the build replaces it. */
  currentFeeRate: number | null;
  /** The slowest rate the network is taking, or null before the rates load. */
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
  /** Null until the recovery phrase is unlocked, which the funding key derives from. */
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
  rebuild: () => void;
  /** Rebuilds a diverged exit in place, at its own fee rate, without the wizard. */
  continueExit: () => Promise<void>;
  isContinuing: boolean;
  continueError: string | null;
  goTo: (phase: UnilateralExitPhase) => void;
  back: () => void;
}

/** `openedMode` is what the sheet was opened for: `recover` from the Recoverable Funds row. */
export function useUnilateralExitFlow(network: string, openedMode?: ExitMode): UnilateralExitFlow {
  const wallet = useWallet();
  const info = useWalletInfo();
  const identityPubkey = info?.identityPubkey;
  const walletKey = useMemo<WalletKey | null>(
    () => (identityPubkey ? { identityPubkey, network } : null),
    [identityPubkey, network],
  );
  const chain = useMemo(() => createChainClient(network), [network]);
  const engine = useUnilateralExitEngineState();
  const { plan, pending, recoveries, tipHeight } = engine;
  // A saved record keeps what it is, whichever row opened the sheet.
  const mode = plan ? plan.mode : pending ? pending.mode : openedMode;

  // A saved exit decides where the sheet opens: one under way on its tracker,
  // one waiting on its fee on where to pay it. The engine moves it from one to
  // the other, so these steps follow it rather than holding their own place.
  // A recovery has no intro: it opens on where to send the funds.
  const freshRecovery = mode === 'recover' && !plan && !pending;
  const [step, setPhase] = useState<UnilateralExitPhase>(() => (freshRecovery ? 'destination' : 'intro'));
  const phase: UnilateralExitPhase =
    step === 'intro' || step === 'pending' || step === 'tracker'
      ? plan
        ? 'tracker'
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
  const [fundingKey, setFundingKey] = useState<FundingKey | null>(null);
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
        if (!cancelled) setFeeRates(rates);
      });
    return () => {
      cancelled = true;
    };
  }, [phase, feeRates, chain]);

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
    if (effectiveFeeRate <= 0) return;
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
      const prepared = plan
        ? await quoteNamed(wallet, plan, at)
        : await quoteFresh(wallet, at, mode, keptLeafIds(recoveries));
      if (request !== quoteRequest.current) return;
      setQuote(prepared);
      setQuotedAt(Date.now());
    } catch (e) {
      if (request !== quoteRequest.current) return;
      logger.error(LogCategory.SDK, 'Failed to quote unilateral exit', { error: message(e) });
      setQuoteError(message(e));
      setQuote(null);
    } finally {
      if (request === quoteRequest.current) setIsQuoting(false);
    }
  }, [wallet, destination, effectiveFeeRate, walletKey, plan, mode, recoveries]);

  const submitFee = useCallback(async () => {
    setPhase('quote');
    await refreshQuote();
  }, [refreshQuote]);

  const figures = useMemo(() => (quote ? quoteFigures(quote, { resuming: plan }) : null), [quote, plan]);

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

  // Builds the reviewed quote: an exit under way from the coins at its fee
  // address, or, when the quote needs no funding, any exit straight away.
  const build = useCallback(async () => {
    if (!walletKey || !quote || !figures) return;
    const funded = figures.needsFunding;
    if (funded && (!plan || !fundingKey || !mnemonicRef.current)) return;
    setPhase('building');
    setBuildError(null);
    setStartError(null);
    const release = holdIdleLock();
    try {
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
        setSentSat(willReceiveSat(built));
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
  }, [wallet, walletKey, quote, figures, fundingKey, confirmedUtxos, sent, network, plan, mode]);

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
  // feed itself: a build leaves this phase on its first line.
  useEffect(() => {
    if (phase !== 'fund' || !quote) return;
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
  }, [phase, quote, sent.sat, sent.inputs, build]);

  // Keeps the destination and the leaves, and re-enters at the fee step: the
  // reason to rebuild by hand is almost always to pay more.
  const rebuild = useCallback(() => {
    setQuote(null);
    setQuoteError(null);
    setBuildError(null);
    // The rates read when the page opened can be hours old by now.
    setFeeRates(null);
    setPhase('fee');
  }, []);

  // The redo card's button: the rebuild the engine runs on its own, from a tap.
  // A diverged exit needs no new fee rate or funding, so the wizard would only
  // add steps, and the tap is what lets a passkey wallet sign.
  const [isContinuing, setIsContinuing] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);
  const continueExit = useCallback(async () => {
    if (!plan || !walletKey) return;
    setIsContinuing(true);
    setContinueError(null);
    try {
      // A rebuild with nothing left comes back complete, and the engine archives it.
      const rebuilt = await rebuildExit(plan, wallet, walletKey.identityPubkey, { interactive: true });
      // This build just read the chain, so a step it still could not read waits
      // for the next block instead of asking for the tap again at once. Read
      // here, after the prompt: the engine's tip is stale while a redo waits.
      const tip = await chain.tipHeight().catch(() => tipHeight ?? undefined);
      setUnilateralExitPlan(walletKey, { ...rebuilt, unverifiedRebuiltAt: tip });
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to continue unilateral exit', { error: message(e) });
      setContinueError(message(e));
      // Nothing to sign yet: the engine's passes try again, and ask for the tap
      // once there is.
      if (e instanceof RebuildLaterError && plan.needsSignIn) {
        setUnilateralExitPlan(walletKey, { ...plan, needsSignIn: undefined });
      }
    } finally {
      setIsContinuing(false);
    }
  }, [plan, wallet, walletKey, chain, tipHeight]);

  const back = useCallback(() => setPhase(current => BACK[current] ?? current), []);

  return {
    phase,
    mode,
    engine,
    /** False where back leaves the flow: the first step, and an exit already saved. */
    canGoBack: BACK[phase] !== undefined && !(phase === 'destination' && freshRecovery),
    destination: { destination, onChange: setDestination, error: destinationError },
    fee: {
      feeRates,
      feeChoice,
      effectiveFeeRate,
      onSelect: setFeeChoice,
    },
    quote: { quote, figures, isQuoting, error: quoteError },
    funding: fundingKey && {
      address: fundingKey.address,
      isFunded,
      topUp,
      feeRate: quote?.feeRateSatPerVbyte ?? 0,
      currentFeeRate: plan?.feeRateSatPerVbyte ?? null,
      // The slowest rate the network is taking: above the exit's own rate, the
      // exit is stalled by fees rather than by the rate the user just picked.
      networkFloorFeeRate: feeRates?.slow ?? null,
      quotedAt,
    },
    submitDestination,
    submitFee,
    continueFromQuote,
    startError,
    unlock,
    unlockError,
    build,
    buildError,
    sentSat,
    rebuild,
    continueExit,
    isContinuing,
    continueError,
    goTo: setPhase,
    back,
  };
}
