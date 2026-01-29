import React, { useState, useRef, useCallback } from 'react';
import { useWallet } from '../contexts/WalletContext';
import {
  LoadingSpinner
} from '../components/ui';
import CollapsingWalletHeader from '../components/CollapsingWalletHeader';
import SideMenu from '../components/SideMenu';
import TransactionList from '../components/TransactionList';
import { GetInfoResponse, Payment, Rate, FiatCurrency, DepositInfo } from '@breeztech/breez-sdk-spark';
import { SendInput } from '@/types/domain';
import { mergeDepositsWithTransactions, ExtendedPayment, isUnclaimedDepositPayment } from '@/utils/depositHelpers';
import SendPaymentDialog from '../features/send/SendPaymentDialog';
import ReceivePaymentDialog from '../features/receive/ReceivePaymentDialog';
import QrScannerDialog from '../components/QrScannerDialog';
import PaymentDetailsDialog from '../components/PaymentDetailsDialog';
import UnclaimedDepositDetailsPage from './UnclaimedDepositDetailsPage';

interface WalletPageProps {
  walletInfo: GetInfoResponse | null;
  transactions: Payment[];
  unclaimedDeposits: DepositInfo[];
  fiatRates: Rate[];
  fiatCurrencies: FiatCurrency[];
  refreshWalletData: (showLoading?: boolean) => Promise<void>;
  isRestoring: boolean;
  error: string | null;
  onClearError: () => void;
  onLogout: () => void;
  hasUnclaimedDeposits: boolean;
  onOpenGetRefund: (source?: 'menu' | 'icon') => void;
  onOpenSettings: () => void;
  onOpenBackup: () => void;
  onDepositChanged?: () => void;
}

