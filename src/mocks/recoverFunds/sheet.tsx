// THROWAWAY: exit-sheet shots for ?recovermock. Each one is the exit sheet's
// frame around the real step components, fed fixture quotes.
// The shot registries export records of components; fast refresh does not matter here.
/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useRef, useState } from 'react';
import type { BreezSdk, PrepareUnilateralExitResponse, UnilateralExitTransaction } from '@breeztech/breez-sdk-spark';
import { BottomSheetCard, BottomSheetContainer, DialogHeader, PrimaryButton } from '@/components/ui';
import { DestinationField } from '@/components/DestinationField';
import { FeeRateSelector, type FeeSpeed } from '@/components/FeeRateSelector';
import { SatAmount } from '@/components/SatAmount';
import { WalletProvider, useWalletConnection } from '@/contexts/WalletContext';
import { exitFeeSat, quoteFigures, quotedSweepFeeSat } from '@/features/unilateral-exit/quote';
import { RecoverReviewStep } from '@/features/unilateral-exit/steps/RecoverReviewStep';
import { PendingExitStep, Receipt, Status } from '@/features/unilateral-exit/steps/FundStep';
import { TrackerView } from '@/features/unilateral-exit/TrackerView';
import { blocked, coin, locked, plan, ready, tx } from '@/features/unilateral-exit/testFixtures';
import {
  BUMP_RATES,
  COSIGNED_QUOTE,
  DESTINATION,
  DUST_QUOTE,
  DUST_SAT,
  FEE_RATES,
  LEFT_OUT_QUOTE,
  MIXED_QUOTE,
  NETWORK,
  STRANDED_LEAVES,
  STRANDED_QUOTE,
  STRANDED_SAT,
  SWEEP_ONLY_QUOTE,
  cosignedQuote,
} from './fixtures';
import { afterCosigned, keptRecovery, seedPlan, seedPending, strandedPending, type WalletScene } from './wallet';

const noop = () => {};

/** A chain tip for the tracker; its figures only matter relative to each other. */
const TIP_HEIGHT = 915_000;
/** A refund's CSV delay that puts the whole exit about 5 days out (703 blocks). */
const REFUND_CSV_BLOCKS = 700;

// BackupActions under Advanced reads the wallet. Provided here only when the
// page around the sheet does not, so a shot never depends on that.
const stubSdk = new Proxy({}, { get: () => async () => undefined }) as unknown as BreezSdk;
const WithWallet: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  useWalletConnection().sdk ? <>{children}</> : <WalletProvider client={stubSdk} isConnected>{children}</WalletProvider>;

/** UnilateralExitPage's frame: header, the 62dvh scroller, and the CTA row outside it. */
const MockSheet: React.FC<{
  title?: string;
  back?: boolean;
  /** The destination step's quick actions sit 16pt above the CTA, every other step 24pt. */
  destination?: boolean;
  cta?: string;
  children: React.ReactNode;
}> = ({ title = 'Recover Funds', back = false, destination = false, cta, children }) => (
  <WithWallet>
    <BottomSheetContainer isOpen onClose={noop} zIndex={70} showBackdrop>
      <BottomSheetCard>
        <DialogHeader title={title} onClose={noop} onBack={back ? noop : undefined} />
        <div
          className="space-y-6 max-h-[62dvh] overflow-y-auto overscroll-y-none touch-pan-y"
          data-mock-scroller
        >
          {children}
        </div>
        {cta && (
          <div className={destination ? 'pt-4' : 'pt-6'}>
            <PrimaryButton onClick={noop} className="w-full">
              {cta}
            </PrimaryButton>
          </div>
        )}
      </BottomSheetCard>
    </BottomSheetContainer>
  </WithWallet>
);

/**
 * Opens the step's "Advanced" once the sheet has finished opening: the sheet
 * re-fits to grown content only after that. The expanded step is taller than
 * the 62dvh cap, so it then scrolls to the end, as a user would.
 */
const ExpandAdvanced: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const toggle = [...(ref.current?.querySelectorAll('button') ?? [])].find(b => b.textContent === 'Advanced');
      toggle?.click();
      setTimeout(() => {
        const scroller = ref.current?.closest<HTMLElement>('[data-mock-scroller]');
        scroller?.scrollTo({ top: scroller.scrollHeight });
      }, 150);
    }, 700);
    return () => clearTimeout(timer);
  }, []);
  return <div ref={ref}>{children}</div>;
};

