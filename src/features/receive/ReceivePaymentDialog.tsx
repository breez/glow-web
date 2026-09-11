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
import { getSettings, isCrossChainEnabled } from '../../services/settings';
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

  // Gated on the dev-only "Receive USD" toggle (cross-chain send is always-on
  // upstream; the receive flow is still being polished).
  const showUsdTab = isCrossChainEnabled();

  // The BTC tab shows Lightning or on-chain, reusing those two tab states.
  const isBtcTab = receive.activeTab === 'lightning' || receive.activeTab === 'bitcoin';
  const btcMode: BtcMode = receive.activeTab === 'bitcoin' ? 'bitcoin' : 'lightning';
  // The card lags the dock by half a turn: it swaps codes while edge-on.
  const [shownMode, setShownMode] = useState<BtcMode>(btcMode);
  const [turning, setTurning] = useState<'out' | 'in' | null>(null);
  const turnTimers = useRef<number[]>([]);
  useEffect(() => () => turnTimers.current.forEach(clearTimeout), []);
  const switchBtcMode = (mode: BtcMode) => {
    handleTabChange(mode);
    turnTimers.current.forEach(clearTimeout);
    turnTimers.current = [];
    const later = (ms: number, fn: () => void) => turnTimers.current.push(window.setTimeout(fn, ms));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShownMode(mode);
      setTurning(null);
      return;
    }
    if (mode === shownMode) {
      // Switched back before the swap: turn the same card back in.
      if (turning === 'out') {
        setTurning('in');
        later(160, () => setTurning(null));
      }
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
  // Dev-mode trial of the mirrored layout: dock right of the code, caption left.
  const dockRight = getSettings().receiveDockRight === true;
  const dock = <SideDock mode={btcMode} onChange={switchBtcMode} />;
  const caption = <SideCaption shown={shownMode} mode={btcMode} onChange={switchBtcMode} />;
  // Narrow phones get a smaller code so the dock clears the frame.
  const qrSize = window.innerWidth < 375 ? 184 : 200;
  const qrCardClassName = `${turning === 'out' ? 'animate-qr-turn-out' : turning === 'in' ? 'animate-qr-turn-in' : ''} motion-reduce:animate-none`;
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
            icon={<ArrowDownIcon />}
          />

          {isContentReady ? (
            <TabContainer>
              {/* One tab would be a bar with nothing to pick, so BTC stands alone. */}
              {showUsdTab && (
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
                  floor would pad the short ones out with dead space. */}
              {receive.activeTab === 'usd' ? (
                <CrossChainReceiveWorkflow key={`usd-${receive.resetCount}`} />
              ) : (
                <StepContainer>
                  <>
                    {receive.currentStep === 'input' && (
                      <div className="pt-6">
                        {isBtcTab && (
                          <div className="flex flex-col items-center gap-6">
                            {/* Dock, code, caption: the grid keeps the code centered between them. */}
                            <div className={`-mx-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center self-stretch ${dockRight ? '[--qr-turn:1]' : ''}`}>
                              {dockRight ? caption : dock}
                              {btcView('qr')}
                              {dockRight ? dock : caption}
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
