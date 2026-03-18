import React, { useEffect, useState } from 'react';
import { CheckIcon, CloseIcon, ExclamationIcon, InfoCircleIcon } from './Icons';

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
  duration = 4000
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    // Trigger entrance animation
    requestAnimationFrame(() => setIsVisible(true));

    if (autoClose) {
      const startTime = Date.now();
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
        setProgress(remaining);
        if (remaining === 0) {
          clearInterval(interval);
          setIsVisible(false);
          setTimeout(onClose, 300);
        }
      }, 50);
      return () => clearInterval(interval);
    }
  }, [autoClose, duration, onClose]);

  const getStyles = () => {
    switch (type) {
      case 'success':
        return {
          icon: <CheckIcon />,
          bg: 'bg-spark-success',
          progressBg: 'bg-white/30'
        };
      case 'error':
        return {
          icon: <CloseIcon />,
          bg: 'bg-spark-error',
          progressBg: 'bg-white/30'
        };
      case 'warning':
        return {
          icon: <ExclamationIcon />,
          bg: 'bg-spark-warning',
          progressBg: 'bg-black/20'
        };
      case 'info':
      default:
        return {
          icon: <InfoCircleIcon />,
          bg: 'bg-spark-electric',
          progressBg: 'bg-white/30'
        };
    }
  };

  const { icon, bg, progressBg } = getStyles();

  return (
    <div
      className={`
        toast-notification
      `}
    >
      <div
        className={`
          pointer-events-auto overflow-hidden rounded-xl shadow-lg
          transform transition-all duration-300 ease-out
          ${isVisible ? 'translate-y-0 opacity-100 scale-100' : '-translate-y-4 opacity-0 scale-95'}
          ${bg}
        `}
      >
        <div className="flex items-center gap-3 px-4 py-3 text-white">
          {/* Icon */}
          <div className="flex-shrink-0">
            {icon}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{message}</p>
            {detail && (
              <p className="text-xs opacity-90 mt-0.5 line-clamp-1">{detail}</p>
            )}
          </div>

          {/* Close button */}
          <button
            onClick={() => {
              setIsVisible(false);
              setTimeout(onClose, 300);
            }}
            className="flex-shrink-0 p-1 opacity-70 hover:opacity-100 transition-opacity"
          >
            <CloseIcon size="sm" />
          </button>
        </div>

        {/* Progress bar */}
        {autoClose && (
          <div className={`h-1 ${progressBg}`}>
            <div
              className="h-full bg-white/50 transition-all duration-50 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default ToastNotification;
