import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BottomSheetCard,
  BottomSheetContainer,
  DialogHeader,
  ErrorMessageBox,
  LoadingSpinner,
  PrimaryButton,
} from '@/components/ui';
import { PinGate } from '@/components/PinEntry';
import QrScannerDialog from '@/components/QrScannerDialog';
import { useBackButton } from '@/hooks/useBackButton';
import { isPinEnabled } from '@/services/appLock';
import { canContinueFromQuote, useUnilateralExitFlow } from '@/features/unilateral-exit/hooks/useUnilateralExitFlow';
import { IntroStep } from '@/features/unilateral-exit/steps/IntroStep';
import { DestinationField } from '@/components/DestinationField';
import { FeeStep } from '@/features/unilateral-exit/steps/FeeStep';
import { QuoteStep } from '@/features/unilateral-exit/steps/QuoteStep';
import { FundStep, FundingStatus, PendingExitStep } from '@/features/unilateral-exit/steps/FundStep';
import { TrackerView } from '@/features/unilateral-exit/TrackerView';
import { sweepTxid } from '@/features/unilateral-exit/archive';
import { cancelPendingExit, startPendingExit } from '@/features/unilateral-exit/engine';
import { isPendingFunded } from '@/features/unilateral-exit/driver';

interface UnilateralExitPageProps {
  network: string;
  onBack: () => void;
  /** Where to go once the exit lands, since the tracker has nothing left to show. */
  onFinished: () => void;
}

