import React, { useState } from 'react';
import { DialogHeader, PrimaryButton, LoadingSpinner, FormError, AMOUNT_FIELD_CLASS } from '../../components/ui';
import { MoonPayIcon } from '../../components/Icons';
import { SimpleAlert } from '../../components/AlertCard';
import { normalizeDecimalInput } from '../../utils/decimalInput';
import { MOONPAY_QUICK_AMOUNTS_USD, moonpayAmountError, parseMoonpayAmount } from './moonpay';
import { useTranslation } from 'react-i18next';

interface MoonpayAmountStepProps {
  isStableBalanceActive: boolean;
  onBuyMoonpay: (amount: bigint) => Promise<void>;
  onBack?: () => void;
  onClose: () => void;
}

const moonpayHeaderIcon = (
  <div className="w-5 h-5 rounded-sm bg-white flex items-center justify-center p-0.5">
    <MoonPayIcon className="w-full h-full text-[#7B36D9]" />
  </div>
);

const MoonpayAmountStep: React.FC<MoonpayAmountStepProps> = ({ isStableBalanceActive, onBuyMoonpay, onBack, onClose }) => {
  const [usdInput, setUsdInput] = useState('');
  const { t } = useTranslation('common');
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = parseMoonpayAmount(usdInput);

  const handleAmountChange = (value: string) => {
    const normalized = normalizeDecimalInput(value);
    if (!/^\d*\.?\d{0,2}$/.test(normalized)) return;
    setUsdInput(normalized);
    setError(null);
  };

  const handleContinue = async () => {
    if (amount === null) return;
    const amountError = moonpayAmountError(amount);
    if (amountError) {
      setError(amountError);
      return;
    }
    setIsOpening(true);
    try {
      await onBuyMoonpay(amount);
      onClose();
    } catch {
      setError(t('buy.moonpayOpenFailed'));
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <>
      <DialogHeader title="MoonPay" onClose={onClose} onBack={onBack} icon={moonpayHeaderIcon} />
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-spark-text-primary mb-2">{t('send.amount')}</label>
          <input
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            value={usdInput}
            onChange={(e) => handleAmountChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleContinue();
              }
            }}
            placeholder={t('receive.crossChain.enterUsd')}
            disabled={isOpening}
            className={AMOUNT_FIELD_CLASS}
            data-testid="moonpay-amount-input"
          />
        </div>

        <div className="flex gap-2">
          {MOONPAY_QUICK_AMOUNTS_USD.map((quickAmount) => (
            <button
              key={quickAmount}
              type="button"
              onClick={() => {
                setUsdInput(String(quickAmount));
                setError(null);
              }}
              disabled={isOpening}
              className={`flex-1 py-2 rounded-lg text-sm font-mono font-medium transition-all ${
                usdInput === String(quickAmount)
                  ? 'bg-spark-primary text-white'
                  : 'bg-transparent border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
              }`}
            >
              ${quickAmount}
            </button>
          ))}
        </div>

        <SimpleAlert variant="info" hideIcon>
          {isStableBalanceActive ? t('buy.arrivesUsdNote') : t('buy.arrivesBtcNote')}
        </SimpleAlert>

        <FormError error={error} />

        <PrimaryButton
          onClick={handleContinue}
          disabled={isOpening || amount === null}
          className="w-full"
          data-testid="moonpay-continue-button"
        >
          {isOpening ? <LoadingSpinner size="small" /> : 'Continue'}
        </PrimaryButton>
      </div>
    </>
  );
};

export default MoonpayAmountStep;
