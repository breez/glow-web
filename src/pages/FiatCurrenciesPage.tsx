import React, { useEffect, useState, useCallback } from 'react';
import { LoadingSpinner, Checkbox } from '../components/ui';
import { useWallet } from '@/contexts/WalletContext';
import { getFiatSettings, saveFiatSettings } from '../services/settings';
import type { FiatCurrency } from '@breeztech/breez-sdk-spark';
import SlideInPage from '../components/layout/SlideInPage';
import { logger, LogCategory } from '@/services/logger';

interface FiatCurrenciesPageProps {
  onBack: () => void;
}

const FiatCurrenciesPage: React.FC<FiatCurrenciesPageProps> = ({ onBack }) => {
  const wallet = useWallet();
  const [isLoading, setIsLoading] = useState(true);
  const [currencies, setCurrencies] = useState<FiatCurrency[]>([]);
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>([]);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);

        // Load saved settings
        const settings = getFiatSettings();
        setSelectedCurrencies(settings.selectedCurrencies);

        // Load available currencies from SDK
        const fiatCurrencies = await wallet.listFiatCurrencies();
        setCurrencies(fiatCurrencies);
      } catch (error) {
        logger.error(LogCategory.SDK, 'Failed to load fiat currencies', {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [wallet]);

  const handleToggleCurrency = useCallback((currencyId: string) => {
    setSelectedCurrencies(prev => {
      let newSelection: string[];
      if (prev.includes(currencyId)) {
        // Remove currency
        newSelection = prev.filter(id => id !== currencyId);
      } else {
        // Add currency at the end
        newSelection = [...prev, currencyId];
      }
      // Save immediately
      saveFiatSettings({ selectedCurrencies: newSelection });
      return newSelection;
    });
  }, []);

  const handleDragStart = useCallback((currencyId: string) => {
    setDraggedItem(currencyId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetId) return;

    setSelectedCurrencies(prev => {
      const draggedIndex = prev.indexOf(draggedItem);
      const targetIndex = prev.indexOf(targetId);

      if (draggedIndex === -1 || targetIndex === -1) return prev;

      const newOrder = [...prev];
      newOrder.splice(draggedIndex, 1);
      newOrder.splice(targetIndex, 0, draggedItem);

      // Save immediately
      saveFiatSettings({ selectedCurrencies: newOrder });
      return newOrder;
    });
  }, [draggedItem]);

  const handleDragEnd = useCallback(() => {
    setDraggedItem(null);
  }, []);

  const handleMoveUp = useCallback((currencyId: string) => {
    setSelectedCurrencies(prev => {
      const index = prev.indexOf(currencyId);
      if (index <= 0) return prev;

      const newOrder = [...prev];
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];

      saveFiatSettings({ selectedCurrencies: newOrder });
      return newOrder;
    });
  }, []);

  const handleMoveDown = useCallback((currencyId: string) => {
    setSelectedCurrencies(prev => {
      const index = prev.indexOf(currencyId);
      if (index === -1 || index >= prev.length - 1) return prev;

      const newOrder = [...prev];
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];

      saveFiatSettings({ selectedCurrencies: newOrder });
      return newOrder;
    });
  }, []);

  // Get currency info helper
  const getCurrencyInfo = (currencyId: string): FiatCurrency | undefined => {
    return currencies.find(c => c.id === currencyId);
  };

  // Separate selected and unselected currencies
  const selectedCurrencyList = selectedCurrencies
    .map(id => getCurrencyInfo(id))
    .filter((c): c is FiatCurrency => c !== undefined);

  const unselectedCurrencyList = currencies
    .filter(c => !selectedCurrencies.includes(c.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  return (
    <SlideInPage title="Fiat Currencies" closeStyle="back" onClose={onBack} slideFrom="right">
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {/* Selected currencies - with drag handles */}
          {selectedCurrencyList.map((currency, index) => (
            <div
              key={currency.id}
              draggable
              onDragStart={() => handleDragStart(currency.id)}
              onDragOver={(e) => handleDragOver(e, currency.id)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-3 p-3 bg-spark-dark border border-spark-border rounded-xl transition-all ${draggedItem === currency.id ? 'opacity-50' : ''
                }`}
            >
              {/* Checkbox */}
              <Checkbox
                checked={selectedCurrencies.includes(currency.id)}
                onChange={() => handleToggleCurrency(currency.id)}
              />

              {/* Currency info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display font-semibold text-spark-text-primary">
                    {currency.id}
                  </span>
                  {currency.info.symbol?.grapheme && (
                    <span className="text-spark-text-muted">
                      ({currency.info.symbol.grapheme})
                    </span>
                  )}
                </div>
                <p className="text-sm text-spark-text-muted truncate">
                  {currency.info.name}
                </p>
              </div>

              {/* Reorder buttons (mobile-friendly) */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => handleMoveUp(currency.id)}
                  disabled={index === 0}
                  className="p-1 text-spark-text-muted hover:text-spark-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Move up"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <button
                  onClick={() => handleMoveDown(currency.id)}
                  disabled={index === selectedCurrencyList.length - 1}
                  className="p-1 text-spark-text-muted hover:text-spark-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Move down"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {/* Drag handle */}
              <div className="cursor-grab active:cursor-grabbing text-spark-text-muted hover:text-spark-text-secondary p-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 16h16" />
                </svg>
              </div>
            </div>
          ))}

          {/* Unselected currencies */}
          {unselectedCurrencyList.map((currency) => (
            <div
              key={currency.id}
              className="flex items-center gap-3 p-3 bg-spark-dark/50 border border-spark-border/50 rounded-xl"
            >
              {/* Checkbox */}
              <Checkbox
                checked={false}
                onChange={() => handleToggleCurrency(currency.id)}
              />

              {/* Currency info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display font-medium text-spark-text-secondary">
                    {currency.id}
                  </span>
                  {currency.info.symbol?.grapheme && (
                    <span className="text-spark-text-muted">
                      ({currency.info.symbol.grapheme})
                    </span>
                  )}
                </div>
                <p className="text-sm text-spark-text-muted truncate">
                  {currency.info.name}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </SlideInPage>
  );
};

export default FiatCurrenciesPage;
