import React, { useState, useEffect, useRef } from 'react';
import { useToast } from '../../contexts/ToastContext';
import LoadingSpinner from '../../components/LoadingSpinner';
import {
  DialogHeader,
  QRCodeContainer,
  CopyableText,
  Alert,
  StepContainer,
  BottomSheetCard,
  BottomSheetContainer,
  TabContainer,
  TabList,
  Tab,
  ConfirmDialog,
} from '../../components/ui';

import type { PaymentMethod } from '../../types/domain';
import { useLightningAddress } from './hooks/useLightningAddress';
import { useReceivePayment } from './hooks/useReceivePayment';
import { formatWithSpaces } from '../../utils/formatNumber';
import SparkAddressDisplay from './SparkAddressDisplay';
import BitcoinAddressDisplay from './BitcoinAddressDisplay';
import LightningAddressDisplay from './LightningAddressDisplay';
import LightningAddressEditSheet from './LightningAddressEditSheet';
import CrossChainReceiveWorkflow from './workflows/CrossChainReceiveWorkflow';
import AmountPanel from './AmountPanel';
import { SideCaption, SideDock, type BtcMode } from './SideDock';
import { ArrowDownIcon } from '../../components/Icons';
import { holdIdleLock } from '@/services/appLock';

/**
 * How long the card takes to turn out while it waits for a code, matching
 * `.qr-turn-wait` in index.css. Doubles as the deadline: past it the card
 * would be sitting edge-on, so it turns in on the placeholder instead and the
 * spinner carries the rest of the wait.
 */
const TURN_WAIT_MS = 900;

/** The last degree of that turn, once the code lands. Matches `.qr-turn-close`. */
const TURN_CLOSE_MS = 120;

interface ReceivePaymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface QRCodeDisplayProps {
  paymentData: string;
  feeSats: number;
  title: string;
  description?: string;
}

const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({ paymentData, feeSats, title, description }) => {
  const { showToast } = useToast();
  return (
    <div className="pt-8 space-y-6 flex flex-col items-center">
      <div className="text-center">
        <h3 className="text-lg font-medium text-[rgb(var(--text-white))] mb-2">{title}</h3>
        {description && (
          <p className="text-[rgb(var(--text-white))] opacity-75 text-sm">{description}</p>
        )}
      </div>

      <QRCodeContainer value={paymentData} />

      <div className="w-full">
        <CopyableText
          text={paymentData}
          truncate
          showShare
          label="Lightning Invoice"
          onCopied={() => showToast('success', 'Copied!')}
          onShareError={() => showToast('error', 'Failed to share')}
          data-testid="lightning-invoice-text"
        />

        {feeSats > 0 && (
          <Alert type="warning" className="mt-8">
            <center>A fee of ₿{formatWithSpaces(feeSats)} is applied to this transaction.</center>
          </Alert>
        )}
      </div>
    </div>
  );
};