const UnilateralExitPage: React.FC<UnilateralExitPageProps> = ({ network, onBack, onFinished }) => {
  const flow = useUnilateralExitFlow(network);

  // Reading the recovery phrase is gated on a PIN where one is set. Where none
  // is, the step passes straight through.
  const { unlock } = flow;
  const [gate, setGate] = useState<'pin' | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  // A sheet that opens on the tracker is one the user came back to. One that
  // moves to it has just started the exit.
  const [openedOnTracker] = useState(() => flow.phase === 'tracker');
  useEffect(() => {
    if (flow.phase !== 'unlock') return;
    let cancelled = false;
    void isPinEnabled().then(enabled => {
      if (cancelled) return;
      if (enabled) setGate('pin');
      else void unlock();
    });
    return () => {
      cancelled = true;
    };
  }, [flow.phase, unlock]);

  // Once the exit lands the wallet list carries it, so the sheet closes,
  // whatever the step. The signal is the exit's sweep reaching the archive.
  // The phase cannot serve: a tracker opened from the list is derived from the
  // plan, and without one it reads as the intro. Nor can a missing plan, which
  // is also what a stopped engine reports while the SDK reconnects.
  const { plan, archive } = flow.engine;
  const shownSweep = useRef<string | null>(null);
  useEffect(() => {
    if (plan) shownSweep.current = sweepTxid(plan);
    if (archive.some(exit => exit.id === shownSweep.current)) onFinished();
  }, [plan, archive, onFinished]);

  // One call to action per step, in the bar the rest of the app puts it in.
  // A step with nothing to press, such as the pin gate or the build, has none.
  const { canGoBack, back } = flow;
  useBackButton(
    useCallback(() => {
      if (!canGoBack) return false;
      back();
      return true;
    }, [canGoBack, back]),
    true,
  );

  const stepAction = (() => {
    switch (flow.phase) {
      case 'intro':
        return (
          <PrimaryButton onClick={() => flow.goTo('destination')} className="w-full" data-testid="unilateral-exit-start">
            Continue
          </PrimaryButton>
        );
      case 'destination':
        return (
          <PrimaryButton
            onClick={() => void flow.submitDestination()}
            disabled={!flow.destination.destination.trim()}
            className="w-full"
            data-testid="unilateral-exit-destination-continue"
          >
            Continue
          </PrimaryButton>
        );
      case 'fee':
        return (
          <PrimaryButton
            onClick={() => void flow.submitFee()}
            disabled={flow.fee.effectiveFeeRate <= 0}
            className="w-full"
            data-testid="unilateral-exit-get-quote"
          >
            Get Quote
          </PrimaryButton>
        );
      case 'quote':
        if (!canContinueFromQuote(flow.quote)) return null;
        return (
          <PrimaryButton onClick={() => flow.goTo('unlock')} className="w-full" data-testid="unilateral-exit-quote-continue">
            Continue
          </PrimaryButton>
        );
      case 'pending': {
        // Paying never starts the exit: coins an earlier attempt left at the
        // shared address can already cover the fee, so the user decides.
        const { pending, pendingCoins, nothingToExit, isStarting } = flow.engine;
        if (!pending || nothingToExit || isStarting || !isPendingFunded(pending, pendingCoins)) return null;
        return (
          <PrimaryButton
            onClick={() => void startPendingExit()}
            className="w-full"
            data-testid="unilateral-exit-start-exit"
          >
            Exit Spark
          </PrimaryButton>
        );
      }
      case 'fund':
      case 'topUp': {
        const funding = flow.funding;
        const isWaiting = !!funding?.topUp && funding.topUp.stillToSendSat > 0;
        // A top-up starts from the box that explains it, and one its fee coins
        // cannot pay has no action here at all.
        if (funding?.topUp && (funding.isFeeBudgetFixed || (flow.phase === 'fund' && isWaiting))) {
          return null;
        }
        return (
          <>
            {funding && isWaiting && !funding.isFeeBudgetFixed && (
              <div className="mb-4">
                <FundingStatus quotedAt={funding.quotedAt} />
              </div>
            )}
            <PrimaryButton
              onClick={() => void flow.build()}
              disabled={!flow.funding?.isFunded}
              className="w-full"
              data-testid="unilateral-exit-build"
            >
              Continue Exit
            </PrimaryButton>
          </>
        );
      }
      default:
        return null;
    }
  })();

  return (
    <>
      {/* Above the settings page's z-60 wrapper: the sheet portals to #root as
          its sibling, so at the default z-50 it opens behind that page. */}
      <BottomSheetContainer isOpen onClose={onBack} zIndex={70} showBackdrop>
        <BottomSheetCard>
          <DialogHeader
            // Names the flow, not the step: each step already labels its own
            // field, and the send sheet titles itself the same way.
            title="Unilateral Exit"
            onClose={onBack}
            onBack={flow.canGoBack ? flow.back : undefined}
          />

          {/* Bounded so the sheet stays content-sized: past 90% of the
              viewport the container drops the content snap and the sheet
              rests almost closed. dvh, not vh, or the cap overflows once a
              mobile URL bar is showing. The action is a sibling of the
              scroller, not inside it: a sheet cannot pin a footer at a
              partial snap, and a CTA that scrolls away is one to hunt for.
              The nested scroller needs its own overscroll and touch rules,
              which it does not inherit. */}
          {/* The scroller caps itself rather than stretching inside a capped
              flex parent: with no definite height to divide, flex-1 grew past
              the cap and the last card was drawn under the action row. */}
          <div className="space-y-6 max-h-[62dvh] overflow-y-auto overscroll-y-none touch-pan-y">
            {flow.phase === 'intro' && <IntroStep />}

            {flow.phase === 'destination' && (
              <DestinationField
                {...flow.destination}
                onSubmit={() => void flow.submitDestination()}
                onScanQr={() => setIsScanning(true)}
              />
            )}

            {flow.phase === 'fee' && <FeeStep {...flow.fee} />}

            {flow.phase === 'quote' && <QuoteStep {...flow.quote} />}

            {flow.phase === 'unlock' && (
              <>
                {gate === 'pin' && (
                  <PinGate reason="Unilateral exit" onUnlocked={() => void flow.unlock()} />
                )}
                {flow.unlockError && (
                  <ErrorMessageBox title="Cannot reach your recovery phrase" error={flow.unlockError} />
                )}
              </>
            )}

            {flow.phase === 'pending' && flow.engine.pending && (
              <PendingExitStep
                pending={flow.engine.pending}
                coins={flow.engine.pendingCoins}
                nothingToExit={flow.engine.nothingToExit}
                isStarting={flow.engine.isStarting}
                startError={flow.engine.startError}
                onCancel={cancelPendingExit}
              />
            )}

            {(flow.phase === 'fund' || flow.phase === 'topUp') && flow.funding && (
              <FundStep
                {...flow.funding}
                error={flow.buildError}
                isPaying={flow.phase === 'topUp'}
                onTopUp={() => flow.goTo('topUp')}
              />
            )}

            {flow.phase === 'building' && (
              <div className="py-16 flex justify-center">
                <LoadingSpinner text="Building and signing the exit..." />
              </div>
            )}

            {flow.phase === 'tracker' && flow.engine.plan && (
              <TrackerView
                plan={flow.engine.plan}
                tipHeight={flow.engine.tipHeight}
                isAdvancing={flow.engine.isAdvancing}
                onRebuild={flow.rebuild}
                onContinue={() => void flow.continueExit()}
                isContinuing={flow.isContinuing}
                continueError={flow.continueError}
                justStarted={!openedOnTracker}
              />
            )}

          </div>

          {/* Send's spacing: its input step's quick actions sit 16pt above the
              CTA, and its confirm step's content 24pt. */}
          {stepAction && (
            <div className={flow.phase === 'destination' ? 'pt-4' : 'pt-6'}>{stepAction}</div>
          )}
        </BottomSheetCard>
      </BottomSheetContainer>

      {/* Over the exit sheet, which is itself over the page. */}
      <QrScannerDialog
        isOpen={isScanning}
        zIndex={80}
        onClose={() => setIsScanning(false)}
        onScan={scanned => {
          flow.destination.onChange(scanned.trim());
          setIsScanning(false);
        }}
      />
    </>
  );
};

export default UnilateralExitPage;
