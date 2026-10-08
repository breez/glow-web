import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CpfpInput, InputType, PrepareUnilateralExitResponse } from '@breeztech/breez-sdk-spark';
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
  planFromExitResponse,
  rebuildExit,
  requiredFundingOf,
  sentFunding,
  topUpFor,
  type Funding,
  type TopUp,
  type WalletKey,
} from '../driver';
import { quoteFigures, quotedSweepFeeSat, type QuoteFigures } from '../quote';
import {
  setPendingExit,
  setUnilateralExitPlan,
  type UnilateralExitEngineState,
} from '../engine';
import { loadExitState, restoreExitState } from '../exitState';
import { deriveFundingKey, readWalletMnemonic, type FundingKey } from '../funding';
import { useUnilateralExitEngineState } from './useUnilateralExitEngineLifecycle';

/** `fund`, `topUp` and `building` raise the fee of an exit under way. A fresh exit's fee is paid on `pending`. */
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
  | 'tracker';

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
  quote: PrepareUnilateralExitResponse | null;
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
  continueFromQuote: () => void;
  /** Why building a quote that needs no funding failed, shown on that quote. */
  startError: string | null;
  unlock: () => Promise<void>;
  unlockError: string | null;
  build: () => Promise<void>;
  buildError: string | null;
  rebuild: () => void;
  /** Rebuilds a diverged exit in place, at its own fee rate, without the wizard. */
  continueExit: () => Promise<void>;
  isContinuing: boolean;
  continueError: string | null;
  goTo: (phase: UnilateralExitPhase) => void;
  back: () => void;
}

export function useUnilateralExitFlow(network: string): UnilateralExitFlow {
  const wallet = useWallet();
  const info = useWalletInfo();
  const identityPubkey = info?.identityPubkey;
  const walletKey = useMemo<WalletKey | null>(
    () => (identityPubkey ? { identityPubkey, network } : null),
    [identityPubkey, network],
  );
  const balanceSat = Number(info?.balanceSats ?? 0);
  const chain = useMemo(() => createChainClient(network), [network]);
  const engine = useUnilateralExitEngineState();
  const { plan, pending } = engine;

  // A saved exit decides where the sheet opens: one under way on its tracker,
  // one waiting on its fee on where to pay it. The engine moves it from one to
  // the other, so these steps follow it rather than holding their own place.
  const [step, setPhase] = useState<UnilateralExitPhase>('intro');
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
  const [quote, setQuote] = useState<PrepareUnilateralExitResponse | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const quoteRequest = useRef(0);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [fundingKey, setFundingKey] = useState<FundingKey | null>(null);
  const [fundingUtxos, setFundingUtxos] = useState<ChainUtxo[]>([]);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // Only the build knows what an exit still needs, and it says so by refusing.
  // Held with the inputs it had, for this quote's rate, so a new quote clears it.
  const [shortfall, setShortfall] = useState<Funding | null>(null);
  const [quotedAt, setQuotedAt] = useState<number | null>(null);
  // A resumed exit tries its build once per quote before asking for anything.
  /** The last build attempt: its quote and the money that was at the address. */
  const tried = useRef<{ quote: PrepareUnilateralExitResponse; sat: number; inputs: number } | null>(
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
    try {
      // Quoted against the backed-up leaf data, not only what the operators still report.
      if (walletKey) {
        await restoreExitState(wallet, plan, await loadExitState(walletKey.identityPubkey));
      }
      const prepared = await wallet.prepareUnilateralExit({
        feeRateSatPerVbyte: effectiveFeeRate,
        fundingKind: { type: 'p2wpkh' },
        destination: destination.trim(),
        // A resumed exit names its leaves: `auto` reselects, and can drop one part-way out.
        selection: plan
          ? { type: 'specific', leafIds: plan.exit.leaves.map(leaf => leaf.leafId) }
          : { type: 'auto' },
      });
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
  }, [wallet, destination, effectiveFeeRate, walletKey, plan]);

  const submitFee = useCallback(async () => {
    setPhase('quote');
    await refreshQuote();
  }, [refreshQuote]);

  const figures = useMemo(
    () => (quote ? quoteFigures(quote, { resuming: plan, walletBalanceSat: balanceSat }) : null),
    [quote, plan, balanceSat],
  );

  // The index, not the plan: every engine pass emits a new plan object, and
  // the page re-runs unlock whenever this callback changes.
  const planFundingIndex = plan?.fundingAddressIndex;
  const unlock = useCallback(async () => {
    if (!walletKey || !quote || !figures) return;
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
      setPendingExit(
        walletKey,
        {
          network,
          destination: quote.destination,
          feeRateSatPerVbyte: quote.feeRateSatPerVbyte,
          fundingAddressIndex: index,
          fundingAddress: key.address,
          required: { sat: figures.exitFeeSat, inputs: 1 },
          willReceiveSat: figures.willReceiveSat,
        },
        key,
      );
      setPhase('pending');
    } catch (e) {
      setUnlockError(message(e));
    }
  }, [walletKey, quote, figures, network, planFundingIndex]);

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
      // Frozen against the leaves this exit moves: from here the operators stop
      // reporting them, so a later export is worth less. An exit already
      // holding a snapshot keeps it.
      const exitStateSnapshot =
        plan?.exitStateSnapshot ??
        (await wallet
          .exportUnilateralExitState()
          .then(r => r.exitState)
          .catch(() => undefined));
      const built = planFromExitResponse(response, {
        network,
        destination: quote.destination,
        feeRateSatPerVbyte: quote.feeRateSatPerVbyte,
        fundingAddressIndex: plan?.fundingAddressIndex ?? 0,
        quotedSweepFeeSat: quotedSweepFeeSat(quote, plan),
        quotedExitFeeSat: figures.exitFeeSat,
        mode: plan?.mode,
      });
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
  }, [wallet, walletKey, quote, figures, fundingKey, confirmedUtxos, sent, network, plan]);

  // A quote that needs funding goes on to the phrase and the fee address. One
  // that needs none has nothing to sign and nothing to wait for, so it builds.
  const continueFromQuote = useCallback(() => {
    if (!figures) return;
    if (figures.needsFunding) setPhase('unlock');
    else void build();
  }, [figures, build]);

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
      const rebuilt = await rebuildExit(plan, wallet, walletKey.identityPubkey, { interactive: true });
      if (rebuilt) setUnilateralExitPlan(walletKey, rebuilt);
      else setContinueError('Nothing is left to rebuild. The exit updates on its next check.');
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to continue unilateral exit', { error: message(e) });
      setContinueError(message(e));
    } finally {
      setIsContinuing(false);
    }
  }, [plan, wallet, walletKey]);

  const back = useCallback(() => setPhase(current => BACK[current] ?? current), []);

  return {
    phase,
    engine,
    /** False where back leaves the flow: the first step, and an exit already saved. */
    canGoBack: BACK[phase] !== undefined,
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
    rebuild,
    continueExit,
    isContinuing,
    continueError,
    goTo: setPhase,
    back,
  };
}
