import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChainClient, ChainUtxo } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';
import { awaitsUpdate, isUnilateralLanded, type ExitMode, type UnilateralExitPlan, type WalletKey } from '../model/plan';
import { lastReadCoins, leftoverTopUp, readFeeAddress, sentFunding, topUpFor, withoutOwnChange } from '../exitFee';
import { setPendingExit } from '../engine/api';
import type { UnilateralExitEngineState } from '../engine/state';
import { deriveFundingKey, readWalletMnemonic, type FundingKey } from '../funding';
import { exitFeeRecordOf, exitFeeSat, needsFunding, quoteFigures } from '../quote';
import type { useExitQuote } from './useExitQuote';
import type { UnilateralExitPhase } from './useExitWizard';
import type { FundingFields } from './useUnilateralExitFlow';

const FUNDING_POLL_MS = 15_000;

// Held apart from useExitFeeAddress: the wizard reads it to pick a fee screen,
// and that hook needs the phase the wizard picks.
export function useFeeKey() {
  const [key, setKey] = useState<FundingKey | null>(null);
  const mnemonicRef = useRef<string | null>(null);

  useEffect(() => () => {
    mnemonicRef.current = null;
  }, []);

  const hold = useCallback((next: FundingKey, mnemonic: string) => {
    mnemonicRef.current = mnemonic;
    setKey(next);
  }, []);
  const holdsPhrase = useCallback(() => !!mnemonicRef.current, []);
  const forgetPhrase = useCallback(() => {
    mnemonicRef.current = null;
  }, []);
  return { key, hold, holdsPhrase, forgetPhrase };
}

function leftoverFundingOf(plan: UnilateralExitPlan | null, coins: ChainUtxo[]): FundingFields | null {
  if (plan?.status.type !== 'needsExitFee') return null;
  const address = exitFeeRecordOf(plan).exitFeeAddress;
  // With no address yet, the tap derives it and asks again. A payment on its
  // way counts toward the ask, as on the list row, so it is not asked for
  // twice; only confirmed coins fund the build.
  const asked = address ? leftoverTopUp(plan, coins) : null;
  const paid = !address || leftoverTopUp(plan, coins.filter(coin => coin.confirmed)).stillToSendSat === 0;
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
}

interface FeeAddressInputs {
  walletKey: WalletKey | null;
  network: string;
  chain: ChainClient;
  engine: Pick<UnilateralExitEngineState, 'plan' | 'pendingCoins' | 'archive'>;
  mode: ExitMode | undefined;
  phase: UnilateralExitPhase;
  goTo: (phase: UnilateralExitPhase) => void;
  feeKey: Pick<ReturnType<typeof useFeeKey>, 'key' | 'hold'>;
  quoting: Pick<ReturnType<typeof useExitQuote>, 'quote' | 'networkSlowRate' | 'quotedAt' | 'shortfall' | 'splitOff'>;
}

