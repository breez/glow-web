import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BottomSheetCard,
  BottomSheetContainer,
  DialogHeader,
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
import { RecoverReviewStep } from '@/features/unilateral-exit/steps/RecoverReviewStep';
import { ErrorCard } from '@/features/unilateral-exit/steps/ReviewParts';
import { FundStep, FundingStatus, PendingExitStep, Receipt, Status } from '@/features/unilateral-exit/steps/FundStep';
import { RedoActions, TrackerView } from '@/features/unilateral-exit/TrackerView';
import { SatAmount } from '@/components/SatAmount';
import { recoveryTxid } from '@/features/unilateral-exit/storage/archive';
import { cancelPendingExit, startPendingExit } from '@/features/unilateral-exit/engine/api';
import { startDeadEnded } from '@/features/unilateral-exit/engine/state';
import { isPendingFunded } from '@/features/unilateral-exit/exitFee';
import { awaitsUpdate, type ExitMode } from '@/features/unilateral-exit/model/plan';

interface UnilateralExitPageProps {
  network: string;
  /** `recover` when opened from the Recoverable Funds row. A saved exit's own mode wins. */
  mode?: ExitMode;
  /** A kept co-signed recovery whose fee this raises, by its txid. */
  bumpTxid?: string;
  onBack: () => void;
  /** Where to go once the exit lands, since the tracker has nothing left to show. */
  onFinished: () => void;
}

