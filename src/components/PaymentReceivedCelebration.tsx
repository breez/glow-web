import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Star positions around the logo (same as sidebar)
const STARS = [
  { x: -45, y: -35, size: 4 },
  { x: 50, y: -30, size: 3 },
  { x: -40, y: 40, size: 3.5 },
  { x: 45, y: 45, size: 3 },
  { x: -12, y: -55, size: 3 },
  { x: 18, y: 55, size: 4 },
  { x: -55, y: 8, size: 3 },
  { x: 58, y: -5, size: 3.5 },
];

interface PaymentReceivedCelebrationProps {
  amount: number;
  onClose: () => void;
}

const PaymentReceivedCelebration: React.FC<PaymentReceivedCelebrationProps> = ({ amount, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [starsAnimating, setStarsAnimating] = useState(false);

  useEffect(() => {
    // Trigger entrance animation
    requestAnimationFrame(() => setIsVisible(true));

    // Start star animation after logo appears
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

  const formatAmount = (sats: number) => {
    return sats.toLocaleString('en-US').replace(/,/g, ' ');
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-all duration-500 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={() => {
        setIsVisible(false);
        setTimeout(onClose, 500);
      }}
    >
      {/* Backdrop with blur */}
      <div className="absolute inset-0 bg-spark-void/90 backdrop-blur-md" />

      {/* Radiating glow rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="absolute w-64 h-64 rounded-full bg-spark-primary/10 animate-ping" style={{ animationDuration: '2s' }} />
        <div className="absolute w-48 h-48 rounded-full bg-spark-primary/15 animate-ping" style={{ animationDuration: '2s', animationDelay: '0.3s' }} />
        <div className="absolute w-32 h-32 rounded-full bg-spark-primary/20 animate-ping" style={{ animationDuration: '2s', animationDelay: '0.6s' }} />
      </div>

      {/* Main content */}
      <div
        className={`relative z-10 flex flex-col items-center transform transition-all duration-700 ${
          isVisible ? 'scale-100 translate-y-0' : 'scale-50 translate-y-20'
        }`}
      >
        {/* Glow Logo with sparkle stars */}
        <div className="relative mb-8">
          {/* Outer glow */}
          <div className="absolute -inset-4 rounded-full bg-spark-primary/30 blur-2xl" />
          
          {/* Logo container */}
          <div className="relative w-28 h-28 flex items-center justify-center">
            <img
              src="/assets/Glow_Logo.png"
              alt="Glow"
              className="w-24 h-24 object-contain drop-shadow-[0_0_30px_rgba(212,165,116,0.6)]"
            />
            
            {/* Sparkle stars */}
            {STARS.map((star, i) => (
              <span
                key={i}
                className={`sidebar-star ${starsAnimating ? 'animate' : ''}`}
                style={{
                  width: star.size,
                  height: star.size,
                  left: `calc(50% + ${star.x}px)`,
                  top: `calc(50% + ${star.y}px)`,
                  boxShadow: starsAnimating ? `0 0 ${star.size * 3}px var(--spark-primary)` : 'none',
                }}
              />
            ))}
          </div>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-display font-bold text-spark-text-primary mb-6 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          Payment Received
        </h2>

        {/* Amount with brand glow */}
        <div className="relative animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
          <div className="absolute inset-0 blur-xl bg-spark-primary/40 rounded-2xl" />
          <div className="relative px-10 py-5 rounded-2xl bg-spark-surface/80 border border-spark-primary/30">
            <span className="text-5xl font-display font-bold text-spark-primary">
              +{formatAmount(amount)}
            </span>
            <span className="text-xl font-display text-spark-text-muted ml-3">sats</span>
          </div>
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