const WalletPage: React.FC<WalletPageProps> = ({
  walletInfo,
  transactions,
  unclaimedDeposits,
  fiatRates,
  fiatCurrencies,
  refreshWalletData,
  isRestoring,
  onLogout,
  hasUnclaimedDeposits,
  onOpenGetRefund,
  onOpenSettings,
  onOpenBackup,
  onDepositChanged
}) => {
  const wallet = useWallet();
  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [isReceiveDialogOpen, setIsReceiveDialogOpen] = useState(false);
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const [scannerOpenedFromSend, setScannerOpenedFromSend] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [selectedDeposit, setSelectedDeposit] = useState<DepositInfo | null>(null);
  const [paymentInput, setPaymentInput] = useState<SendInput | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const transactionsContainerRef = useRef<HTMLDivElement>(null);

  // Refs for dialog states to use in stable callbacks (advanced-event-handler-refs optimization)
  const dialogStateRef = useRef({ isSendDialogOpen, isReceiveDialogOpen, selectedPayment, selectedDeposit });
  dialogStateRef.current = { isSendDialogOpen, isReceiveDialogOpen, selectedPayment, selectedDeposit };
  const collapseThreshold = 100;

  const handleScroll = useCallback(() => {
    if (transactionsContainerRef.current) {
      const scrollTop = transactionsContainerRef.current.scrollTop;
      const progress = Math.min(1, scrollTop / collapseThreshold);
      setScrollProgress(progress);
    }
  }, [collapseThreshold]);

  const handlePaymentSelected = useCallback((payment: Payment | ExtendedPayment) => {
    // Use ref to check dialog states without adding to dependencies
    const { isSendDialogOpen, isReceiveDialogOpen, selectedPayment, selectedDeposit } = dialogStateRef.current;

    // If any dialog is open, just close it without opening payment details
    if (isSendDialogOpen || isReceiveDialogOpen || selectedPayment || selectedDeposit) {
      setIsSendDialogOpen(false);
      setIsReceiveDialogOpen(false);
      setSelectedPayment(null);
      setSelectedDeposit(null);
      return;
    }

    // Check if this is an unclaimed deposit
    if (isUnclaimedDepositPayment(payment) && payment.depositInfo) {
      // Open deposit details dialog
      setSelectedDeposit(payment.depositInfo);
    } else {
      // Open regular payment details
      setSelectedPayment(payment);
    }
  }, []);

  const handlePaymentDetailsClose = useCallback(() => {
    setSelectedPayment(null);
  }, []);

  const handleDepositDetailsClose = useCallback(() => {
    setSelectedDeposit(null);
  }, []);

  const handleDepositChanged = useCallback(async () => {
    setSelectedDeposit(null);
    onDepositChanged?.();
    await refreshWalletData(false);
  }, [onDepositChanged, refreshWalletData]);

  const handleSendDialogClose = useCallback(() => {
    setIsSendDialogOpen(false);
    setPaymentInput(null);
    refreshWalletData(false);
  }, [refreshWalletData]);

  const handleReceiveDialogClose = useCallback(() => {
    setIsReceiveDialogOpen(false);
    refreshWalletData(false);
  }, [refreshWalletData]);

  const handleQrScannerClose = useCallback(() => {
    setIsQrScannerOpen(false);
    // If scanner was opened from Send dialog, reopen it
    if (scannerOpenedFromSend) {
      setScannerOpenedFromSend(false);
      setIsSendDialogOpen(true);
    }
  }, [scannerOpenedFromSend]);

  const handleScanFromSendDialog = useCallback(() => {
    setIsSendDialogOpen(false);
    setPaymentInput(null);
    setScannerOpenedFromSend(true);
    setIsQrScannerOpen(true);
  }, []);

  const handleQrScan = async (data: string | null) => {
    if (!data) return;

    try {
      const parseResult = await wallet.parseInput(data);
      console.log('Parsed QR result:', parseResult);
      setIsQrScannerOpen(false);
      setScannerOpenedFromSend(false);
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
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-gradient-radial from-spark-primary/15 via-spark-primary/5 to-transparent blur-3xl" />
        <div className="absolute bottom-1/4 right-0 w-[300px] h-[300px] bg-gradient-radial from-spark-primary/10 to-transparent blur-3xl" />
      </div>

      {/* Restoration overlay */}
      {isRestoring && (
        <div className="absolute inset-0 bg-spark-void/90 backdrop-blur-sm z-50 flex items-center justify-center">
          <LoadingSpinner text="Loading..." />
        </div>
      )}

      {/* Fixed header */}
      <div className="sticky top-0 z-10">
        <CollapsingWalletHeader
          walletInfo={walletInfo}
          fiatRates={fiatRates}
          fiatCurrencies={fiatCurrencies}
          scrollProgress={scrollProgress}
          onOpenMenu={() => setIsMenuOpen(true)}
          hasUnclaimedDeposits={hasUnclaimedDeposits}
          onOpenGetRefund={() => onOpenGetRefund('icon')}
        />
      </div>

      {/* Scrollable transaction list */}
      <div
        ref={transactionsContainerRef}
        className="flex-grow overflow-y-auto relative z-0 scrollbar-hidden"
        onScroll={handleScroll}
      >
        <TransactionList
          transactions={mergeDepositsWithTransactions(transactions, unclaimedDeposits)}
          onPaymentSelected={handlePaymentSelected}
        />
      </div>

      {/* Send Payment Dialog - always mounted for instant response */}
      <SendPaymentDialog
        isOpen={isSendDialogOpen}
        onClose={handleSendDialogClose}
        initialPaymentInput={paymentInput}
        onScanQr={handleScanFromSendDialog}
      />

      {/* Receive Payment Dialog - always mounted for instant response */}
      <ReceivePaymentDialog
        isOpen={isReceiveDialogOpen}
        onClose={handleReceiveDialogClose}
      />

      {/* QR Scanner Dialog */}
      {isQrScannerOpen && (
        <QrScannerDialog
          isOpen={isQrScannerOpen}
          onClose={handleQrScannerClose}
          onScan={handleQrScan}
        />
      )}

      {/* Payment Details Dialog */}
      {selectedPayment && (
        <PaymentDetailsDialog
          optionalPayment={selectedPayment}
          onClose={handlePaymentDetailsClose}
        />
      )}

      {/* Unclaimed Deposit Details */}
      {selectedDeposit && (
        <UnclaimedDepositDetailsPage
          deposit={selectedDeposit}
          onBack={handleDepositDetailsClose}
          onChanged={handleDepositChanged}
        />
      )}

      {/* Bottom action bar - full width layout */}
      <div className="bottom-bar flex items-center z-30">
        {/* Send button */}
        <button
          onClick={() => setIsSendDialogOpen(true)}
          className="action-button action-button-send"
          data-testid="send-button"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
          </svg>
          <span>Send</span>
        </button>

        {/* QR Scanner button - viewfinder style */}
        <button
          onClick={() => setIsQrScannerOpen(true)}
          className="qr-scanner-button"
          aria-label="Scan QR Code"
          data-testid="scan-button"
        >
          <span className="qr-corner qr-corner--tl" />
          <span className="qr-corner qr-corner--tr" />
          <span className="qr-corner qr-corner--bl" />
          <span className="qr-corner qr-corner--br" />
          <svg fill="currentColor" viewBox="0 0 24 24">
            <path d="M3 11h8V3H3v8zm2-6h4v4H5V5zM3 21h8v-8H3v8zm2-6h4v4H5v-4zM13 3v8h8V3h-8zm6 6h-4V5h4v4zM19 13h2v2h-2zM13 13h2v2h-2zM15 15h2v2h-2zM13 17h2v2h-2zM15 19h2v2h-2zM17 17h2v2h-2zM17 13h2v2h-2zM19 15h2v2h-2zM19 19h2v2h-2z" />
          </svg>
        </button>

        {/* Receive button */}
        <button
          onClick={() => setIsReceiveDialogOpen(true)}
          className="action-button action-button-receive"
          data-testid="receive-button"
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
        onOpenRefund={() => onOpenGetRefund('menu')}
        hasRejectedDeposits={hasUnclaimedDeposits}
      />
    </div>
  );
};

export default WalletPage;
