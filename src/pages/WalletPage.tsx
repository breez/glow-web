import React, { useState, useRef, useCallback, useMemo } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { useToast } from '../contexts/ToastContext';
import { logger, LogCategory } from '@/services/logger';
import CollapsingWalletHeader from '../components/CollapsingWalletHeader';
import SideMenu from '../components/SideMenu';
import TransactionList from '../components/TransactionList';
import { GetInfoResponse, Payment, DepositInfo, Network } from '@breeztech/breez-sdk-spark';
import type { BuyBitcoinProvider } from '../services/settings';
import { ArrowUpIcon, QrCodeIcon, ArrowDownIcon } from '../components/Icons';
import { mergeDepositsWithTransactions, ExtendedPayment, isUnclaimedDepositPayment } from '@/utils/depositHelpers';
import SendPaymentDialog from '../features/send/SendPaymentDialog';
import ReceivePaymentDialog from '../features/receive/ReceivePaymentDialog';
import QrScannerDialog from '../components/QrScannerDialog';
import PaymentDetailsDialog from '../components/PaymentDetailsDialog';
import { useLatest } from '../hooks/useLatest';
import UnclaimedDepositDetailsPage from './UnclaimedDepositDetailsPage';
import SaveContactDialog from '../features/send/components/SaveContactDialog';
import BuyBitcoinDialog from '../features/buy/BuyBitcoinDialog';
import { getBuyProviderSettings, filterProvidersByNetwork } from '../services/settings';
import { useStatusBarColor } from '../hooks/useStatusBarColor';
import { STATUS_BAR_WALLET_GLASS } from '../utils/statusBarManager';

interface WalletPageProps {
  walletInfo: GetInfoResponse | null;
  transactions: Payment[];
  unclaimedDeposits: DepositInfo[];
  refreshWalletData: (showLoading?: boolean) => Promise<void>;
  isSyncing: boolean;
  error: string | null;
  onClearError: () => void;
  onLogout: () => void;
  hasRejectedDeposits: boolean;
  onOpenGetRefund: (source?: 'menu' | 'icon') => void;
  onOpenSettings: () => void;
  onOpenBackup: () => void;
  onOpenBuyProviders: () => void;
  onBuyBitcoin: (provider: BuyBitcoinProvider) => Promise<void>;
  network?: Network;
  onDepositChanged?: () => void;
}

