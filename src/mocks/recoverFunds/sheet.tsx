// THROWAWAY: exit-sheet shots for ?recovermock. Each one is the exit sheet's
// frame around the real step components, fed fixture figures.
// The shot registries export records of components; fast refresh does not matter here.
/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useRef, useState } from 'react';
import type { BreezSdk, UnilateralExitTransaction } from '@breeztech/breez-sdk-spark';
import {
  BottomSheetCard,
  BottomSheetContainer,
  CopyableRow,
  DialogHeader,
  ErrorMessageBox,
  PrimaryButton,
} from '@/components/ui';
import { AlertCard, SimpleAlert } from '@/components/AlertCard';
import { DestinationField } from '@/components/DestinationField';
import { FeeBreakdownCard, type FeeBreakdownItem } from '@/components/FeeBreakdownCard';
import { FeeRateSelector, type FeeSpeed } from '@/components/FeeRateSelector';
import { SatAmount } from '@/components/SatAmount';
import { WalletProvider, useWalletConnection } from '@/contexts/WalletContext';
import { willReceiveSat } from '@/features/unilateral-exit/driver';
import { QuoteStep } from '@/features/unilateral-exit/steps/QuoteStep';
import { PendingExitStep, Receipt, Status } from '@/features/unilateral-exit/steps/FundStep';
import { TrackerView } from '@/features/unilateral-exit/TrackerView';
import { blocked, coin, locked, pendingExit, plan, prepared, tx } from '@/features/unilateral-exit/testFixtures';
import { truncateAddress } from '@/utils/crossChainFormat';
import {
  BUMP,
  COSIGNED,
  DESTINATION,
  DEV_EXIT,
  DUST_SAT,
  EXIT_FEE_ADDRESS,
  FEE_RATES,
  MIXED,
  NETWORK,
  STRANDED,
} from './fixtures';
import { afterCosigned, keptRecovery, seedPending, seedPlan, type WalletScene } from './wallet';

const noop = () => {};

/** A chain tip for the tracker; its figures only matter relative to each other. */
const TIP_HEIGHT = 915_000;
/** A refund's CSV delay that puts the whole exit about 5 days out (703 blocks). */
const REFUND_CSV_BLOCKS = 700;
const STRANDED_LEAVES = [
  { leafId: 'leaf-1', value: 60_000 },
  { leafId: 'leaf-2', value: 40_000 },
  { leafId: 'leaf-3', value: 20_000 },
];

// BackupActions under Advanced reads the wallet. Provided here only when the
// page around the sheet does not, so a shot never depends on that.
const stubSdk = new Proxy({}, { get: () => async () => undefined }) as unknown as BreezSdk;
const WithWallet: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  useWalletConnection().sdk ? <>{children}</> : <WalletProvider client={stubSdk} isConnected>{children}</WalletProvider>;

/** UnilateralExitPage's frame: header, the 62dvh scroller, and the CTA row outside it. */
export const MockSheet: React.FC<{
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
export const WithShare: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useState(() => {
    if (!navigator.share) Object.defineProperty(navigator, 'share', { value: async () => {}, configurable: true });
  });
  return <>{children}</>;
};

export const Destination: React.FC = () => {
  const [destination, setDestination] = useState(DESTINATION);
  return (
    <DestinationField destination={destination} onChange={setDestination} error={null} onSubmit={noop} onScanQr={noop} />
  );
};

/** Recover mode's fee step: each option shows what that speed costs in ₿. */
const FeeOptions: React.FC<{ feeBySpeed: Record<FeeSpeed, number>; approximate?: boolean }> = ({
  feeBySpeed,
  approximate = false,
}) => {
  const [speed, setSpeed] = useState<FeeSpeed>('medium');
  return (
    <FeeRateSelector
      selected={speed}
      onSelect={setSpeed}
      detail={s => <SatAmount sats={feeBySpeed[s]} approximate={approximate} />}
    />
  );
};