const UnilateralExitPage: React.FC<UnilateralExitPageProps> = ({ network, mode, bumpTxid, onBack, onFinished }) => {
  const flow = useUnilateralExitFlow(network, mode, bumpTxid);
  const recovering = flow.mode === 'recover';
  const noun = recovering ? 'recovery' : 'exit';

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
  // whatever the step. The signal is the exit's `recoveryTxid` reaching the
  // archive. The phase cannot serve: a tracker opened from the list is derived
  // from the plan, and without one it reads as the intro. Nor can a missing
  // plan, which is also what a stopped engine reports while the SDK reconnects.
  const { plan, archive } = flow.engine;
  const { bumping, bumpedTxid, phase } = flow;
  const shownTxid = useRef<string | null>(null);
  // A plan can finish with no transaction of its own, and so be archived
  // under another txid or not at all. A missing plan does say it landed when
  // the last one seen had finished.
  const sawComplete = useRef(false);
  useEffect(() => {
    if (!bumping && plan) {
      shownTxid.current = recoveryTxid(plan) ?? shownTxid.current;
      sawComplete.current = plan.status.type === 'done';
    }
    // A bump follows the kept recovery holding its leaves, whose txid a retry
    // can swap. With none to follow there is nothing to bump. Its receipt
    // waits for Done.
    if (bumping && bumpedTxid) shownTxid.current = bumpedTxid;
    if (bumping && phase === 'sent') return;
    const leftFinished = !bumping && !plan && sawComplete.current;
    if (leftFinished || (bumping && !shownTxid.current) || archive.some(exit => exit.id === shownTxid.current)) onFinished();
  }, [plan, archive, onFinished, bumping, bumpedTxid, phase]);

  // A bump sheet can sit beside a paused exit or recovery, which is not its own.
  const paused = !bumping && !!plan && awaitsUpdate(plan);
  // An empty quote of a paused exit stays empty at any rate, since a named
  // quote takes each leaf whatever it costs. So Back skips the fee picker for
  // the tracker, whose update button is what continues the exit.
  const { canGoBack, back: stepBack, goTo, quote } = flow;
  const backToTracker = paused && phase === 'quote' && !quote.isQuoting && !quote.error && !!quote.figures?.isEmpty;
  const back = useCallback(() => (backToTracker ? goTo('tracker') : stepBack()), [backToTracker, goTo, stepBack]);

  // One call to action per step, in the bar the rest of the app puts it in.
  // A step with nothing to press, such as the pin gate or the build, has none.
  useBackButton(
    useCallback(() => {
      if (!canGoBack) return false;
      back();
      return true;
    }, [canGoBack, back]),
    true,
  );

  // A cancelled exit falls back to its intro to start again. A recovery has
  // no intro, and one opened from its row would land on the exit's, which
  // quotes the whole balance. So the sheet closes instead.
  const cancelPending = useCallback(() => {
    cancelPendingExit();
    if (recovering) onBack();
  }, [recovering, onBack]);

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
        // The rates are what there is to choose between: until they load the
        // step is a spinner, and a greyed button beside one reads as a tap that
        // failed rather than as work under way.
        if (!flow.fee.feeRates) return null;
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
      case 'quote': {
        if (!canContinueFromQuote(flow.quote)) return null;
        // A quote that needs no funding builds on this tap, so it names what the
        // tap does. So does a recovery that sends its co-signed part on it.
        const figures = flow.quote.figures;
        const underWay = !!flow.engine.plan || flow.bumping;
        const sendsNow = recovering && !underWay && !!figures?.recoverableSat;
        const label =
          figures?.needsFunding && !sendsNow
            ? 'Continue'
            : recovering
              ? underWay
                ? 'Continue Recovery'
                : 'Recover Funds'
              : underWay
                ? 'Continue Exit'
                : 'Exit Spark';
        return (
          <PrimaryButton
            onClick={() => void flow.continueFromQuote()}
            className="w-full"
            data-testid="unilateral-exit-quote-continue"
          >
            {label}
          </PrimaryButton>
        );
      }
      case 'pending': {
        // Paying never starts the exit: coins an earlier attempt left at the
        // shared address can already cover the fee, so the user decides.
        const { pending, pendingCoins, isStarting } = flow.engine;
        if (!pending || startDeadEnded(flow.engine) || isStarting || !isPendingFunded(pending, pendingCoins)) return null;
        return (
          <PrimaryButton
            onClick={() => void startPendingExit()}
            className="w-full"
            data-testid="unilateral-exit-start-exit"
          >
            {recovering ? 'Recover Funds' : 'Exit Spark'}
          </PrimaryButton>
        );
      }
      case 'fund':
      case 'topUp': {
        const funding = flow.funding;
        const isWaiting = !!funding?.topUp && funding.topUp.stillToSendSat > 0;
        // A top-up starts from the box that explains it.
        if (flow.phase === 'fund' && isWaiting) return null;
        return (
          <>
            {funding && isWaiting && (
              <div className="mb-4">
                <FundingStatus quotedAt={funding.quotedAt} />
              </div>
            )}
            <PrimaryButton
              onClick={() => void flow.build()}
              disabled={!flow.funding?.isFunded || flow.isContinuing}
              className="w-full"
              data-testid="unilateral-exit-build"
            >
              {flow.isContinuing ? 'Updating...' : recovering ? 'Continue Recovery' : 'Continue Exit'}
            </PrimaryButton>
          </>
        );
      }
      case 'tracker':
        if (!flow.engine.plan || !awaitsUpdate(flow.engine.plan)) return null;
        return (
          <RedoActions
            onContinue={() => void flow.continueExit()}
            onRebuild={flow.rebuild}
            isContinuing={flow.isContinuing}
            continueError={flow.continueError}
            noun={noun}
          />
        );
      case 'unlock':
        // A cancelled passkey prompt, or any failed read, is tried again here.
        if (!flow.unlockError) return null;
        return (
          <PrimaryButton onClick={() => void unlock()} className="w-full" data-testid="unilateral-exit-unlock-retry">
            Try Again
          </PrimaryButton>
        );
      case 'sent':
        return (
          <PrimaryButton onClick={onFinished} className="w-full" data-testid="unilateral-exit-sent-done">
            Done
          </PrimaryButton>
        );
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
            title={recovering ? 'Recover Funds' : 'Unilateral Exit'}
            onClose={onBack}
            onBack={canGoBack ? back : undefined}
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

            {flow.phase === 'quote' &&
              (recovering && flow.quote.figures && !flow.quote.isQuoting && !flow.quote.error ? (
                // The same quote in this flow's words, which shows why a start failed itself.
                <RecoverReviewStep
                  figures={flow.quote.figures}
                  destination={flow.quote.quote?.destination ?? flow.destination.destination}
                  error={flow.startError}
                  underWay={!!plan || bumping}
                  paused={paused}
                />
              ) : (
                <>
                  <QuoteStep {...flow.quote} underWay={!!plan} paused={paused} noun={noun} />
                  {flow.startError && (
                    <ErrorCard
                      title={flow.engine.plan ? 'Could not continue the exit' : 'Could not start the exit'}
                      error={flow.startError}
                      testId="unilateral-exit-start-error"
                    />
                  )}
                </>
              ))}

            {flow.phase === 'unlock' && (
              <>
                {/* Passed once, so a retry after a failed read asks for no PIN again. */}
                {gate === 'pin' && (
                  <PinGate
                    reason={recovering ? 'Recover funds' : 'Unilateral exit'}
                    onUnlocked={() => {
                      setGate(null);
                      void flow.unlock();
                    }}
                  />
                )}
                {flow.unlockError && (
                  <ErrorCard title="Sign-in failed" error={flow.unlockError} testId="unilateral-exit-unlock-error" />
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
                onCancel={cancelPending}
                noun={noun}
              />
            )}

            {(flow.phase === 'fund' || flow.phase === 'topUp') && flow.funding && (
              <>
                <FundStep
                  {...flow.funding}
                  error={flow.buildError}
                  isPaying={flow.phase === 'topUp'}
                  onTopUp={() => flow.goTo('topUp')}
                  noun={noun}
                />
                {/* FundStep shows no error beside a top-up, so a leftover's failed build says so here. */}
                {flow.engine.plan?.status.type === 'needsExitFee' && flow.continueError && (
                  <ErrorCard title={`Could not continue the ${noun}`} error={flow.continueError} testId="unilateral-exit-leftover-error" />
                )}
              </>
            )}

            {flow.phase === 'building' && (
              <div className="py-16 flex justify-center">
                <LoadingSpinner text={`Building and signing the ${noun}...`} />
              </div>
            )}

            {flow.phase === 'tracker' && flow.engine.plan && (
              <TrackerView
                plan={flow.engine.plan}
                tipHeight={flow.engine.tipHeight}
                isAdvancing={flow.engine.isAdvancing}
                onRebuild={flow.rebuild}
                continueError={flow.continueError}
                justStarted={!openedOnTracker}
                noun={noun}
              />
            )}

            {flow.phase === 'sent' && (
              <Receipt title="Funds sent">
                <Status>
                  <SatAmount sats={flow.sentSat} /> on its way
                </Status>
              </Receipt>
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
