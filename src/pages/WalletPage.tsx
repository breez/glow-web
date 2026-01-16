import React, { useState, useRef, useCallback } from 'react';
import { useWallet } from '../contexts/WalletContext';
import {
  LoadingSpinner
} from '../components/ui';
import SendPaymentDialog from '../features/send/SendPaymentDialog';
import ReceivePaymentDialog from '../features/receive/ReceivePaymentDialog';
import QrScannerDialog from '../components/QrScannerDialog';
import PaymentDetailsDialog from '../components/PaymentDetailsDialog';
import CollapsingWalletHeader from '../components/CollapsingWalletHeader';
import SideMenu from '../components/SideMenu';
import TransactionList from '../components/TransactionList';
import { GetInfoResponse, Payment, Config, Network } from '@breeztech/breez-sdk-spark';
import { SendInput } from '@/types/domain';

interface WalletPageProps {
  walletInfo: GetInfoResponse | null;
  transactions: Payment[];
  usdRate: number | null;
  refreshWalletData: (showLoading?: boolean) => Promise<void>;
  isRestoring: boolean;
  error: string | null;
  onClearError: () => void;
  onLogout: () => void;
  config: Config | null;
  onChangeNetwork: (network: Network) => void;
  hasUnclaimedDeposits: boolean;
  onOpenUnclaimedDeposits: () => void;
  onOpenSettings: () => void;
  onOpenBackup: () => void;
}

const WalletPage: React.FC<WalletPageProps> = ({
  walletInfo,
  transactions,
  usdRate,
  refreshWalletData,
  isRestoring,
  onLogout,
  config,
  onChangeNetwork,
  hasUnclaimedDeposits,
  onOpenUnclaimedDeposits,
  onOpenSettings,
  onOpenBackup
}) => {
  const wallet = useWallet();
  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [isReceiveDialogOpen, setIsReceiveDialogOpen] = useState(false);
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [paymentInput, setPaymentInput] = useState<SendInput | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const transactionsContainerRef = useRef<HTMLDivElement>(null);
  const collapseThreshold = 100;

  const handleScroll = useCallback(() => {
    if (transactionsContainerRef.current) {
      const scrollTop = transactionsContainerRef.current.scrollTop;
      const progress = Math.min(1, scrollTop / collapseThreshold);
      setScrollProgress(progress);
    }
  }, [collapseThreshold]);

  const handlePaymentSelected = useCallback((payment: Payment) => {
    setSelectedPayment(payment);
  }, []);

  const handlePaymentDetailsClose = useCallback(() => {
    setSelectedPayment(null);
  }, []);

  const handleSendDialogClose = useCallback(() => {
    setIsSendDialogOpen(false);
    setPaymentInput(null);
    refreshWalletData(false);
  }, [refreshWalletData]);

  const handleReceiveDialogClose = useCallback(() => {
    setIsReceiveDialogOpen(false);
    refreshWalletData(false);
  }, [refreshWalletData]);

  const handleQrScannerClose = () => {
    setIsQrScannerOpen(false);
  };

  const handleQrScan = async (data: string | null) => {
    if (!data) return;

    try {
      const parseResult = await wallet.parseInput(data);
      console.log('Parsed QR result:', parseResult);
      setIsQrScannerOpen(false);
      setPaymentInput({ rawInput: data, parsedInput: parseResult });
      setIsSendDialogOpen(true);
    } catch (error) {
      console.error('Failed to parse QR code:', error);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100dvh)] relative overflow-hidden">
      {/* Atmospheric background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-gradient-radial from-spark-amber/15 via-spark-amber/5 to-transparent blur-3xl" />
        <div className="absolute bottom-1/4 right-0 w-[300px] h-[300px] bg-gradient-radial from-spark-violet/10 to-transparent blur-3xl" />
      </div>

      {/* Restoration overlay */}
      {isRestoring && (
        <div className="absolute inset-0 bg-spark-void/90 backdrop-blur-sm z-50 flex items-center justify-center">
          <LoadingSpinner text="Restoring wallet data..." />
        </div>
      )}

      {/* Fixed header */}
      <div className="sticky top-0 z-10">
        <CollapsingWalletHeader
          walletInfo={walletInfo}
          usdRate={usdRate}
          config={config}
          scrollProgress={scrollProgress}
          onOpenMenu={() => setIsMenuOpen(true)}
          onChangeNetwork={onChangeNetwork}
          hasUnclaimedDeposits={hasUnclaimedDeposits}
          onOpenUnclaimedDeposits={onOpenUnclaimedDeposits}
        />
      </div>

      {/* Scrollable transaction list */}
      <div
        ref={transactionsContainerRef}
        className="flex-grow overflow-y-auto relative z-0"
        onScroll={handleScroll}
      >
        <TransactionList
          transactions={transactions}
          onPaymentSelected={handlePaymentSelected}
        />
      </div>

      {/* Send Payment Dialog */}
      <SendPaymentDialog
        isOpen={isSendDialogOpen}
        onClose={handleSendDialogClose}
        initialPaymentInput={paymentInput}
      />

      {/* Receive Payment Dialog */}
      <ReceivePaymentDialog
        isOpen={isReceiveDialogOpen}
        onClose={handleReceiveDialogClose}
      />

      {/* QR Scanner Dialog */}
      <QrScannerDialog
        isOpen={isQrScannerOpen}
        onClose={handleQrScannerClose}
        onScan={handleQrScan}
      />

      {/* Payment Details Dialog */}
      <PaymentDetailsDialog
        optionalPayment={selectedPayment}
        onClose={handlePaymentDetailsClose}
      />

      {/* Bottom action bar */}
      <div className="bottom-bar flex items-center justify-center gap-4 z-30">
        {/* Send button */}
        <button
          onClick={() => setIsSendDialogOpen(true)}
          className="action-button action-button-send"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
          </svg>
          <span>Send</span>
        </button>

        {/* QR Scanner button */}
        <button
          onClick={() => setIsQrScannerOpen(true)}
          className="action-button action-button-scan"
          aria-label="Scan QR Code"
        >
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3 11h8V3H3v8zm2-6h4v4H5V5zM3 21h8v-8H3v8zm2-6h4v4H5v-4zM13 3v8h8V3h-8zm6 6h-4V5h4v4zM19 13h2v2h-2zM13 13h2v2h-2zM15 15h2v2h-2zM13 17h2v2h-2zM15 19h2v2h-2zM17 17h2v2h-2zM17 13h2v2h-2zM19 15h2v2h-2zM19 19h2v2h-2z" />
          </svg>
        </button>

        {/* Receive button */}
        <button
          onClick={() => setIsReceiveDialogOpen(true)}
          className="action-button action-button-receive"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 13l-5 5m0 0l-5-5m5 5V6" />
          </svg>
          <span>Receive</span>
        </button>
      </div>

      {/* Side Menu */}
      <SideMenu
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onLogout={onLogout}
        onOpenSettings={onOpenSettings}
        onOpenBackup={onOpenBackup}
      />
    </div>
  );
};

export default WalletPage;
