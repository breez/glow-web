import { useMemo, useState } from 'react';
import type { PrepareRecoverFundsResponse } from '@breeztech/breez-sdk-spark';
import { useWallet, useWalletInfo } from '@/contexts/WalletContext';
import { createChainClient } from '@/services/chain';
import type { FeeRates } from '@/services/chain';
import type { ExitMode, UnilateralExitPlan, WalletKey } from '../model/plan';
import type { TopUp } from '../exitFee';
import type { UnilateralExitEngineState } from '../engine/state';
import { recoveryTxid } from '../storage/archive';
import type { QuoteFigures } from '../quote';
import { useContinueExit } from './useContinueExit';
import { useExitBuild } from './useExitBuild';
import { useExitFeeAddress, useFeeKey } from './useExitFeeAddress';
import { useExitQuote } from './useExitQuote';
import { useExitWizard, type UnilateralExitPhase } from './useExitWizard';
import { useUnilateralExitEngineState } from './useUnilateralExitEngineLifecycle';

export type FeeChoice = 'slow' | 'medium' | 'fast';

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
  /** The fee address already holds the quote's exit fee, left there by an earlier exit. */
  feeAlreadyHeld: boolean;
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

function useBumpTarget(bumpTxid: string | undefined, recoveries: UnilateralExitPlan[]) {
  // A snapshot: a retry can swap the recovery's transaction while the sheet is
  // open, but not its leaves, address or rate.
  const [bumpTarget] = useState(() => (bumpTxid ? (recoveries.find(r => recoveryTxid(r) === bumpTxid) ?? null) : null));
  const bumpedTxid = useMemo(() => {
    const ids = new Set(bumpTarget?.exit.leaves.map(leaf => leaf.leafId));
    const holder = recoveries.find(r => r.exit.leaves.some(leaf => ids.has(leaf.leafId)));
    return holder ? recoveryTxid(holder) : null;
  }, [bumpTarget, recoveries]);
  // Every bump branch keys on the prop, so a bump never falls through to the
  // exit's quote or plan slot, whether or not its recovery is still there.
  return { bumping: !!bumpTxid, bumpTarget, bumpedTxid };
}

/**
 * `openedMode` is what the sheet was opened for: `recover` from the Recoverable
 * Funds row. `bumpTxid` is a kept co-signed recovery to build again at a
 * higher fee, from its tracker.
 */
export function useUnilateralExitFlow(network: string, openedMode?: ExitMode, bumpTxid?: string): UnilateralExitFlow {
  const wallet = useWallet();
  const identityPubkey = useWalletInfo()?.identityPubkey;
  const walletKey = useMemo<WalletKey | null>(
    () => (identityPubkey ? { identityPubkey, network } : null),
    [identityPubkey, network],
  );
  const chain = useMemo(() => createChainClient(network), [network]);
  const engine = useUnilateralExitEngineState();
  const { plan, pending } = engine;
  const { bumping, bumpTarget, bumpedTxid } = useBumpTarget(bumpTxid, engine.recoveries);
  // A saved record keeps what it is, whichever row opened the sheet.
  const mode = bumping ? 'recover' : plan ? plan.mode : pending ? pending.mode : openedMode;

  const feeKey = useFeeKey();
  const { phase, canGoBack, goTo, back } = useExitWizard({ plan, pending, mode, bumping, holdsFeeKey: !!feeKey.key });
  const quoting = useExitQuote({ wallet, walletKey, chain, engine, mode, bumping, bumpTarget, phase, goTo });
  const feeAddress = useExitFeeAddress({ walletKey, network, chain, engine, mode, phase, goTo, feeKey, quoting });
  const continuing = useContinueExit({ wallet, walletKey, chain, engine });
  const building = useExitBuild({
    wallet,
    walletKey,
    network,
    plan,
    mode,
    bumping,
    bumpTarget,
    phase,
    goTo,
    quoting,
    feeKey,
    feeAddress,
    continuing,
  });

  return {
    phase,
    mode,
    engine,
    canGoBack,
    destination: quoting.destination,
    fee: quoting.fee,
    quote: quoting.quote,
    funding: feeAddress.funding,
    submitDestination: quoting.submitDestination,
    submitFee: quoting.submitFee,
    continueFromQuote: building.continueFromQuote,
    startError: quoting.startError,
    feeAlreadyHeld: feeAddress.feeAlreadyHeld,
    unlock: feeAddress.unlock,
    unlockError: feeAddress.unlockError,
    build: building.build,
    buildError: building.buildError,
    sentSat: building.sentSat,
    bumping,
    bumpedTxid,
    rebuild: building.rebuild,
    continueExit: continuing.continueExit,
    isContinuing: continuing.isContinuing,
    continueError: continuing.continueError,
    goTo,
    back,
  };
}
