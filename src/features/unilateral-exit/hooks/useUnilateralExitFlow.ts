import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { singleKeyCpfpSigner } from '@breeztech/breez-sdk-spark';
import type { CpfpInput, PrepareUnilateralExitResponse } from '@breeztech/breez-sdk-spark';
import { useWallet, useWalletInfo } from '@/contexts/WalletContext';
import { holdIdleLock } from '@/services/appLock';
import { createChainClient } from '@/services/chain';
import type { ChainUtxo, FeeRates } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import {
  hasFixedFeeBudget,
  planFromExitResponse,
  quotedSweepFeeSat,
  rebuildExit,
  destinationAddressOf,
  requiredFundingOf,
  willReceiveSat,
  type WalletKey,
} from '../driver';
import { getUnilateralExitState, setUnilateralExitPlan, type UnilateralExitEngineState } from '../engine';
import { loadExitState, restoreExitState } from '../exitState';
import { bumpFundingIndex, deriveFundingKey, readFundingIndex, readWalletMnemonic, type FundingKey } from '../funding';
import { useUnilateralExitEngineState } from './useUnilateralExitEngineLifecycle';

export type UnilateralExitPhase =
  | 'intro'
  | 'destination'
  | 'fee'
  | 'quote'
  | 'unlock'
  | 'fund'
  | 'building'
  | 'tracker';

const BACK: Partial<Record<UnilateralExitPhase, UnilateralExitPhase>> = {
  destination: 'intro',
  fee: 'destination',
  quote: 'fee',
  unlock: 'quote',
  fund: 'quote',
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
  /** The one fee that comes off the balance, and what the destination gets after it. */
  sweepFeeSat: number;
  willReceiveSat: number;
  isQuoting: boolean;
  error: string | null;
  /** Balance in pieces too small to be worth their own fee at this rate. */
  leftBehindSat: number;
}

export interface FundingFields {
  address: string;
  requiredSat: number;
  fundedSat: number;
  isFunded: boolean;
  hasPendingDeposit: boolean;
  /** An exit already under way keeps its funding address, and what it holds pays for the rest. */
  isResuming: boolean;
  /** What the last build at this quote said it needs at the address, or null before one fails for want of it. */
  requiredFundingSat: number | null;
  /** More at the address cannot pay a higher fee: see `hasFixedFeeBudget`. */
  isFeeBudgetFixed: boolean;
}

/**
 * Whether the quote is one an exit can be started from. The step renders a dead
 * end for each of these, and the page's call to action follows it.
 */
export function canContinueFromQuote(fields: QuoteFields): boolean {
  if (fields.isQuoting || fields.error) return false;
  if (!fields.quote || fields.quote.leaves.length === 0) return false;
  return fields.quote.totalFeeSat < fields.quote.recoverableValueSat && fields.willReceiveSat > 0;
}

export interface UnilateralExitFlow {
  phase: UnilateralExitPhase;
  engine: UnilateralExitEngineState;
  /** False on the first step and on the tracker, where back leaves the flow. */
  canGoBack: boolean;
  destination: DestinationFields;
  fee: FeeFields;
  quote: QuoteFields;
  /** Null until the recovery phrase is unlocked, which the funding key derives from. */
  funding: FundingFields | null;
  submitDestination: () => Promise<void>;
  submitFee: () => Promise<void>;
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
  const plan = engine.plan;

