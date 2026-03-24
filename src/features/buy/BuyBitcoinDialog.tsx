import React, { useState, useMemo } from 'react';
import {
  BottomSheetContainer,
  BottomSheetCard,
  DialogHeader,
} from '../../components/ui';
import type { Network } from '@breeztech/breez-sdk-spark';
import { CurrencyIcon, MoonPayIcon, CashAppIcon } from '../../components/Icons';
import { getBuyProviderSettings, filterProvidersByNetwork, type BuyBitcoinProvider } from '../../services/settings';

const providerMeta: Record<BuyBitcoinProvider, { name: string; icon: React.ReactNode; loadingIcon: React.ReactNode }> = {
  moonpay: {
    name: 'MoonPay',
    icon: (
      <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center flex-shrink-0 p-2">
        <MoonPayIcon className="w-full h-full text-[#7B36D9]" />
      </div>
    ),
    loadingIcon: (
      <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center flex-shrink-0 p-2 animate-pulse">
        <MoonPayIcon className="w-full h-full text-[#7B36D9]" />
      </div>
    ),
  },
  cashApp: {
    name: 'Cash App',
    icon: (
      <div className="w-11 h-11 rounded-xl bg-[#00D64F] flex items-center justify-center flex-shrink-0 p-1">
        <CashAppIcon className="w-full h-full text-[#00D64F]" />
      </div>
    ),
    loadingIcon: (
      <div className="w-11 h-11 rounded-xl bg-[#00D64F] flex items-center justify-center flex-shrink-0 p-1 animate-pulse">
        <CashAppIcon className="w-full h-full text-[#00D64F]" />
      </div>
    ),
  },
};

interface BuyBitcoinDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onBuyBitcoin: (provider: BuyBitcoinProvider) => Promise<void>;
  network?: Network;
}

const BuyBitcoinDialog: React.FC<BuyBitcoinDialogProps> = ({
  isOpen,
  onClose,
  onBuyBitcoin,
  network,
}) => {
  const [loading, setLoading] = useState<BuyBitcoinProvider | null>(null);
  // Re-read provider settings each time the dialog opens, filtered by network
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const enabledProviders = useMemo(() => filterProvidersByNetwork(getBuyProviderSettings(), network), [isOpen, network]);

  const handleSelectProvider = async (provider: BuyBitcoinProvider) => {
    setLoading(provider);
    try {
      await onBuyBitcoin(provider);
      onClose();
    } catch {
      // Error handling is done in useBreezSdk
    } finally {
      setLoading(null);
    }
  };

  return (
    <BottomSheetContainer isOpen={isOpen} onClose={onClose} showBackdrop>
      <BottomSheetCard>
        <DialogHeader
          title="Buy Bitcoin"
          onClose={onClose}
          icon={<CurrencyIcon size="md" />}
        />

        <div className="space-y-3">
          {enabledProviders.map((provider) => {
            const meta = providerMeta[provider];
            const isLoading = loading === provider;
            return (
              <button
                key={provider}
                onClick={() => handleSelectProvider(provider)}
                disabled={loading !== null}
                className="w-full flex items-center gap-4 p-4 rounded-2xl border border-spark-border hover:border-spark-primary/40 hover:bg-spark-primary/5 transition-all text-left disabled:opacity-50"
              >
                {isLoading ? meta.loadingIcon : meta.icon}
                <span className="font-display font-semibold text-spark-text-primary text-sm">
                  {isLoading ? 'Redirecting…' : meta.name}
                </span>
              </button>
            );
          })}
        </div>
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default BuyBitcoinDialog;
