import React, { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastNotificationProps {
  type: ToastType;
  message: string;
  detail?: string;
  onClose: () => void;
  autoClose?: boolean;
  duration?: number;
}

const ToastNotification: React.FC<ToastNotificationProps> = ({
  type,
  message,
  detail,
  onClose,
  autoClose = true,
  duration = 5000
}) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (autoClose) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(onClose, 300);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [autoClose, duration, onClose]);

  const getIconAndStyles = () => {
    switch (type) {
      case 'success':
        return {
          icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ),
          iconBg: 'bg-spark-success/20',
          iconColor: 'text-spark-success',
          borderColor: 'border-spark-success/30',
          glowClass: 'shadow-[0_0_20px_rgba(16,185,129,0.2)]'
        };
      case 'error':
        return {
          icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ),
          iconBg: 'bg-spark-error/20',
          iconColor: 'text-spark-error',
          borderColor: 'border-spark-error/30',
          glowClass: 'shadow-[0_0_20px_rgba(239,68,68,0.2)]'
        };
      case 'warning':
        return {
          icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ),
          iconBg: 'bg-spark-warning/20',
          iconColor: 'text-spark-warning',
          borderColor: 'border-spark-warning/30',
          glowClass: 'shadow-[0_0_20px_rgba(245,158,11,0.2)]'
        };
      case 'info':
      default:
        return {
          icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          iconBg: 'bg-spark-electric/20',
          iconColor: 'text-spark-electric',
          borderColor: 'border-spark-electric/30',
          glowClass: 'shadow-[0_0_20px_rgba(0,212,255,0.2)]'
        };
    }
  };

  const { icon, iconBg, iconColor, borderColor, glowClass } = getIconAndStyles();

  return (
    <div
      className={`
        fixed top-4 right-4 z-50 max-w-sm
        transform transition-all duration-300 ease-out
        ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
      `}
    >
      <div className={`
        flex items-start gap-3 p-4 rounded-2xl
        bg-spark-surface/95 backdrop-blur-xl
        border ${borderColor}
        shadow-glass ${glowClass}
      `}>
        {/* Icon */}
        <div className={`flex-shrink-0 w-10 h-10 rounded-xl ${iconBg} ${iconColor} flex items-center justify-center`}>
          {icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pt-0.5">
          <h3 className="font-display font-semibold text-spark-text-primary">{message}</h3>
          {detail && (
            <p className="text-sm text-spark-text-secondary mt-0.5 line-clamp-2">{detail}</p>
          )}
        </div>

        {/* Close button */}
        <button
          onClick={() => {
            setIsVisible(false);
            setTimeout(onClose, 300);
          }}
          className="flex-shrink-0 p-1.5 -mr-1 -mt-1 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default ToastNotification;
