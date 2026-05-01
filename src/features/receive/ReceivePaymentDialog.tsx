import React, { useState, useEffect } from 'react';
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
import SparkAddressDisplay from './SparkAddressDisplay';
import BitcoinAddressDisplay from './BitcoinAddressDisplay';
import LightningAddressDisplay from './LightningAddressDisplay';
import AmountPanel from './AmountPanel';
import { ArrowDownIcon, LightningBoltIcon } from '../../components/Icons';

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
            <center>A fee of ₿{feeSats.toLocaleString()} is applied to this transaction.</center>
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
    supportMessage: lightningAddressSupportMessage,
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
    return `Changing your Lightning Address username will permanently release '${username}@${domain}', making it available for other users.\n\nDo you want to proceed?`;
  };

  const getQRTitle = () => {
    switch (receive.activeTab) {
      case 'lightning': return 'Lightning Invoice';
      case 'spark': return 'Spark Address';
      case 'bitcoin': return 'Bitcoin Address';
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
              <TabList>
                <Tab isActive={receive.activeTab === 'lightning'} onClick={() => handleTabChange('lightning')} data-testid="lightning-tab">
                  <LightningBoltIcon size="sm" />
                  Lightning
                </Tab>
                <Tab isActive={receive.activeTab === 'bitcoin'} onClick={() => handleTabChange('bitcoin')} data-testid="bitcoin-tab">
                  <span className="font-bold text-sm">₿</span>
                  Bitcoin
                </Tab>
              </TabList>

              <StepContainer>
                {receive.currentStep === 'input' && (
                  <div className="pt-6">
                    {receive.activeTab === 'lightning' && (
                      <LightningAddressDisplay
                        address={lightningAddress}
                        isLoading={lightningAddressLoading}
                        isEditing={isEditingLightningAddress}
                        editValue={lightningAddressEditValue}
                        error={lightningAddressError}
                        isSupported={isLightningAddressSupported}
                        supportMessage={lightningAddressSupportMessage}
                        onEdit={() => beginEditLightningAddress(lightningAddress)}
                        onSave={handleSaveLightningAddress}
                        onCancel={() => cancelEditLightningAddress()}
                        onEditValueChange={setLightningAddressEditValue}
                        onCustomizeAmount={() => receive.setShowAmountPanel(true)}
                      />
                    )}

                    {receive.activeTab === 'spark' && (
                      <SparkAddressDisplay address={receive.sparkAddress} isLoading={receive.sparkLoading} />
                    )}

                    {receive.activeTab === 'bitcoin' && (
                      <BitcoinAddressDisplay address={receive.bitcoinAddress} isLoading={receive.bitcoinLoading} />
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
              </StepContainer>
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
    </>
  );
};

export default ReceivePaymentDialog;
