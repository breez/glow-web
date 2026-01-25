import React, { useState, useEffect } from 'react';
import { useWallet } from '../../contexts/WalletContext';
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
  TabPanel,
  TabPanelGroup,
} from '../../components/ui';

// Types
import type { PaymentMethod, ReceiveStep } from '../../types/domain';
import { useLightningAddress } from './hooks/useLightningAddress';
import SparkAddressDisplay from './SparkAddressDisplay';
import BitcoinAddressDisplay from './BitcoinAddressDisplay';
import LightningAddressDisplay from './LightningAddressDisplay';
import AmountPanel from './AmountPanel';

// Props interfaces
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

// Component to display QR code with payment data
const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({ paymentData, feeSats, title, description }) => {
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
        <CopyableText text={paymentData} />

        {feeSats > 0 && (
          <Alert type="warning" className="mt-8">
            <center>A fee of {feeSats} sats is applied to this transaction.</center>
          </Alert>
        )}
      </div>
    </div>
  );
};

// Main component
const ReceivePaymentDialog: React.FC<ReceivePaymentDialogProps> = ({ isOpen, onClose }): JSX.Element => {
  const wallet = useWallet();
  // State
  const [activeTab, setActiveTab] = useState<PaymentMethod>('lightning');
  const [currentStep, setCurrentStep] = useState<ReceiveStep>('loading_limits');
  const [description, setDescription] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [paymentData, setPaymentData] = useState<string>('');
  const [feeSats, setFeeSats] = useState<number>(0);

  // State for on-demand address generation
  const [sparkAddress, setSparkAddress] = useState<string | null>(null);
  const [bitcoinAddress, setBitcoinAddress] = useState<string | null>(null);
  const [sparkLoading, setSparkLoading] = useState<boolean>(false);
  const [bitcoinLoading, setBitcoinLoading] = useState<boolean>(false);

  // Lightning Address lifecycle via hook
  const {
    address: lightningAddress,
    isLoading: lightningAddressLoading,
    isEditing: isEditingLightningAddress,
    editValue: lightningAddressEditValue,
    error: lightningAddressError,
    load: loadLightningAddress,
    beginEdit: beginEditLightningAddress,
    cancelEdit: cancelEditLightningAddress,
    setEditValue: setLightningAddressEditValue,
    save: saveLightningAddress,
    reset: resetLightningAddress,
  } = useLightningAddress();
  const [showAmountPanel, setShowAmountPanel] = useState<boolean>(false);

  // Reset state when dialog opens and set default limits
  useEffect(() => {
    if (isOpen) {
      resetState();
      setActiveTab('lightning');
      loadLightningAddress();
    }
  }, [isOpen]);

  const resetState = () => {
    setCurrentStep('input');
    setDescription('');
    setAmount('');
    setError(null);
    setIsLoading(false);
    setPaymentData('');
    setFeeSats(0);
    // Reset addresses when dialog closes
    setSparkAddress(null);
    setBitcoinAddress(null);
    setSparkLoading(false);
    setBitcoinLoading(false);
    // Reset Lightning Address state
    resetLightningAddress();
    setShowAmountPanel(false);
  };

  // Generate Bolt11 invoice
  const generateBolt11Invoice = async () => {
    setError(null);
    setIsLoading(true);
    setCurrentStep('loading');

    // Close the amount panel immediately when starting to generate
    if (showAmountPanel) {
      setShowAmountPanel(false);
    }

    try {
      const amountSats = parseInt(amount);
      const receiveResponse = await wallet.receivePayment({
        paymentMethod: {
          type: 'bolt11Invoice',
          description,
          amountSats,
        },
      });
      setPaymentData(receiveResponse.paymentRequest);
      setFeeSats(Number(receiveResponse.fee) || 0);
      setCurrentStep('qr');
    } catch (err) {
      console.error('Failed to generate invoice:', err);
      setError(`Failed to generate invoice: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setCurrentStep('input');
    } finally {
      setIsLoading(false);
    }
  };

  // Generate Spark address on-demand
  const generateSparkAddress = async () => {
    if (sparkAddress || sparkLoading) return; // Don't generate if already exists or loading

    setSparkLoading(true);
    try {
      const receiveResponse = await wallet.receivePayment({
        paymentMethod: { type: 'sparkAddress' },
      });
      setSparkAddress(receiveResponse.paymentRequest);
    } catch (err) {
      console.error('Failed to generate Spark address:', err);
      setError(`Failed to generate Spark address: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSparkLoading(false);
    }
  };

  // Generate Bitcoin address on-demand
  const generateBitcoinAddress = async () => {
    if (bitcoinAddress || bitcoinLoading) return; // Don't generate if already exists or loading

    setBitcoinLoading(true);
    try {
      const receiveResponse = await wallet.receivePayment({
        paymentMethod: { type: 'bitcoinAddress' },
      });
      setBitcoinAddress(receiveResponse.paymentRequest);
    } catch (err) {
      console.error('Failed to generate Bitcoin address:', err);
      setError(`Failed to generate Bitcoin address: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setBitcoinLoading(false);
    }
  };

  // Lightning Address management via hook
  const handleEditLightningAddress = () => beginEditLightningAddress(lightningAddress);
  const handleCancelEditLightningAddress = () => cancelEditLightningAddress();
  const handleSaveLightningAddress = async () => saveLightningAddress();

  const handleCustomizeAmount = () => {
    setShowAmountPanel(true);
  };

  // Handle tab change
  const handleTabChange = (tab: PaymentMethod) => {
    setActiveTab(tab);
    setCurrentStep('input');
    setError(null);
    setPaymentData('');
    setFeeSats(0);

    if (tab === 'lightning') {
      loadLightningAddress();
    } else if (tab === 'spark') {
      generateSparkAddress();
    } else if (tab === 'bitcoin') {
      generateBitcoinAddress();
    }
  };

  const getQRTitle = () => {
    switch (activeTab) {
      case 'lightning':
        return 'Lightning Invoice';
      case 'spark':
        return 'Spark Address';
      case 'bitcoin':
        return 'Bitcoin Address';
      default:
        return 'Payment Request';
    }
  };

  const getQRDescription = () => {
    switch (activeTab) {
      case 'lightning':
        return 'Scan to pay this Lightning invoice';
      case 'spark':
        return 'Use this address to receive payments';
      case 'bitcoin':
        return 'Send Bitcoin to this address for automatic Lightning conversion';
      default:
        return '';
    }
  };

  return (
    <BottomSheetContainer isOpen={isOpen} onClose={onClose}>
      <BottomSheetCard className="bottom-sheet-card">
        <DialogHeader 
          title="Receive" 
          onClose={onClose}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          }
        />

        <TabContainer>
          <TabList>
            <Tab isActive={activeTab === 'lightning'} onClick={() => handleTabChange('lightning')}>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
              </svg>
              Lightning
            </Tab>
            <Tab isActive={activeTab === 'bitcoin'} onClick={() => handleTabChange('bitcoin')}>
              <span className="font-bold text-sm">₿</span>
              Bitcoin
            </Tab>
          </TabList>

          <StepContainer>
            {currentStep === 'loading_limits' && (
              <div className="flex flex-col items-center justify-center h-40">
                <LoadingSpinner />
              </div>
            )}

            {currentStep === 'input' && (
              <TabPanelGroup>
                <TabPanel isActive={activeTab === 'lightning'}>
                  <LightningAddressDisplay
                    address={lightningAddress}
                    isLoading={lightningAddressLoading}
                    isEditing={isEditingLightningAddress}
                    editValue={lightningAddressEditValue}
                    error={lightningAddressError}
                    onEdit={handleEditLightningAddress}
                    onSave={handleSaveLightningAddress}
                    onCancel={handleCancelEditLightningAddress}
                    onEditValueChange={setLightningAddressEditValue}
                    onCustomizeAmount={handleCustomizeAmount}
                  />
                </TabPanel>

                <TabPanel isActive={activeTab === 'spark'}>
                  <SparkAddressDisplay address={sparkAddress} isLoading={sparkLoading} />
                </TabPanel>

                <TabPanel isActive={activeTab === 'bitcoin'}>
                  <BitcoinAddressDisplay address={bitcoinAddress} isLoading={bitcoinLoading} />
                </TabPanel>
              </TabPanelGroup>
            )}

            {currentStep === 'loading' && (
              <div className="flex flex-col items-center justify-center h-40">
                <LoadingSpinner text={`Generating ${getQRTitle().toLowerCase()}...`} />
              </div>
            )}

            {currentStep === 'qr' && (
              <QRCodeDisplay
                paymentData={paymentData}
                feeSats={feeSats}
                title={getQRTitle()}
                description={getQRDescription()}
              />
            )}
          </StepContainer>

          {/* Sliding Bottom Panel for Amount Customization */}
          <AmountPanel
            isOpen={activeTab === 'lightning' && showAmountPanel}
            amount={amount}
            setAmount={setAmount}
            description={description}
            setDescription={setDescription}
            limits={{ min: 1, max: 1000000 }}
            isLoading={isLoading}
            error={error}
            onCreateInvoice={generateBolt11Invoice}
            onClose={() => setShowAmountPanel(false)}
          />
        </TabContainer>
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default ReceivePaymentDialog;