/** A phone offers Share beside Copy; headless Chromium has no navigator.share, so lend it one. */
const WithShare: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useState(() => {
    if (!navigator.share) Object.defineProperty(navigator, 'share', { value: async () => {}, configurable: true });
  });
  return <>{children}</>;
};

const Destination: React.FC = () => {
  const [destination, setDestination] = useState(DESTINATION);
  return (
    <DestinationField destination={destination} onChange={setDestination} error={null} onSubmit={noop} onScanQr={noop} />
  );
};

/** Recover mode's fee step: each speed shows what its quote takes off the funds. */
const FeeOptions: React.FC<{ rates: Record<FeeSpeed, number> }> = ({ rates }) => {
  const [speed, setSpeed] = useState<FeeSpeed>('medium');
  return (
    <FeeRateSelector
      selected={speed}
      onSelect={setSpeed}
      detail={s => <SatAmount sats={quoteFigures(cosignedQuote(rates[s])).networkFeeSat} />}
    />
  );
};

const Review: React.FC<{ quote: PrepareUnilateralExitResponse; error?: string }> = ({ quote, error }) => (
  <RecoverReviewStep figures={quoteFigures(quote)} destination={quote.destination} error={error} />
);

const strandedMeta = (quote: PrepareUnilateralExitResponse) => ({
  network: NETWORK,
  destination: quote.destination,
  feeRateSatPerVbyte: quote.feeRateSatPerVbyte,
  quotedSweepFeeSat: quotedSweepFeeSat(quote, null),
  quotedExitFeeSat: exitFeeSat(quote),
  mode: 'recover' as const,
});

/** A stranded recovery just started: three node transactions out now, their refunds and the sweep behind them. */
const strandedPlan = (() => {
  const nodes = STRANDED_LEAVES.map((_, i) =>
    tx({ txid: `node-${i + 1}`, kind: 'node', nodeId: `node-${i + 1}`, status: locked(TIP_HEIGHT) }),
  );
  const refunds = STRANDED_LEAVES.map((leaf, i) =>
    tx({
      txid: `refund-${i + 1}`,
      kind: 'refund',
      nodeId: leaf.leafId,
      dependsOn: [`node-${i + 1}`],
      csvTimelockBlocks: REFUND_CSV_BLOCKS,
      status: blocked,
    }),
  );
  const sweep = tx({ txid: 'sweep', kind: 'sweep', dependsOn: refunds.map(r => r.txid), status: blocked });
  const transactions: UnilateralExitTransaction[] = [...nodes, ...refunds, sweep];
  return plan(transactions, {
    ...strandedMeta(STRANDED_QUOTE),
    exit: { leaves: STRANDED_LEAVES, recoverableValueSat: STRANDED_SAT },
  });
})();

/** The same funds once only the sweep was left: built straight from the review, nothing funded. */
const sweepOnlyPlan = plan([tx({ txid: 'sweep', kind: 'sweep', status: ready })], {
  ...strandedMeta(SWEEP_ONLY_QUOTE),
  exit: { leaves: STRANDED_LEAVES, recoverableValueSat: STRANDED_SAT, fundingInputs: [] },
});

const OwedStep: React.FC = () => (
  <PendingExitStep
    pending={strandedPending}
    coins={[]}
    nothingToExit={false}
    isStarting={false}
    startError={null}
    onCancel={noop}
    cancelLabel="Cancel recovery"
  />
);

