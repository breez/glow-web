import React, { useState, useCallback } from 'react';
import type { Network } from '@breeztech/breez-sdk-spark';
import { Checkbox } from '../components/ui';
import { ChevronUpIcon, ChevronDownIcon, DragHandleIcon, MoonPayIcon, CashAppIcon } from '../components/Icons';
import SlideInPage from '../components/layout/SlideInPage';
import { getBuyProviderSettings, saveBuyProviderSettings, ALL_BUY_PROVIDERS, type BuyBitcoinProvider } from '../services/settings';

interface BuyProvidersPageProps {
  onBack: () => void;
  slideFrom?: 'up' | 'right';
  /**
   * Close affordance to show in the header. `'close'` (X, top-right)
   * is the conventional modal dismiss used when the page is presented
   * from the wallet's Buy button (`slideFrom="up"`). `'back'` (<,
   * top-left) is the conventional drill-in dismiss used when reached
   * via Settings → Buy Bitcoin Providers (`slideFrom="right"`).
   */
  closeStyle?: 'close' | 'back';
  network?: Network;
}

const providerMeta: Record<BuyBitcoinProvider, { name: string; icon: React.ReactNode }> = {
  moonpay: {
    name: 'MoonPay',
    icon: (
      <div className="w-6 h-6 rounded-sm bg-white flex items-center justify-center p-1">
        <MoonPayIcon className="w-full h-full text-[#7B36D9]" />
      </div>
    ),
  },
  cashApp: {
    name: 'Cash App',
    icon: <CashAppIcon size="lg" className="text-[#00D64F]" />,
  },
};

const BuyProvidersPage: React.FC<BuyProvidersPageProps> = ({ onBack, slideFrom = 'up', closeStyle = 'back', network }) => {
  const isMainnet = network === 'mainnet';
  const [enabledProviders, setEnabledProviders] = useState<BuyBitcoinProvider[]>(getBuyProviderSettings);
  const [draggedItem, setDraggedItem] = useState<BuyBitcoinProvider | null>(null);

  const disabledProviders = ALL_BUY_PROVIDERS.filter(p => !enabledProviders.includes(p));

  const handleToggle = useCallback((provider: BuyBitcoinProvider) => {
    setEnabledProviders(prev => {
      const next = prev.includes(provider)
        ? prev.filter(p => p !== provider)
        : [...prev, provider];
      saveBuyProviderSettings(next);
      return next;
    });
  }, []);

  const handleMoveUp = useCallback((provider: BuyBitcoinProvider) => {
    setEnabledProviders(prev => {
      const i = prev.indexOf(provider);
      if (i <= 0) return prev;
      const next = [...prev];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      saveBuyProviderSettings(next);
      return next;
    });
  }, []);

  const handleMoveDown = useCallback((provider: BuyBitcoinProvider) => {
    setEnabledProviders(prev => {
      const i = prev.indexOf(provider);
      if (i === -1 || i >= prev.length - 1) return prev;
      const next = [...prev];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      saveBuyProviderSettings(next);
      return next;
    });
  }, []);

  const handleDragStart = useCallback((provider: BuyBitcoinProvider) => {
    setDraggedItem(provider);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, target: BuyBitcoinProvider) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === target) return;
    setEnabledProviders(prev => {
      const di = prev.indexOf(draggedItem);
      const ti = prev.indexOf(target);
      if (di === -1 || ti === -1) return prev;
      const next = [...prev];
      next.splice(di, 1);
      next.splice(ti, 0, draggedItem);
      return next;
    });
  }, [draggedItem]);

  const handleDragEnd = useCallback(() => {
    setDraggedItem(null);
    setEnabledProviders(prev => {
      saveBuyProviderSettings(prev);
      return prev;
    });
  }, []);

  return (
    <SlideInPage title="Buy Bitcoin Providers" closeStyle={closeStyle} onClose={onBack} slideFrom={slideFrom}>
      <div className="p-4 space-y-2">
        {/* Enabled providers — reorderable */}
        {enabledProviders.map((provider, index) => {
          const meta = providerMeta[provider];
          return (
            <div
              key={provider}
              draggable
              onDragStart={() => handleDragStart(provider)}
              onDragOver={(e) => handleDragOver(e, provider)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-3 p-3 bg-spark-dark border border-spark-border rounded-xl transition-all ${draggedItem === provider ? 'opacity-50' : ''}`}
            >
              <Checkbox checked onChange={() => handleToggle(provider)} />
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                {meta.icon}
                <div className="flex flex-col">
                  <span className="font-display font-semibold text-spark-text-primary">{meta.name}</span>
                  {provider === 'cashApp' && !isMainnet && (
                    <span className="text-xs text-spark-text-muted">Mainnet only</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => handleMoveUp(provider)}
                  disabled={index === 0}
                  className="p-1 text-spark-text-muted hover:text-spark-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Move up"
                >
                  <ChevronUpIcon />
                </button>
                <button
                  onClick={() => handleMoveDown(provider)}
                  disabled={index === enabledProviders.length - 1}
                  className="p-1 text-spark-text-muted hover:text-spark-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Move down"
                >
                  <ChevronDownIcon />
                </button>
              </div>
              <div className="cursor-grab active:cursor-grabbing text-spark-text-muted hover:text-spark-text-secondary p-1">
                <DragHandleIcon />
              </div>
            </div>
          );
        })}

        {/* Disabled providers */}
        {disabledProviders.map((provider) => {
          const meta = providerMeta[provider];
          return (
            <div
              key={provider}
              className="flex items-center gap-3 p-3 bg-spark-dark/50 border border-spark-border/50 rounded-xl"
            >
              <Checkbox checked={false} onChange={() => handleToggle(provider)} />
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                {meta.icon}
                <div className="flex flex-col">
                  <span className="font-display font-medium text-spark-text-secondary">{meta.name}</span>
                  {provider === 'cashApp' && !isMainnet && (
                    <span className="text-xs text-spark-text-muted">Mainnet only</span>
                  )}
                </div>
              </div>
              {/* Invisible placeholders to match enabled row height */}
              <div className="flex flex-col gap-0.5 invisible">
                <div className="p-1"><ChevronUpIcon /></div>
                <div className="p-1"><ChevronDownIcon /></div>
              </div>
              <div className="p-1 invisible">
                <DragHandleIcon />
              </div>
            </div>
          );
        })}
      </div>
    </SlideInPage>
  );
};

export default BuyProvidersPage;