const ReceivePaymentDialog: React.FC<ReceivePaymentDialogProps> = ({ isOpen, onClose }) => {
  const receive = useReceivePayment();
  const [showChangeConfirm, setShowChangeConfirm] = useState<boolean>(false);
  // The tabs belong to choosing, not to what you have made with the choice:
  // past the USD amount form there is a quote to lose, and on a created
  // invoice there is an invoice. The header arrow carries the way back from
  // both instead.
  const [usdResting, setUsdResting] = useState<boolean>(true);

  // First-paint deferral. On a fresh post-install launch the main
  // thread is still contending with WASM compile + SDK connect
  // callbacks when the user taps Receive. With `unmount={false}` the
  // sheet subtree lives in the React tree across opens but HeadlessUI
  // hides it via the `hidden` attribute (effectively `display: none`),
  // so the browser skips laying it out until `isOpen` flips to true.
  // At that point the full subtree — tabs, step container, address
  // displays — gets laid out synchronously with the paint that starts
  // the enter animation, pushing the first frame of the slide-up back
  // far enough to read as lag. Deferring the heavy subtree by one RAF
  // lets the browser commit a minimal sheet shell first so the enter
  // animation starts on its own frame, then paints the real content
  // on the next frame while the sheet is already sliding up. Sticky —
  // once true, stays true for the session, so subsequent opens render
  // content immediately (no placeholder flash).
  // Hold the foreground idle lock off while the sheet is up: a QR
  // waiting to be scanned is exactly the case where nobody touches the
  // screen. Keyed to `isOpen`, not to mount, because the sheet stays in
  // the React tree across opens (see the deferral note below).
  useEffect(() => {
    if (!isOpen) return;
    return holdIdleLock();
  }, [isOpen]);

  const [isContentReady, setIsContentReady] = useState(false);
  useEffect(() => {
    if (!isOpen || isContentReady) return;
    const id = requestAnimationFrame(() => {
      setIsContentReady(true);
    });
    return () => cancelAnimationFrame(id);
  }, [isOpen, isContentReady]);

  const {
    address: lightningAddress,
    isLoading: lightningAddressLoading,
    isEditing: isEditingLightningAddress,
    editValue: lightningAddressEditValue,
    error: lightningAddressError,
    isSupported: isLightningAddressSupported,
    load: loadLightningAddress,
    beginEdit: beginEditLightningAddress,
    cancelEdit: cancelEditLightningAddress,
    setEditValue: setLightningAddressEditValue,
    save: saveLightningAddress,
  } = useLightningAddress();

  // Parent (WalletPage) bumps `receiveDialogSession` on every open and
  // passes it as `key`, so each open is a fresh mount: hooks re-init,
  // no reset-in-effect needed. We only need to kick off the address
  // pre-load on first mount.
  useEffect(() => {
    loadLightningAddress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warm the on-chain address while the Lightning code is on screen, so the
  // switch has nothing left to wait for. It matters most on the first open
  // after a restart, where the SDK call is at its slowest and the user is
  // reading the Lightning code for a second or more before reaching for the
  // switch. Deferred past the sheet's enter animation for the same reason the
  // content itself is (see `isContentReady` above): the call is main-thread
  // work and the sheet is still sliding up. Costs one address rotation per
  // open even when the user never switches — harmless, because rotating
  // archives the previous address rather than invalidating it.
  useEffect(() => {
    if (!isContentReady) return;
    const id = window.setTimeout(() => { void receive.generateBitcoinAddress(); }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isContentReady]);

  // Re-trigger bitcoin address generation after reset clears the address
  useEffect(() => {
    if (isOpen && receive.activeTab === 'bitcoin' && !receive.bitcoinAddress && !receive.bitcoinLoading && !receive.error) {
      receive.generateBitcoinAddress();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, receive.activeTab, receive.bitcoinAddress, receive.bitcoinLoading, receive.error]);

  const handleTabChange = (tab: PaymentMethod) => {
    receive.handleTabChange(tab, loadLightningAddress);
  };

  const handleSaveLightningAddress = async () => {
    if (lightningAddress) {
      setShowChangeConfirm(true);
      return;
    }
    await saveLightningAddress();
  };

  const getAddressChangeMessage = () => {
    if (!lightningAddress) return '';
    const parts = lightningAddress.lightningAddress.split('@');
    const username = parts[0];
    const domain = parts[1] || 'breez.tips';
    return `'${username}@${domain}' will stop receiving payments.\n\nDo you want to proceed?`;
  };

  // The BTC tab shows Lightning or on-chain, reusing those two tab states.
  const isBtcTab = receive.activeTab === 'lightning' || receive.activeTab === 'bitcoin';
  const btcMode: BtcMode = receive.activeTab === 'bitcoin' ? 'bitcoin' : 'lightning';
  // The card lags the dock by half a turn: it swaps codes while edge-on.
  const [shownMode, setShownMode] = useState<BtcMode>(btcMode);
  const [turning, setTurning] = useState<'out' | 'close' | 'in' | null>(null);
  // Set while the card turns out slowly because the code it will land on is
  // still loading. The turn starts on the tap either way — what changes is
  // that this one creeps the last few degrees instead of snapping to edge-on,
  // so the wait reads as a turn still going rather than as a stall. Whatever
  // ends the wait — the address, a failed fetch, or the deadline — closes the
  // turn from there and lands the card on what it found.
  const [pendingMode, setPendingMode] = useState<BtcMode | null>(null);
  const turnTimers = useRef<number[]>([]);
  useEffect(() => () => turnTimers.current.forEach(clearTimeout), []);
  const clearTurnTimers = () => {
    turnTimers.current.forEach(clearTimeout);
    turnTimers.current = [];
  };
  const later = (ms: number, fn: () => void) => turnTimers.current.push(window.setTimeout(fn, ms));
  const turnIn = (mode: BtcMode) => {
    clearTurnTimers();
    setPendingMode(null);
    setShownMode(mode);
    setTurning('in');
    // Cleared, so a QR replacing its placeholder does not turn in again.
    later(160, () => setTurning(null));
  };
  // Finishes a wait: closes the last degree of the turn, then turns in. The
  // swap has to happen at edge-on — from part-way through the wait the card
  // would jump from part-width to the zero-width start of the turn in, which
  // reads as a flash, or as the card turning more than once.
  const closeTurn = (mode: BtcMode) => {
    clearTurnTimers();
    setPendingMode(null);
    setTurning('close');
    later(TURN_CLOSE_MS, () => turnIn(mode));
  };
  // The on-chain code completes the turn as soon as it lands. So does a failed
  // fetch: the request settles one way or the other, so the wait always ends
  // on its own, and the deadline below is only there to keep the card off its
  // edge, not to rescue a hung promise.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is an external async value, and completing the turn on its arrival is the whole point
    if (pendingMode === 'bitcoin' && (receive.bitcoinAddress || receive.error)) closeTurn('bitcoin');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMode, receive.bitcoinAddress, receive.error]);
  const switchBtcMode = (mode: BtcMode) => {
    handleTabChange(mode);
    clearTurnTimers();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPendingMode(null);
      setShownMode(mode);
      setTurning(null);
      return;
    }
    if (mode === shownMode) {
      // Switched back before the swap: turn the same card back in. Out of a
      // wait that means finishing the turn first, same as any other ending.
      if (pendingMode) {
        closeTurn(mode);
        return;
      }
      setPendingMode(null);
      if (turning === 'out') {
        setTurning('in');
        later(160, () => setTurning(null));
      }
      return;
    }
    if (mode === 'bitcoin' && !receive.bitcoinAddress) {
      setPendingMode(mode);
      later(TURN_WAIT_MS, () => turnIn(mode));
      return;
    }
    setTurning('out');
    later(160, () => {
      setShownMode(mode);
      setTurning('in');
    });
    // Cleared, so a QR replacing its placeholder does not turn in again.
    later(320, () => setTurning(null));
  };
  // Tabs while the user is choosing what to receive, gone once there is
  // something made: a USD request past its amount form, or a created invoice.
  const tabsVisible = receive.activeTab === 'usd' ? usdResting : receive.currentStep === 'input';
  // Under 400px the code shrinks so the switch and label have room beside its corners.
  const qrSize = window.innerWidth < 400 ? 184 : 200;
  const qrCardClassName = `${turning === 'out' ? 'animate-qr-turn-out' : turning === 'close' ? 'qr-turn-close' : turning === 'in' ? 'animate-qr-turn-in' : pendingMode ? 'qr-turn-wait' : ''} motion-reduce:animate-none`;
  const btcView = (section: 'qr' | 'details') => (shownMode === 'lightning' ? (
    <LightningAddressDisplay
      address={lightningAddress}
      isLoading={lightningAddressLoading}
      isSupported={isLightningAddressSupported}
      onEdit={() => beginEditLightningAddress(lightningAddress)}
      onCustomizeAmount={() => receive.setShowAmountPanel(true)}
      section={section}
      qrSize={qrSize}
      qrCardClassName={qrCardClassName}
    />
  ) : (
    <BitcoinAddressDisplay
      address={receive.bitcoinAddress}
      isLoading={receive.bitcoinLoading}
      section={section}
      qrSize={qrSize}
      qrCardClassName={qrCardClassName}
    />
  ));

  const getQRTitle = () => {
    switch (receive.activeTab) {
      case 'lightning': return 'Lightning Invoice';
      case 'spark': return 'Spark Address';
      case 'bitcoin': return 'Bitcoin Address';
      case 'usd': return 'USD Transfer';
      default: return 'Payment Request';
    }
  };

  const getQRDescription = () => {
    switch (receive.activeTab) {
      case 'lightning': return 'Scan to pay this Lightning invoice';
      case 'spark': return 'Use this address to receive payments';
      case 'bitcoin': return 'Send Bitcoin to this address for automatic Lightning conversion';
      default: return '';
    }
  };

  return (
    <>
      <BottomSheetContainer isOpen={isOpen} onClose={onClose} showBackdrop>
        <BottomSheetCard>
          <DialogHeader
            title="Receive"
            onClose={onClose}
            // The USD steps lend theirs through `useSheetBack`; the invoice is
            // rendered here, so its way back is passed in directly.
            onBack={receive.currentStep === 'qr' ? receive.dismissInvoice : undefined}
            icon={<ArrowDownIcon />}
          />

          {isContentReady ? (
            <TabContainer>
              {tabsVisible && (
                <TabList>
                  <Tab isActive={isBtcTab} onClick={() => { if (!isBtcTab) { handleTabChange('lightning'); setShownMode('lightning'); } }} data-testid="btc-tab">
                    <span className="font-bold text-sm">₿</span>
                    BTC
                  </Tab>
                  <Tab isActive={receive.activeTab === 'usd'} onClick={() => handleTabChange('usd')} data-testid="usd-tab">
                    <span className="font-bold text-sm">$</span>
                    USD
                  </Tab>
                </TabList>
              )}

              {/* The USD tab sits outside StepContainer: its steps size to their
                  own content (matching the cross-chain send flow), so the 280px
                  floor would pad the short ones out with dead space. It stays
                  mounted across tab switches and renders nothing while it is
                  off screen: a quote, its network and the typed amount are too
                  much to lose to a stray tap on BTC. Unkeyed for the same
                  reason, since `resetCount` is bumped by closing the amount
                  panel, which has nothing to do with this flow. */}
              <CrossChainReceiveWorkflow
                active={receive.activeTab === 'usd'}
                onRestingChange={setUsdResting}
              />
              {receive.activeTab !== 'usd' && (
                <StepContainer>
                  <>
                    {receive.currentStep === 'input' && (
                      <div className="pt-6">
                        {isBtcTab && (
                          <div className="flex flex-col items-center gap-6">
                            {/* Dock, code, caption. The row runs edge to edge and its gaps match the corners' 12px overhang,
                                so the dock and caption center between the sheet edge and the corners. */}
                            <div className="-mx-6 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-x-3 items-center justify-items-center self-stretch">
                              <SideDock mode={btcMode} onChange={switchBtcMode} />
                              {btcView('qr')}
                              <SideCaption shown={shownMode} mode={btcMode} onChange={switchBtcMode} />
                            </div>
                            {btcView('details')}
                          </div>
                        )}

                        {receive.activeTab === 'spark' && (
                          <SparkAddressDisplay address={receive.sparkAddress} isLoading={receive.sparkLoading} />
                        )}
                      </div>
                    )}

                    {receive.currentStep === 'loading' && (
                      <div className="flex flex-col items-center justify-center h-40" data-testid="invoice-generation-loading">
                        <LoadingSpinner text={`Generating ${getQRTitle().toLowerCase()}...`} />
                      </div>
                    )}

                    {receive.currentStep === 'qr' && (
                      <QRCodeDisplay
                        paymentData={receive.paymentData}
                        feeSats={receive.feeSats}
                        title={getQRTitle()}
                        description={getQRDescription()}
                      />
                    )}
                  </>
                </StepContainer>
              )}
            </TabContainer>
          ) : lightningAddress ? (
            // Placeholder matched to the Lightning-tab QR view when
            // the preloaded address is already available by the time
            // the user taps Receive. A fixed min-height stops the
            // sheet from entering at ~150px and then lurching up to
            // ~450px when the real QR + copy row mounts on the next
            // frame (translate-y-% is relative to element height, so
            // mid-animation height jumps reposition the sheet
            // visibly).
            <div className="min-h-[450px]" aria-hidden />
          ) : (
            // Placeholder mirroring LightningAddressDisplay's own
            // `isLoading && !address` render (`text-center py-8` +
            // "Loading Lightning Address..." spinner). When the real
            // content mounts on the next frame the spinner simply
            // stays where it is — no visual pop, no height snap —
            // and takes over the "loading" role until the SDK
            // response lands. On first-ever post-install tap the
            // preload is usually still in flight so this branch
            // dominates. Tabs are always Lightning at this point
            // because `isContentReady` gates the tab UI, so a
            // Lightning-specific copy is safe.
            <div className="text-center py-8">
              <LoadingSpinner text="Loading Lightning Address..." />
            </div>
          )}
        </BottomSheetCard>

        <ConfirmDialog
          isOpen={showChangeConfirm}
          title="Confirm Username Change"
          message={getAddressChangeMessage()}
          confirmLabel="Change"
          cancelLabel="Cancel"
          variant="warning"
          onConfirm={async () => {
            setShowChangeConfirm(false);
            await saveLightningAddress();
          }}
          onCancel={() => setShowChangeConfirm(false)}
        />
      </BottomSheetContainer>

      <AmountPanel
        isOpen={isOpen && receive.activeTab === 'lightning' && receive.showAmountPanel}
        amountSats={receive.amountSats}
        setAmountSats={receive.setAmountSats}
        description={receive.description}
        setDescription={receive.setDescription}
        isLoading={receive.isLoading}
        error={receive.error}
        onCreateInvoice={receive.generateBolt11Invoice}
        onClose={receive.closeAmountPanel}
        resetCount={receive.resetCount}
      />

      <LightningAddressEditSheet
        isOpen={isOpen && isEditingLightningAddress}
        address={lightningAddress}
        editValue={lightningAddressEditValue}
        error={lightningAddressError}
        isLoading={lightningAddressLoading}
        onEditValueChange={setLightningAddressEditValue}
        onSave={handleSaveLightningAddress}
        onClose={cancelEditLightningAddress}
      />
    </>
  );
};

export default ReceivePaymentDialog;