export const sheetShots: Record<string, React.FC> = {
  '02-destination': () => (
    <MockSheet destination cta="Continue">
      <Destination />
    </MockSheet>
  ),

  '03-fee-cosigned': () => (
    <MockSheet back cta="Continue">
      <FeeOptions rates={FEE_RATES} />
    </MockSheet>
  ),

  '04-review-cosigned': () => (
    <MockSheet back cta="Recover Funds">
      <Review quote={COSIGNED_QUOTE} />
    </MockSheet>
  ),

  '04b-review-left-out': () => (
    <MockSheet back cta="Recover Funds">
      <Review quote={LEFT_OUT_QUOTE} />
    </MockSheet>
  ),

  '05-sent': () => (
    <MockSheet cta="Done">
      <Receipt title="Funds sent">
        <Status>
          <SatAmount sats={quoteFigures(COSIGNED_QUOTE).willReceiveSat} /> on its way
        </Status>
      </Receipt>
    </MockSheet>
  ),

  '07-review-stranded': () => (
    <MockSheet back cta="Continue">
      <Review quote={STRANDED_QUOTE} />
    </MockSheet>
  ),

  '07b-review-no-exit-fee': () => (
    <MockSheet back cta="Recover Funds">
      <Review quote={SWEEP_ONLY_QUOTE} />
    </MockSheet>
  ),

  '07c-running-no-exit-fee': () => (
    <MockSheet>
      <TrackerView
        plan={sweepOnlyPlan}
        tipHeight={TIP_HEIGHT}
        isAdvancing={false}
        onRebuild={noop}
        justStarted
        noun="recovery"
      />
    </MockSheet>
  ),

  '08-pending-owed': () => (
    <WithShare>
      <MockSheet>
        <OwedStep />
      </MockSheet>
    </WithShare>
  ),

  '09-pending-funded': () => (
    <MockSheet cta="Recover Funds">
      <PendingExitStep
        pending={strandedPending}
        coins={[coin(strandedPending.required.sat, true)]}
        nothingToExit={false}
        isStarting={false}
        startError={null}
        onCancel={noop}
        cancelLabel="Cancel recovery"
      />
    </MockSheet>
  ),

  '10-tracker-stranded': () => (
    <MockSheet>
      <TrackerView
        plan={strandedPlan}
        tipHeight={TIP_HEIGHT}
        isAdvancing={false}
        onRebuild={noop}
        justStarted
        noun="recovery"
      />
    </MockSheet>
  ),

  '12-review-mixed': () => (
    <MockSheet back cta="Recover Funds">
      <Review quote={MIXED_QUOTE} />
    </MockSheet>
  ),

  '14-review-error': () => (
    <MockSheet back cta="Recover Funds">
      <Review quote={COSIGNED_QUOTE} error="Please try again." />
    </MockSheet>
  ),

  '15-fee-nothing-worth': () => (
    <MockSheet back>
      <Review quote={DUST_QUOTE} />
    </MockSheet>
  ),

  // The bump opens from the kept recovery's own tracker, under its existing Advanced row.
  // Built directly: the list row's tap has no route to this tracker yet, and does nothing.
  '17-tracker-bump': () => (
    <MockSheet>
      <ExpandAdvanced>
        <TrackerView plan={keptRecovery} tipHeight={TIP_HEIGHT} isAdvancing={false} onRebuild={noop} noun="recovery" />
      </ExpandAdvanced>
    </MockSheet>
  ),

  '18-bump-fee': () => (
    <MockSheet cta="Continue">
      <FeeOptions rates={BUMP_RATES} />
    </MockSheet>
  ),

  '19-bump-review': () => (
    <MockSheet back cta="Continue Recovery">
      <Review quote={cosignedQuote(BUMP_RATES.medium)} />
    </MockSheet>
  ),
};

// The stranded funds stay recoverable until their sweep confirms and is read back; a saved exit or plan hides the row.
const stranded = (seed?: () => void): WalletScene => ({ recoverableFundsSats: STRANDED_SAT, seed });

/** The wallet page behind each sheet, where it differs from shot 01's. */
export const sheetScenes: Record<string, WalletScene> = {
  // getInfo counts the dust leaf the quote leaves out.
  '04b-review-left-out': { recoverableFundsSats: LEFT_OUT_QUOTE.recoverableValueSat + DUST_SAT },
  '05-sent': afterCosigned,
  '07-review-stranded': stranded(),
  '07b-review-no-exit-fee': stranded(),
  '07c-running-no-exit-fee': stranded(seedPlan(sweepOnlyPlan, TIP_HEIGHT)),
  '08-pending-owed': stranded(seedPending(strandedPending)),
  '09-pending-funded': stranded(seedPending(strandedPending, [coin(strandedPending.required.sat, true)])),
  '10-tracker-stranded': stranded(seedPlan(strandedPlan, TIP_HEIGHT)),
  '12-review-mixed': { recoverableFundsSats: MIXED_QUOTE.recoverableValueSat },
  '15-fee-nothing-worth': { recoverableFundsSats: DUST_SAT },
  // A bump opens from the recovery's tracker, so the page is shot 06's, hours later.
  '17-tracker-bump': afterCosigned,
  '18-bump-fee': afterCosigned,
  '19-bump-review': afterCosigned,
};
