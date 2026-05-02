import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Payment } from '@breeztech/breez-sdk-spark';
import { useStableBalance } from '../contexts/StableBalanceContext';
import { useFiatData } from '../contexts/FiatDataContext';
import { getTokenAmountFromPayment, formatTokenAmount, buildTokenDisplayConfig } from '../utils/tokenFormatting';
import GlowLogo from './GlowLogo';

interface PaymentReceivedCelebrationProps {
  payment: Payment;
  onClose: () => void;
}

const PaymentReceivedCelebration: React.FC<PaymentReceivedCelebrationProps> = ({ payment, onClose }) => {
  const stableBalance = useStableBalance();
  const { fiatCurrencies } = useFiatData();
  const [isVisible, setIsVisible] = useState(false);
  const [starsAnimating, setStarsAnimating] = useState(false);

  useEffect(() => {
    // Trigger entrance animation
    requestAnimationFrame(() => setIsVisible(true));

    // Start dot animation after the logo settles in
    const starTimer = setTimeout(() => setStarsAnimating(true), 500);

    // Auto close after animation
    const closeTimer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 500);
    }, 4000);

    return () => {
      clearTimeout(starTimer);
      clearTimeout(closeTimer);
    };
  }, [onClose]);

  const formatSatsAmount = (sats: number) => {
    return sats.toLocaleString('en-US').replace(/,/g, '\u2009');
  };

  // Determine display: token amount or sats
  // Always show token denomination for token payments, even if stable balance is off
  let displayText: string | null = null;
  const tokenInfo = getTokenAmountFromPayment(payment);
  if (tokenInfo) {
    const config = stableBalance.displayConfig ?? buildTokenDisplayConfig(tokenInfo.metadata, fiatCurrencies);
    displayText = formatTokenAmount(tokenInfo.amount, config);
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-100 flex items-center justify-center transition-all duration-500 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={() => {
        setIsVisible(false);
        setTimeout(onClose, 500);
      }}
    >
      {/* Backdrop with blur */}
      <div className="absolute inset-0 bg-spark-void/90 backdrop-blur-md" />

      {/* Main content */}
      <div
        className={`relative z-10 flex flex-col items-center transform transition-all duration-700 ${
          isVisible ? 'scale-100 translate-y-0' : 'scale-50 translate-y-20'
        }`}
      >
        {/* Glow Logo */}
        <div className="relative mb-8">
          {/* Outer glow */}
          <div className="absolute -inset-4 rounded-full blur-2xl" style={{ background: 'rgba(212,165,116,0.30)' }} />

          {/* Logo container */}
          <div className="relative w-28 h-28 flex items-center justify-center">
            <GlowLogo
              sizePx={96}
              starsAnimating={starsAnimating}
              imgClassName="drop-shadow-[0_0_30px_rgba(212,165,116,0.6)]"
            />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-display font-bold text-spark-text-primary mb-6 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          Payment Received
        </h2>

        {/* Amount with brand glow */}
        <div className="relative animate-fade-in-up text-center" style={{ animationDelay: '0.4s' }}>
          <div className="absolute inset-0 blur-2xl rounded-full" style={{ background: 'rgba(212,165,116,0.35)' }} />
          {displayText ? (
            <span className="relative text-5xl font-display font-bold text-spark-primary">
              +{(() => {
                const match = displayText.match(/^([^\d-]+)(.*)/);
                if (match) return <><span className="text-3xl opacity-70">{match[1]}</span>{match[2]}</>;
                return displayText;
              })()}
            </span>
          ) : (
            <span className="relative inline-flex items-center gap-1 text-5xl font-mono font-bold text-spark-primary">
              <span className="text-3xl opacity-70">₿</span>
              {formatSatsAmount(Number(payment.amount))}
            </span>
          )}
        </div>

        {/* Tap to dismiss hint */}
        <p className="mt-10 text-spark-text-muted text-sm animate-fade-in-up" style={{ animationDelay: '0.6s' }}>
          Tap anywhere to dismiss
        </p>
      </div>
    </div>,
    document.body
  );
};

export default PaymentReceivedCelebration;