/** QuoteStep's normal state, built from the same blocks with recover mode's rows and alert. */
const Review: React.FC<{
  willReceiveSat: number;
  approximate?: boolean;
  items: FeeBreakdownItem[];
  alert?: React.ReactNode;
  error?: { title: string; body: string };
}> = ({ willReceiveSat, approximate = false, items, alert, error }) => (
  <div className="space-y-4">
    <div className="text-center py-2">
      <p className="text-spark-text-muted text-sm mb-2">You&apos;ll receive</p>
      <SatAmount
        sats={willReceiveSat}
        approximate={approximate}
        className="text-4xl font-bold text-spark-text-primary"
      />
    </div>
    <CopyableRow label="To address" value={DESTINATION} display={truncateAddress(DESTINATION, 32)} />
    <FeeBreakdownCard items={items} />
    {alert && (
      <SimpleAlert variant="warning" hideIcon>
        {alert}
      </SimpleAlert>
    )}
    {error && <ErrorMessageBox title={error.title} error={error.body} />}
  </div>
);

const cosignedItems: FeeBreakdownItem[] = [
  { label: 'Funds', value: COSIGNED.totalSat },
  { label: 'Network fee', value: COSIGNED.networkFeeSat },
];

const CosignedReview: React.FC<{ error?: { title: string; body: string } }> = ({ error }) => (
  <Review willReceiveSat={COSIGNED.willReceiveSat} items={cosignedItems} error={error} />
);

const strandedPending = pendingExit({
  network: NETWORK,
  destination: DESTINATION,
  feeRateSatPerVbyte: FEE_RATES.medium,
  fundingAddress: EXIT_FEE_ADDRESS,
  required: { sat: STRANDED.exitFeeSat, inputs: 1 },
  willReceiveSat: STRANDED.willReceiveSat,
  mode: 'recover',
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
    network: NETWORK,
    destination: DESTINATION,
    feeRateSatPerVbyte: FEE_RATES.medium,
    quotedSweepFeeSat: STRANDED.networkFeeSat,
    quotedExitFeeSat: STRANDED.exitFeeSat,
    exit: { leaves: STRANDED_LEAVES, recoverableValueSat: STRANDED.totalSat },
    mode: 'recover',
  });
})();

