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
            <center>A fee of {feeSats} sats is applied to this transaction.</center>
          </Alert>
        )}
      </div>
    </div>
  );
};

const ReceivePaymentDialog: React.FC<ReceivePaymentDialogProps> = ({ isOpen, onClose }): JSX.Element => {
  const receive = useReceivePayment();
  const [showChangeConfirm, setShowChangeConfirm] = useState<boolean>(false);

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
    reset: resetLightningAddress,
  } = useLightningAddress();

  useEffect(() => {
    if (isOpen) {
      receive.reset();
      resetLightningAddress();
      loadLightningAddress();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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
    <BottomSheetContainer isOpen={isOpen} onClose={onClose}>
      <BottomSheetCard>
        <DialogHeader
          title="Receive"
          onClose={onClose}
          icon={<ArrowDownIcon />}
        />

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
            {receive.currentStep === 'loading_limits' && (
              <div className="flex flex-col items-center justify-center h-40">
                <LoadingSpinner />
              </div>
            )}

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

          <AmountPanel
            isOpen={receive.activeTab === 'lightning' && receive.showAmountPanel}
            amount={receive.amount}
            setAmount={receive.setAmount}
            description={receive.description}
            setDescription={receive.setDescription}
            limits={{ min: 1, max: 1000000 }}
            isLoading={receive.isLoading}
            error={receive.error}
            onCreateInvoice={receive.generateBolt11Invoice}
            onClose={() => receive.setShowAmountPanel(false)}
          />
        </TabContainer>
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
  );
};

export default ReceivePaymentDialog;
