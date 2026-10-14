import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BreezSdk, InputType, PrepareRecoverFundsResponse } from '@breeztech/breez-sdk-spark';
import type { ChainClient, FeeRates } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { destinationErrorMessage } from '@/utils/destinationAddress';
import { formatError } from '@/utils/formatError';
import { destinationAddressOf } from '@/utils/destinationAddress';
import { quoteFresh, quoteNamed } from '../quoting';
import { quoteRecoveryBump } from '../recoveries';
import type { ExitMode, Funding, UnilateralExitPlan, WalletKey } from '../model/plan';
import { excludedLeafIds, type UnilateralExitEngineState } from '../engine/state';
import { noteDropped } from '../engine/api';
import { loadExitState, restoreExitState } from '../exitState';
import { isProvisionalSkip, quoteFigures } from '../quote';
import type { UnilateralExitPhase } from './useExitWizard';
import type { DestinationFields, FeeChoice, FeeFields, QuoteFields } from './useUnilateralExitFlow';

const FALLBACK_FEE_RATES: FeeRates = { slow: 2, medium: 5, fast: 10 };

// A replacement pays at least a sat/vB more than what it replaces (BIP 125).
// Each option stays a sat/vB above the one before, so a floor above today's
// rates does not leave three that read the same.
const liftRates = (rates: FeeRates, floor: number): FeeRates => {
  if (floor <= 0) return rates;
  const slow = Math.max(rates.slow, floor);
  const medium = Math.max(rates.medium, slow + 1);
  return { slow, medium, fast: Math.max(rates.fast, medium + 1) };
};

function useDestination(wallet: BreezSdk, saved: string, goTo: (phase: UnilateralExitPhase) => void) {
  // A rebuild re-enters the wizard; retyping the address is a chance to get it
  // wrong. A sheet opened while the exit waits on its fee can rebuild it once it
  // starts, so a pending exit seeds the address too.
  const [destination, setDestination] = useState(saved);
  const [error, setError] = useState<string | null>(null);

  const submitDestination = useCallback(async () => {
    const trimmed = destination.trim();
    if (!trimmed) {
      setError('Enter a Bitcoin address');
      return;
    }
    const parsed = await wallet.parse(trimmed).catch(e => e as unknown);
    const address = parsed instanceof Error ? undefined : destinationAddressOf(parsed as InputType);
    if (!address) {
      setError(destinationErrorMessage(parsed, 'That is not an on-chain Bitcoin address'));
      return;
    }
    setDestination(address);
    setError(null);
    goTo('fee');
  }, [destination, wallet, goTo]);

  const fields: DestinationFields = { destination, onChange: setDestination, error };
  return { fields, submitDestination };
}

/** `replaced` is what the build replaces on the network: a kept recovery for a bump, or the exit under way. */
function useFeeRates(chain: ChainClient, phase: UnilateralExitPhase, replaced: UnilateralExitPlan | null) {
  // As the network gives them, before any floor.
  const [networkRates, setNetworkRates] = useState<FeeRates | null>(null);
  const [feeChoice, setFeeChoice] = useState<FeeChoice>('medium');

  useEffect(() => {
    if (phase !== 'fee' || networkRates) return;
    let cancelled = false;
    chain
      .feeRates()
      .catch(e => {
        logger.warn(LogCategory.SDK, 'Failed to read fee rates', { error: formatError(e) });
        return FALLBACK_FEE_RATES;
      })
      .then(rates => {
        if (!cancelled) setNetworkRates(rates);
      });
    return () => {
      cancelled = true;
    };
  }, [phase, networkRates, chain]);

  // No rate at or below what the build replaces: the network refuses it.
  const floor = replaced ? replaced.feeRateSatPerVbyte + 1 : 0;
  const feeRates = useMemo(() => networkRates && liftRates(networkRates, floor), [networkRates, floor]);
  const forgetRates = useCallback(() => setNetworkRates(null), []);
  const fields: FeeFields = { feeRates, feeChoice, effectiveFeeRate: feeRates?.[feeChoice] ?? 0, onSelect: setFeeChoice };
  return { fields, forgetRates, networkSlowRate: networkRates?.slow ?? null };
}