const WalletPage: React.FC<WalletPageProps> = ({
  walletInfo,
  transactions,
  unclaimedDeposits,
  refreshWalletData,
  isSyncing,
  onLogout,
  hasRejectedDeposits,
  onOpenGetRefund,
  onOpenSettings,
  onOpenBackup,
  onOpenBuyProviders,
  onBuyBitcoin,
  network,
  onDepositChanged,
}) => {
  const wallet = useWallet();
  const { showToast } = useToast();

  // Tint the native system bars to the wallet page glass effective
  // color so the CollapsingWalletHeader glassmorphism reads as a
  // continuous surface with the status bar. Other pages (drawer,
  // slide-ins, landing) push spark-surface on top of this via the
  // same manager, and their pop restores #13131d when they close.
  useStatusBarColor(STATUS_BAR_WALLET_GLASS);

  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [isReceiveDialogOpen, setIsReceiveDialogOpen] = useState(false);
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const [scannerOpenedFromSend, setScannerOpenedFromSend] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [selectedDeposit, setSelectedDeposit] = useState<DepositInfo | null>(null);
  const [paymentInput, setPaymentInput] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isBuyBitcoinOpen, setIsBuyBitcoinOpen] = useState(false);
  const [isBuyLoading, setIsBuyLoading] = useState(false);
  // Re-read when menu closes (user may have changed providers in BuyProvidersPage)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const enabledBuyProviders = useMemo(() => filterProvidersByNetwork(getBuyProviderSettings(), network), [isMenuOpen, network]);
  const [saveContactAddress, setSaveContactAddress] = useState<string | null>(null);
  // Bump these on each open so each dialog remounts and lazy-inits its
  // state, instead of relying on a reset-in-effect inside the dialog.
  const [saveContactSession, setSaveContactSession] = useState(0);
  const [sendDialogSession, setSendDialogSession] = useState(0);
  const [receiveDialogSession, setReceiveDialogSession] = useState(0);
  const [buyBitcoinSession, setBuyBitcoinSession] = useState(0);

  const openSendDialog = useCallback(() => {
    setSendDialogSession(s => s + 1);
    setIsSendDialogOpen(true);
  }, []);
  const openReceiveDialog = useCallback(() => {
    setReceiveDialogSession(s => s + 1);
    setIsReceiveDialogOpen(true);
  }, []);
  const openBuyBitcoinDialog = useCallback(() => {
    setBuyBitcoinSession(s => s + 1);
    setIsBuyBitcoinOpen(true);
  }, []);

  const transactionsContainerRef = useRef<HTMLDivElement>(null);

  // Refs for dialog states to use in stable callbacks (advanced-event-handler-refs optimization)
  const dialogStateRef = useLatest({ isSendDialogOpen, isReceiveDialogOpen, selectedPayment, selectedDeposit });
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
  }, [dialogStateRef]);

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

  const handleSuccessfulSend = useCallback((lightningAddress?: string) => {
    if (lightningAddress) {
      setTimeout(() => {
        showToast('info', 'Save as contact?', lightningAddress, {
          label: 'Save',
          onClick: () => {
            setSaveContactSession(s => s + 1);
            setSaveContactAddress(lightningAddress);
          },
        });
      }, 500);
    }
  }, [showToast]);

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
      openSendDialog();
    }
  }, [scannerOpenedFromSend, openSendDialog]);

  const handleScanFromSendDialog = useCallback(() => {
    setIsSendDialogOpen(false);
    setPaymentInput(null);
    setScannerOpenedFromSend(true);
    setIsQrScannerOpen(true);
  }, []);

  const handleQrScan = async (data: string | null) => {
    if (!data) return;

    try {
      const parseResult = await wallet.parse(data);
      logger.debug(LogCategory.UI, 'Parsed QR result', {
        resultType: parseResult.type,
      });
      setIsQrScannerOpen(false);
      setScannerOpenedFromSend(false);
      setPaymentInput(data);
      openSendDialog();
    } catch (error) {
      logger.error(LogCategory.UI, 'Failed to parse QR code', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="flex flex-col h-[calc(100dvh)] relative overflow-hidden">
      {/* Atmospheric background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-gradient-radial from-spark-primary/15 via-spark-primary/5 to-transparent blur-3xl" />
        <div className="absolute bottom-1/4 right-0 w-[300px] h-[300px] bg-gradient-radial from-spark-primary/10 to-transparent blur-3xl" />
      </div>

      {/* Fixed header */}
      <div className="sticky top-0 z-10">
        <CollapsingWalletHeader
          walletInfo={walletInfo}
          scrollProgress={scrollProgress}
          onOpenMenu={() => setIsMenuOpen(true)}
          onOpenBuyBitcoin={() => {
            if (enabledBuyProviders.length === 0) {
              onOpenBuyProviders();
            } else if (enabledBuyProviders.length === 1 && enabledBuyProviders[0] === 'moonpay') {
              // MoonPay can redirect directly; Cash App needs amount entry via the dialog.
              setIsBuyLoading(true);
              onBuyBitcoin(enabledBuyProviders[0]).finally(() => setIsBuyLoading(false));
            } else {
              openBuyBitcoinDialog();
            }
          }}
          isBuyLoading={isBuyLoading}
          isSyncing={isSyncing}
          refreshWalletData={() => refreshWalletData(false)}
          hasRejectedDeposits={hasRejectedDeposits}
          onOpenGetRefund={() => onOpenGetRefund('icon')}
        />
      </div>

      {/* Scrollable transaction list */}
      <div
        ref={transactionsContainerRef}
        className="grow overflow-y-auto relative z-0 scrollbar-hidden"
        onScroll={handleScroll}
      >
        <TransactionList
          transactions={mergeDepositsWithTransactions(transactions, unclaimedDeposits)}
          onPaymentSelected={handlePaymentSelected}
          isSyncing={isSyncing}
        />
      </div>

      {/* Send Payment Dialog - always mounted for instant response */}
      <SendPaymentDialog
        key={`send-${sendDialogSession}`}
        isOpen={isSendDialogOpen}
        onClose={handleSendDialogClose}
        initialRawInput={paymentInput}
        onScanQr={handleScanFromSendDialog}
        onSuccessfulSend={handleSuccessfulSend}
      />

      {/* Receive Payment Dialog - always mounted for instant response */}
      <ReceivePaymentDialog
        key={`receive-${receiveDialogSession}`}
        isOpen={isReceiveDialogOpen}
        onClose={handleReceiveDialogClose}
      />

      {/* Buy Bitcoin Dialog */}
      <BuyBitcoinDialog
        key={`buy-${buyBitcoinSession}`}
        isOpen={isBuyBitcoinOpen}
        onClose={() => setIsBuyBitcoinOpen(false)}
        onBuyBitcoin={onBuyBitcoin}
        network={network}
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

      {/* Keyed on deposit identity so the page remounts on a new
          selection and lazy-inits its claim/fee state. */}
      {selectedDeposit && (
        <UnclaimedDepositDetailsPage
          key={`${selectedDeposit.txid}:${selectedDeposit.vout}`}
          deposit={selectedDeposit}
          onBack={handleDepositDetailsClose}
          onChanged={handleDepositChanged}
        />
      )}

      {/* Bottom action bar - full width layout */}
      <div className="bottom-bar flex items-center z-30">
        {/* Send button */}
        <button
          onClick={openSendDialog}
          className="action-button action-button-send"
          data-testid="send-button"
        >
          <ArrowUpIcon />
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
          <QrCodeIcon />
        </button>

        {/* Receive button */}
        <button
          onClick={openReceiveDialog}
          className="action-button action-button-receive"
          data-testid="receive-button"
        >
          <ArrowDownIcon />
          <span>Receive</span>
        </button>
      </div>

      {/* Save Contact Dialog */}
      <SaveContactDialog
        key={`save-contact-${saveContactSession}`}
        isOpen={!!saveContactAddress}
        lightningAddress={saveContactAddress || ''}
        onClose={() => setSaveContactAddress(null)}
      />

      {/* Side Menu */}
      <SideMenu
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onLogout={onLogout}
        onOpenSettings={onOpenSettings}
        onOpenBackup={onOpenBackup}
        onOpenRefund={() => onOpenGetRefund('menu')}
        hasRejectedDeposits={hasRejectedDeposits}
      />
    </div>
  );
};

export default WalletPage;