  // An exit under way opens on its tracker; the wizard is entered from there.
  const [step, setPhase] = useState<UnilateralExitPhase>('intro');
  const phase: UnilateralExitPhase = step === 'intro' && plan ? 'tracker' : step;
  // A rebuild re-enters the wizard; retyping the address is a chance to get it wrong.
  const [destination, setDestination] = useState(() => getUnilateralExitState().plan?.destination ?? '');
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
  // Only the build knows what a resumed exit still needs, and it says so by
  // refusing. Held for this quote's rate, so a new quote clears it.
  const [requiredFundingSat, setRequiredFundingSat] = useState<number | null>(null);
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
    if (phase !== 'fund' || !fundingKey) return;
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
    const parsed = await wallet.parse(trimmed).catch(() => null);
    const address = destinationAddressOf(parsed);
    if (!address) {
      setDestinationError('That is not an on-chain Bitcoin address');
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
    setRequiredFundingSat(null);
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

  const unlock = useCallback(async () => {
    if (!walletKey) return;
    setUnlockError(null);
    try {
      const mnemonic = await readWalletMnemonic({ interactive: true });
      mnemonicRef.current = mnemonic;
      const index = plan?.fundingAddressIndex ?? readFundingIndex(walletKey);
      setFundingKey(deriveFundingKey(mnemonic, network, index));
      setPhase('fund');
    } catch (e) {
      setUnlockError(message(e));
    }
  }, [walletKey, network, plan]);

  const confirmedUtxos = useMemo(() => fundingUtxos.filter(utxo => utxo.confirmed), [fundingUtxos]);
  const fundedSat = confirmedUtxos.reduce((total, utxo) => total + utxo.value, 0);
  const isResuming = plan !== null;
  const isFeeBudgetFixed = plan !== null && hasFixedFeeBudget(plan);
  // A resumed exit is not held to a fresh exit's price: most of what the quote
  // covers is already on-chain, and only the build knows what is really needed.
  // A fresh exit's quote is a lower bound too. Once a build has said what it
  // needs, the address has to hold it, unless the fee coins are fixed, when no
  // amount there helps and only a new quote can.
  const isFunded =
    quote !== null &&
    (isResuming
      ? confirmedUtxos.length > 0 &&
        (requiredFundingSat === null || (!isFeeBudgetFixed && fundedSat >= requiredFundingSat))
      : fundedSat >= Math.max(quote.singleUtxoFundingSat, requiredFundingSat ?? 0));

  const build = useCallback(async () => {
    if (!walletKey || !quote || !fundingKey || !mnemonicRef.current) return;
    setPhase('building');
    setBuildError(null);
    const release = holdIdleLock();
    try {
      // The funding an earlier attempt was built from still pays: the sdk
      // follows a spent outpoint to what it became. Fresh coins at the same
      // address are offered alongside it.
      const fresh: CpfpInput[] = confirmedUtxos.map(utxo => ({
        type: 'p2wpkh',
        txid: utxo.txid,
        vout: utxo.vout,
        value: utxo.value,
        pubkey: fundingKey.publicKeyHex,
      }));
      const fundingInputs = mergeFunding(plan?.exit.fundingInputs ?? [], fresh);
      await restoreExitState(wallet, plan, await loadExitState(walletKey.identityPubkey));
      const response = await wallet.unilateralExit(
        { prepared: quote, fundingInputs },
        singleKeyCpfpSigner(fundingKey.secretKey),
      );
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
        fundingAddressIndex: plan?.fundingAddressIndex ?? readFundingIndex(walletKey),
        quotedSweepFeeSat: quotedSweepFeeSat(quote, plan),
      });
      setUnilateralExitPlan(walletKey, { ...built, exitStateSnapshot });
      if (!isResuming) bumpFundingIndex(walletKey);
      mnemonicRef.current = null;
      setPhase('tracker');
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to build unilateral exit', { error: message(e) });
      setBuildError(message(e));
      setRequiredFundingSat(requiredFundingOf(message(e)));
      setPhase('fund');
    } finally {
      release();
    }
  }, [wallet, walletKey, quote, fundingKey, confirmedUtxos, network, plan, isResuming]);

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
    /** False on the first step and on the tracker, where back leaves the flow. */
    canGoBack: BACK[phase] !== undefined,
    destination: { destination, onChange: setDestination, error: destinationError },
    fee: {
      feeRates,
      feeChoice,
      effectiveFeeRate,
      onSelect: setFeeChoice,
    },
    quote: {
      quote,
      sweepFeeSat: quote ? quotedSweepFeeSat(quote, plan) : 0,
      willReceiveSat: quote ? willReceiveSat(quote, plan) : 0,
      isQuoting,
      error: quoteError,
      leftBehindSat: quote ? Math.max(0, balanceSat - quote.recoverableValueSat) : 0,
    },
    funding: fundingKey && {
      address: fundingKey.address,
      requiredSat: quote?.singleUtxoFundingSat ?? 0,
      fundedSat,
      isFunded,
      hasPendingDeposit: fundingUtxos.some(utxo => !utxo.confirmed),
      isResuming,
      requiredFundingSat,
      isFeeBudgetFixed,
    },
    submitDestination,
    submitFee,
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