interface QuoteInputs {
  wallet: BreezSdk;
  walletKey: WalletKey | null;
  chain: ChainClient;
  engine: Pick<UnilateralExitEngineState, 'plan' | 'pending' | 'recoveries' | 'archive' | 'accounting'>;
  mode: ExitMode | undefined;
  bumping: boolean;
  bumpTarget: UnilateralExitPlan | null;
  phase: UnilateralExitPhase;
  goTo: (phase: UnilateralExitPhase) => void;
}

export function useExitQuote({ wallet, walletKey, chain, engine, mode, bumping, bumpTarget, phase, goTo }: QuoteInputs) {
  const { plan, pending, recoveries, archive, accounting } = engine;
  const { fields: destinationFields, submitDestination } = useDestination(wallet, (plan ?? pending)?.destination ?? '', goTo);
  const { fields: feeFields, forgetRates, networkSlowRate } = useFeeRates(chain, phase, bumping ? bumpTarget : plan);
  const { destination } = destinationFields;
  const { effectiveFeeRate } = feeFields;

  const [quote, setQuote] = useState<PrepareRecoverFundsResponse | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const quoteRequest = useRef(0);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quotedAt, setQuotedAt] = useState<number | null>(null);
  // startError, shortfall and splitOff are what building this quote found,
  // held here so the next request clears them.
  const [startError, setStartError] = useState<string | null>(null);
  // Only the build knows what an exit still needs, and it says so by refusing.
  // Held with the inputs it had, for this quote's rate.
  const [shortfall, setShortfall] = useState<Funding | null>(null);
  // The co-signed part of a mixed recovery went out on its own, or failed to,
  // so the exit fee pays for the rest alone.
  const [splitOff, setSplitOff] = useState(false);

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
        const dropped = prepared.skipped.filter(leaf => leaf.reason.type === 'notRecoverable' && !isProvisionalSkip(leaf, prepared));
        noteDropped(walletKey, dropped.map(({ leafId, valueSats }) => ({ leafId, valueSats })));
      }
      // Preparing records a recovery the SDK finds in a block, but the total only
      // drops at the next sync, so until then the row still offers those funds.
      if (mode === 'recover' && !plan && prepared.leaves.length === 0 && prepared.skipped.length === 0) {
        void wallet.syncWallet({}).catch(e => logger.warn(LogCategory.SDK, 'Sync after an empty quote failed', { error: formatError(e) }));
      }
    } catch (e) {
      if (request !== quoteRequest.current) return;
      logger.error(LogCategory.SDK, 'Failed to quote unilateral exit', { error: formatError(e) });
      setQuoteError(formatError(e));
      setQuote(null);
    } finally {
      if (request === quoteRequest.current) setIsQuoting(false);
    }
  }, [wallet, destination, effectiveFeeRate, walletKey, plan, mode, recoveries, archive, accounting, bumping, bumpTarget]);

  const submitFee = useCallback(async () => {
    goTo('quote');
    await refreshQuote();
  }, [goTo, refreshQuote]);

  // An exit under way sets no floor on a bump's figures, which are its own.
  const resuming = bumping ? null : plan;
  const figures = useMemo(() => (quote ? quoteFigures(quote, { resuming }) : null), [quote, resuming]);

  const forgetQuote = useCallback(() => {
    setQuote(null);
    setQuoteError(null);
    // The rates read when the page opened can be hours old by now.
    forgetRates();
  }, [forgetRates]);

  const quoteFields: QuoteFields = { quote, figures, isQuoting, error: quoteError };
  return {
    destination: destinationFields,
    fee: feeFields,
    networkSlowRate,
    quote: quoteFields,
    quotedAt,
    startError,
    setStartError,
    shortfall,
    setShortfall,
    splitOff,
    setSplitOff,
    submitDestination,
    submitFee,
    forgetQuote,
  };
}