export function useExitFeeAddress({ walletKey, network, chain, engine, mode, phase, goTo, feeKey, quoting }: FeeAddressInputs) {
  const { plan, pendingCoins, archive } = engine;
  const { key: fundingKey, hold } = feeKey;
  const { quote } = quoting.quote;
  const { networkSlowRate, quotedAt, shortfall, splitOff } = quoting;
  const [fundingUtxos, setFundingUtxos] = useState<ChainUtxo[]>([]);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  useEffect(() => {
    if ((phase !== 'fund' && phase !== 'topUp') || !fundingKey) return;
    let cancelled = false;
    const check = async () => {
      try {
        const utxos = await readFeeAddress(chain, fundingKey.address);
        if (!cancelled) setFundingUtxos(utxos);
      } catch (e) {
        logger.warn(LogCategory.SDK, 'Failed to read funding utxos', { error: formatError(e) });
        // What the address last held, so a payment already made still counts.
        const known = lastReadCoins(fundingKey.address);
        if (known && !cancelled) setFundingUtxos(known);
      }
    };
    void check();
    const timer = setInterval(() => void check(), FUNDING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, fundingKey, chain]);

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
        hold(key, mnemonic);
        goTo('fund');
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
          movedSat: splitOff ? figures.balanceSat : figures.fundsSat,
          mode,
        },
        key,
      );
      goTo('pending');
    } catch (e) {
      setUnlockError(formatError(e));
    }
  }, [walletKey, quote, network, planFundingIndex, splitOff, mode, hold, goTo]);

  const confirmedUtxos = useMemo(() => fundingUtxos.filter(utxo => utxo.confirmed), [fundingUtxos]);
  const sent = useMemo(() => sentFunding(plan, confirmedUtxos), [plan, confirmedUtxos]);
  // A payment on its way counts toward the ask, as on the pending exit's
  // screen, so it is not asked for twice; only confirmed coins fund the build.
  const sentSoFar = useMemo(() => sentFunding(plan, withoutOwnChange(plan, fundingUtxos)), [plan, fundingUtxos]);
  const topUp = shortfall && quote ? topUpFor(shortfall, sentSoFar, quote.feeRateSatPerVbyte) : null;
  // An exit under way is not held to its quote: most of what the quote covers
  // is already on-chain, and only the build knows what is really needed. Once a
  // build has said what it needs, the address has to hold it.
  const isFunded = quote !== null && (!shortfall || topUpFor(shortfall, sent, quote.feeRateSatPerVbyte).stillToSendSat === 0);

  // The wizard's fee screen holds its own key and quote. A leftover's has
  // neither: it shows what the plan asks for at its own address and rate,
  // against the confirmed coins the engine read there.
  const wizardFunding: FundingFields | null = fundingKey && {
    address: fundingKey.address,
    isFunded,
    topUp,
    waitsForConfirmation: !!topUp && topUp.stillToSendSat === 0 && !isFunded,
    feeRate: quote?.feeRateSatPerVbyte ?? 0,
    currentFeeRate: plan?.feeRateSatPerVbyte ?? null,
    // The slowest rate the network is taking: above the exit's own rate, the
    // exit is stalled by fees rather than by the rate the user just picked.
    networkFloorFeeRate: plan && awaitsUpdate(plan) ? null : networkSlowRate,
    quotedAt,
  };
  const leftoverFunding = useMemo(() => leftoverFundingOf(plan, pendingCoins), [plan, pendingCoins]);

  // Every exit pays from one address, so coins an earlier one left there count
  // toward this quote's fee. The address comes from the last finished exit's
  // record: deriving it would need the phrase, which a review does not ask for.
  const asksFee = !!quote && needsFunding(quote);
  const knownAddress = plan ? undefined : archive.find(exit => exit.exitFeeAddress)?.exitFeeAddress;
  const [knownCoins, setKnownCoins] = useState<ChainUtxo[] | null>(null);
  useEffect(() => {
    if (phase !== 'quote' || !asksFee || !knownAddress) return;
    let cancelled = false;
    readFeeAddress(chain, knownAddress)
      .catch(e => {
        logger.warn(LogCategory.SDK, 'Failed to read the exit fee address', { error: formatError(e) });
        return lastReadCoins(knownAddress) ?? null;
      })
      .then(coins => {
        if (!cancelled) setKnownCoins(coins);
      });
    return () => {
      cancelled = true;
    };
  }, [phase, asksFee, knownAddress, chain]);
  const feeAlreadyHeld =
    asksFee &&
    !!quote &&
    !!knownAddress &&
    !!knownCoins &&
    topUpFor({ sat: exitFeeSat(quote), inputs: 1 }, sentFunding(null, knownCoins), quote.feeRateSatPerVbyte).stillToSendSat === 0;

  return { funding: wizardFunding ?? leftoverFunding, unlock, unlockError, confirmedUtxos, sent, feeAlreadyHeld };
}
