import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface PaymentReceivedCelebrationProps {
  amount: number;
  onClose: () => void;
}

const PaymentReceivedCelebration: React.FC<PaymentReceivedCelebrationProps> = ({ amount, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [particles, setParticles] = useState<Array<{ id: number; x: number; delay: number; color: string }>>([]);

  useEffect(() => {
    // Generate confetti particles
    const newParticles = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 0.5,
      color: ['#f7931a', '#00d4ff', '#8b5cf6', '#22c55e', '#ffffff'][Math.floor(Math.random() * 5)],
    }));
    setParticles(newParticles);

    // Trigger entrance animation
    requestAnimationFrame(() => setIsVisible(true));

    // Auto close after animation
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 500);
    }, 4000);

    return () => clearTimeout(timer);
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
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Confetti particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {particles.map((particle) => (
          <div
            key={particle.id}
            className="absolute w-3 h-3 rounded-full animate-confetti"
            style={{
              left: `${particle.x}%`,
              top: '-20px',
              backgroundColor: particle.color,
              animationDelay: `${particle.delay}s`,
              boxShadow: `0 0 10px ${particle.color}`,
            }}
          />
        ))}
      </div>

      {/* Lightning bolts background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <svg className="absolute top-1/4 left-1/4 w-16 h-16 text-spark-violet/30 animate-ping" fill="currentColor" viewBox="0 0 24 24">
          <path d="M11 19v-5.111L7.5 15.5 13 5v5.111L16.5 8.5 11 19z" />
        </svg>
        <svg className="absolute top-1/3 right-1/4 w-12 h-12 text-spark-primary-blue/30 animate-ping" style={{ animationDelay: '0.2s' }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M11 19v-5.111L7.5 15.5 13 5v5.111L16.5 8.5 11 19z" />
        </svg>
        <svg className="absolute bottom-1/3 left-1/3 w-10 h-10 text-spark-violet/30 animate-ping" style={{ animationDelay: '0.4s' }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M11 19v-5.111L7.5 15.5 13 5v5.111L16.5 8.5 11 19z" />
        </svg>
      </div>

      {/* Main content */}
      <div
        className={`relative z-10 flex flex-col items-center transform transition-all duration-700 ${
          isVisible ? 'scale-100 translate-y-0' : 'scale-50 translate-y-20'
        }`}
      >
        {/* Glowing circle behind icon */}
        <div className="relative mb-6">
          <div className="absolute inset-0 w-32 h-32 rounded-full bg-spark-success/20 animate-pulse-glow blur-xl" />
          <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-spark-success to-spark-primary-blue flex items-center justify-center shadow-2xl">
            <svg className="w-16 h-16 text-white animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-3xl font-display font-bold text-white mb-2 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          Payment Received!
        </h2>

        {/* Amount with glow effect */}
        <div className="relative animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
          <div className="absolute inset-0 blur-lg bg-spark-success/50 rounded-2xl" />
          <div className="relative px-8 py-4 rounded-2xl bg-gradient-to-r from-spark-success/20 to-spark-violet/20 border border-spark-success/50">
            <span className="text-5xl font-display font-bold text-spark-success">
              +{formatAmount(amount)}
            </span>
            <span className="text-2xl font-display text-spark-text-secondary ml-2">sats</span>
          </div>
        </div>

        {/* Lightning icon */}
        <div className="mt-6 animate-fade-in-up" style={{ animationDelay: '0.6s' }}>
          <svg className="w-12 h-12 text-spark-violet animate-pulse" fill="currentColor" viewBox="0 0 24 24">
            <path d="M11 19v-5.111L7.5 15.5 13 5v5.111L16.5 8.5 11 19z" />
          </svg>
        </div>

        {/* Tap to dismiss hint */}
        <p className="mt-8 text-spark-text-muted text-sm animate-fade-in-up" style={{ animationDelay: '0.8s' }}>
          Tap anywhere to dismiss
        </p>
      </div>
    </div>,
    document.body
  );
};

export default PaymentReceivedCelebration;