/** Today's `auto` quote moves the wallet's balance and nothing outside it. */
export const devQuote = prepared({
  leaves: DEV_EXIT.leaves,
  recoverableValueSat: DEV_EXIT.balanceSat,
  sweepFeeSat: DEV_EXIT.sweepFeeSat,
  singleUtxoFundingSat: DEV_EXIT.exitFeeSat,
  totalFeeSat: DEV_EXIT.sweepFeeSat + DEV_EXIT.exitFeeSat,
  feeRateSatPerVbyte: FEE_RATES.medium,
  destination: DESTINATION,
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
      <FeeOptions feeBySpeed={COSIGNED.feeBySpeed} />
    </MockSheet>
  ),

  '04-review-cosigned': () => (
    <MockSheet back cta="Recover Funds">
      <CosignedReview />
    </MockSheet>
  ),

  '05-sent': () => (
    <MockSheet cta="Done">
      <Receipt title="Funds sent">
        <Status>
          <SatAmount sats={COSIGNED.willReceiveSat} /> on its way
        </Status>
      </Receipt>
    </MockSheet>
  ),

  '07-review-stranded': () => (
    <MockSheet back cta="Continue">
      <Review
        willReceiveSat={STRANDED.willReceiveSat}
        approximate
        items={[
          { label: 'Funds', value: STRANDED.totalSat },
          { label: 'Network fee', value: STRANDED.networkFeeSat, approximate: true },
          { label: 'Exit fee', value: STRANDED.exitFeeSat, highlight: true },
        ]}
        alert={
          <>
            To start the recovery you need to pay the exit fee from another wallet. These are the mining fees
            that move your funds on-chain, which takes several days.
          </>
        }
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

  // The expanded step outgrows the 62dvh cap, so its Advanced rows get their own shot.
  '08b-pending-owed-advanced': () => (
    <WithShare>
      <MockSheet>
        <ExpandAdvanced>
          <OwedStep />
        </ExpandAdvanced>
      </MockSheet>
    </WithShare>
  ),

  '09-pending-funded': () => (
    <MockSheet cta="Recover Funds">
      <PendingExitStep
        pending={strandedPending}
        coins={[coin(STRANDED.exitFeeSat, true)]}
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
      <Review
        willReceiveSat={MIXED.willReceiveSat}
        approximate
        items={[
          { label: 'Funds', value: MIXED.totalSat },
          { label: 'Network fee', value: MIXED.networkFeeSat, approximate: true },
          { label: 'Exit fee', value: MIXED.exitFeeSat, highlight: true },
        ]}
        alert={
          <>
            <SatAmount sats={COSIGNED.willReceiveSat} /> goes to this address now. The other{' '}
            <SatAmount sats={STRANDED.willReceiveSat} approximate /> needs the exit fee from another wallet, then takes several
            days.
          </>
        }
      />
    </MockSheet>
  ),

  '14-review-error': () => (
    <MockSheet back cta="Recover Funds">
      <CosignedReview error={{ title: 'Could not recover the funds', body: 'Please try again.' }} />
    </MockSheet>
  ),

  // The FeeExceedsValue case. A FundsNotFound or NotRecoverable skip would need other copy.
  '15-fee-nothing-worth': () => (
    <MockSheet back>
      <AlertCard variant="warning" title="Nothing is worth recovering right now">
        <p className="text-sm">
          At today&apos;s fee rates these funds would cost more to move on-chain than they are worth. Try again
          once the network is cheaper.
        </p>
      </AlertCard>
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
      <FeeOptions feeBySpeed={BUMP.feeBySpeed} />
    </MockSheet>
  ),

  '19-bump-review': () => (
    <MockSheet back cta="Continue Recovery">
      <Review
        willReceiveSat={BUMP.willReceiveSat}
        items={[
          { label: 'Funds', value: BUMP.fundsSat },
          { label: 'Network fee', value: BUMP.networkFeeSat },
        ]}
      />
    </MockSheet>
  ),

  '20a-dev-exit-quote-today': () => (
    <MockSheet title="Unilateral Exit" back cta="Continue">
      <QuoteStep
        quote={devQuote}
        sweepFeeSat={DEV_EXIT.sweepFeeSat}
        willReceiveSat={willReceiveSat(devQuote)}
        isQuoting={false}
        error={null}
        leftBehindSat={0}
      />
    </MockSheet>
  ),

  '20b-dev-exit-quote-proposed': () => (
    <MockSheet title="Unilateral Exit" back cta="Continue">
      <Review
        willReceiveSat={DEV_EXIT.proposed.willReceiveSat}
        approximate
        items={[
          { label: 'Funds', value: DEV_EXIT.proposed.fundsSat },
          { label: 'Network fee', value: DEV_EXIT.proposed.networkFeeSat, approximate: true },
          { label: 'Exit fee', value: DEV_EXIT.exitFeeSat, highlight: true },
        ]}
        alert={
          <>
            To start the process you need to pay the exit fee. These are the mining fees required to move the
            Spark tree on-chain.
          </>
        }
      />
    </MockSheet>
  ),
};

// The stranded funds stay recoverable until their sweep confirms and is read back; a saved exit or plan hides the row.
const stranded = (seed?: () => void): WalletScene => ({ recoverableFundsSats: STRANDED.totalSat, seed });

/** The wallet page behind each sheet, where it differs from shot 01's. */
export const sheetScenes: Record<string, WalletScene> = {
  '05-sent': afterCosigned,
  '07-review-stranded': stranded(),
  '08-pending-owed': stranded(seedPending(strandedPending)),
  '08b-pending-owed-advanced': stranded(seedPending(strandedPending)),
  '09-pending-funded': stranded(seedPending(strandedPending, [coin(STRANDED.exitFeeSat, true)])),
  '10-tracker-stranded': stranded(seedPlan(strandedPlan, TIP_HEIGHT)),
  '12-review-mixed': { recoverableFundsSats: MIXED.totalSat },
  '15-fee-nothing-worth': { recoverableFundsSats: DUST_SAT },
  // A bump opens from the recovery's tracker, so the page is shot 06's, hours later.
  '17-tracker-bump': afterCosigned,
  '18-bump-fee': afterCosigned,
  '19-bump-review': afterCosigned,
};
