import React, { ReactNode, forwardRef, useState, useRef } from 'react';
import QRCode from 'react-qr-code';
import { Transition } from '@headlessui/react';

// ============================================
// DIALOG COMPONENTS
// ============================================

export const DialogContainer: React.FC<{
  children: ReactNode;
  className?: string;
}> = ({ children, className = "" }) => (
  <div className={`fixed inset-0 bg-spark-void/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-opacity duration-300 ${className}`}>
    {children}
  </div>
);

interface DialogCardProps {
  children: ReactNode;
  className?: string;
  maxWidth?: string;
}

export const DialogCard = forwardRef<HTMLDivElement, DialogCardProps>(
  ({ children, className = "", maxWidth = "md" }, ref) => {
    const maxWidthMap: Record<string, string> = {
      'sm': 'max-w-sm',
      'md': 'max-w-md',
      'lg': 'max-w-lg',
      'xl': 'max-w-xl',
      '2xl': 'max-w-2xl',
      'full': 'max-w-full'
    };

    const widthClass = maxWidthMap[maxWidth] || 'max-w-md';

    return (
      <div
        ref={ref}
        className={`glass-card w-full ${widthClass} overflow-hidden relative p-6 ${className}`}
      >
        {children}
      </div>
    );
  }
);

DialogCard.displayName = 'DialogCard';

export const DialogHeader: React.FC<{
  title: string;
  onClose: () => void;
  icon?: ReactNode;
}> = ({ title, onClose, icon }) => (
  <div className="flex justify-center items-center mb-5 relative">
    <div className="flex items-center gap-2">
      {icon && <span className="text-spark-primary">{icon}</span>}
      <h2 className="font-display text-lg font-bold text-spark-text-primary">{title}</h2>
      <span className="w-5 h-5" aria-hidden="true" />
    </div>
    <button
      onClick={onClose}
      className="absolute right-0 top-1/2 -translate-y-1/2 p-2 -mr-2 text-spark-text-muted hover:text-spark-error transition-colors rounded-lg hover:bg-white/5"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>
);

// ============================================
// FORM COMPONENTS
// ============================================

export const FormGroup: React.FC<{
  children: ReactNode;
  className?: string;
}> = ({ children, className = "" }) => (
  <div className={`space-y-4 ${className}`}>
    {children}
  </div>
);

export const FormLabel: React.FC<{
  htmlFor: string;
  children: ReactNode;
}> = ({ htmlFor, children }) => (
  <label htmlFor={htmlFor} className="block text-sm font-medium text-spark-text-secondary mb-1">
    {children}
  </label>
);

export const FormDescription: React.FC<{
  children: ReactNode;
}> = ({ children }) => (
  <p className="text-sm text-spark-text-muted">
    {children}
  </p>
);

export const FormInput: React.FC<{
  id: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
}> = ({ id, type = "text", value, onChange, placeholder, min, max, disabled = false, className = "" }) => (
  <input
    id={id}
    type={type}
    value={value}
    onChange={onChange}
    className={`w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 text-spark-text-primary placeholder-spark-text-muted focus:border-spark-primary focus:ring-2 focus:ring-spark-primary/20 transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    placeholder={placeholder}
    min={min}
    max={max}
    disabled={disabled}
  />
);

export const FormTextarea: React.FC<{
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  rows?: number;
}> = ({ value, onChange, placeholder, disabled = false, className = "", rows = 3 }) => (
  <textarea
    value={value}
    onChange={onChange}
    className={`w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 text-spark-text-primary placeholder-spark-text-muted focus:border-spark-primary focus:ring-2 focus:ring-spark-primary/20 transition-all resize-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    placeholder={placeholder}
    disabled={disabled}
    rows={rows}
  />
);

export const FormError: React.FC<{
  error: string | null;
}> = ({ error }) => {
  if (!error) return null;
  return (
    <div className="flex items-center gap-2 text-spark-error text-sm mt-2">
      <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
      </svg>
      <span>{error}</span>
    </div>
  );
};

export const FormHint: React.FC<{
  children: ReactNode;
}> = ({ children }) => (
  <p className="text-xs mt-1.5 text-spark-text-muted">
    {children}
  </p>
);

// ============================================
// BUTTON COMPONENTS
// ============================================

export const PrimaryButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}> = ({ onClick, disabled = false, children, className = "" }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`button ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
  >
    {children}
  </button>
);

export const SecondaryButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}> = ({ onClick, disabled = false, children, className = "" }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`py-3 font-display font-semibold text-spark-text-secondary border border-spark-border rounded-xl hover:text-spark-text-primary hover:border-spark-border-light transition-colors disabled:opacity-50 ${className}`}
  >
    {children}
  </button>
);

export const TextButton: React.FC<{
  onClick: () => void;
  children: ReactNode;
  className?: string;
}> = ({ onClick, children, className = "" }) => (
  <button
    onClick={onClick}
    className={`text-spark-text-muted text-xs hover:text-spark-text-secondary transition-colors ${className}`}
  >
    {children}
  </button>
);

// ============================================
// PAYMENT INFO COMPONENTS
// ============================================

export const PaymentInfoCard: React.FC<{
  children: ReactNode;
  className?: string;
}> = ({ children, className = "" }) => (
  <div className={`bg-spark-dark/50 border border-spark-border rounded-2xl p-5 space-y-4 ${className}`}>
    {children}
  </div>
);

export const PaymentInfoRow: React.FC<{
  label: string;
  value: string | number;
  isBold?: boolean;
  icon?: ReactNode;
  iconBgColor?: string;
  valueColor?: string;
  className?: string;
}> = ({ label, value, isBold = false, icon, iconBgColor, valueColor = 'text-spark-text-primary', className = '' }) => (
  <div className={`flex items-center justify-between py-2 ${className}`}>
    <div className="flex items-center gap-3">
      {icon && (
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBgColor || ''}`}>
          {icon}
        </div>
      )}
      <span className="text-spark-text-secondary text-sm">{label}</span>
    </div>
    <span className={`font-mono text-sm ${isBold ? 'font-bold' : 'font-medium'} ${valueColor}`}>
      {value}
    </span>
  </div>
);

export const PaymentInfoDivider: React.FC = () => (
  <div className="border-t border-spark-border/50 my-1" />
);

export const PaymentDetailsSection: React.FC<{
  title: string;
  children: ReactNode;
  className?: string;
}> = ({ title, children, className = "" }) => (
  <div className={`space-y-3 mt-5 ${className}`}>
    <h3 className="font-display text-base font-semibold text-spark-text-primary">{title}</h3>
    {children}
  </div>
);

export const CollapsibleCodeField: React.FC<{
  label: string;
  value: string;
  isVisible: boolean;
  onToggle: () => void;
  href?: string;
}> = ({ label, value, isVisible, onToggle, href }) => (
  <div className="py-2">
    <div className="flex justify-between items-center">
      <span className="text-spark-text-secondary text-sm">{label}</span>
      <button
        onClick={onToggle}
        className="text-spark-primary hover:text-spark-primary-light focus:outline-none focus:text-spark-primary active:text-spark-primary flex items-center transition-colors p-1"
      >
        <svg
          className={`w-5 h-5 transition-transform ${isVisible ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
    {isVisible && (
      <div className="bg-spark-dark border border-spark-border rounded-xl p-3 mt-2 overflow-x-auto">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs break-all flex items-center gap-1 group"
          >
            <span className="text-spark-text-secondary">{value}</span>
            <svg className="w-3.5 h-3.5 flex-shrink-0 text-spark-primary opacity-70 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        ) : (
          <code className="text-spark-text-secondary font-mono text-xs break-all">
            {value}
          </code>
        )}
      </div>
    )}
  </div>
);

// ============================================
// RESULT COMPONENTS
// ============================================

export const ResultIcon: React.FC<{
  type: 'success' | 'failure';
}> = ({ type }) => {
  const isSuccess = type === 'success';

  return (
    <div className={`
      relative w-20 h-20 rounded-2xl flex items-center justify-center
      ${isSuccess ? 'bg-spark-success/20' : 'bg-spark-error/20'}
    `}>
      {/* Glow effect */}
      <div className={`
        absolute inset-0 rounded-2xl blur-xl
        ${isSuccess ? 'bg-spark-success/30' : 'bg-spark-error/30'}
      `} />

      {/* Icon */}
      <div className="relative z-10">
        {isSuccess ? (
          <svg className="w-10 h-10 text-spark-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-10 h-10 text-spark-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </div>
    </div>
  );
};

export const ResultMessage: React.FC<{
  title: string;
  description?: string;
}> = ({ title, description }) => (
  <>
    <p className="mt-5 font-display text-xl font-bold text-spark-text-primary">{title}</p>
    {description && (
      <p className="text-sm text-spark-text-muted mt-2 max-w-xs text-center">
        {description}
      </p>
    )}
  </>
);

// ============================================
// QR CODE COMPONENTS
// ============================================

export const QRCodeContainer: React.FC<{
  value: string;
  size?: number;
  className?: string;
}> = ({ value, size = 200, className = "" }) => (
  <div className={`relative ${className}`}>
    {/* Decorative corners */}
    <div className="absolute -inset-3 pointer-events-none">
      <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-spark-primary/50 rounded-tl-lg" />
      <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-spark-primary/50 rounded-tr-lg" />
      <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-spark-primary/50 rounded-bl-lg" />
      <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-spark-primary/50 rounded-br-lg" />
    </div>
    <div className="qr-container">
      <QRCode value={value} size={size} />
    </div>
  </div>
);

export const CopyableText: React.FC<{
  text: string;
  truncate?: boolean;
  showShare?: boolean;
  onCopied?: () => void;
  onShareError?: () => void;
  label?: string;
  additionalActions?: ReactNode;
  textColor?: string;
  textToCopy?: string;
  textToShare?: string;
  shareLabel?: string;
}> = ({ text, truncate = false, showShare = false, onCopied, onShareError, label = 'Address', additionalActions, textColor = 'text-spark-text-muted', textToCopy, textToShare, shareLabel }) => {
  const [copied, setCopied] = React.useState(false);
  const [canShare, setCanShare] = React.useState(false);

  React.useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && !!navigator.share);
  }, []);

  const handleCopy = () => {
    const textToUse = textToCopy || text;
    navigator.clipboard.writeText(textToUse)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        onCopied?.();
      })
      .catch(err => console.error('Failed to copy: ', err));
  };

  const handleShare = async () => {
    try {
      const textToUse = textToShare || text;
      const shareTitle = shareLabel || label;
      await navigator.share({
        title: shareTitle,
        text: textToUse,
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        onShareError?.();
      }
    }
  };

  // Truncate text for display if requested
  const displayText = truncate && text.length > 24
    ? `${text.slice(0, 12)}...${text.slice(-12)}`
    : text;

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Clickable text display */}
      <button
        onClick={handleCopy}
        className={`text-center font-mono text-xs sm:text-sm break-all hover:opacity-80 transition-opacity ${textColor}`}
        title="Tap to copy"
      >
        {displayText}
      </button>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleCopy}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition-all
            ${copied
              ? 'bg-spark-success/20 text-spark-success'
              : 'bg-spark-primary text-white hover:bg-spark-primary-light'
            }
          `}
          title={`Copy ${label}`}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M8 2a2 2 0 00-2 2v1H5a2 2 0 00-2 2v7a2 2 0 002 2h6a2 2 0 002-2v-1h1a2 2 0 002-2V6l-4-4H8zm6 6h-2a2 2 0 01-2-2V4H8v1h3a1 1 0 011 1v2h2v2z" />
          </svg>
          {copied ? 'Copied!' : 'Copy'}
        </button>

        {showShare && canShare && (
          <button
            onClick={handleShare}
            className="flex items-center gap-2 px-4 py-2 border border-spark-border text-spark-text-secondary rounded-xl font-medium text-sm hover:text-spark-text-primary hover:border-spark-border-light transition-colors"
            title={`Share ${label}`}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" />
            </svg>
            Share
          </button>
        )}

        {additionalActions}
      </div>
    </div>
  );
};

// ============================================
// ALERT COMPONENTS
// ============================================

export const Alert: React.FC<{
  type: 'info' | 'warning' | 'success' | 'error';
  children: ReactNode;
  className?: string;
}> = ({ type, children, className = "" }) => {
  const styles = {
    info: 'bg-spark-electric/10 border-spark-electric/30 text-spark-electric-light',
    warning: 'bg-spark-warning/10 border-spark-warning/30 text-spark-warning',
    success: 'bg-spark-success/10 border-spark-success/30 text-spark-success',
    error: 'bg-spark-error/10 border-spark-error/30 text-spark-error',
  };

  const icons = {
    info: (
      <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
      </svg>
    ),
    warning: (
      <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.72-1.36 3.485 0l6.518 11.6c.75 1.336-.213 3.001-1.742 3.001H3.48c-1.53 0-2.492-1.665-1.742-3.001l6.52-11.6zM11 13a1 1 0 10-2 0 1 1 0 002 0zm-1-2a1 1 0 01-1-1V7a1 1 0 112 0v3a1 1 0 01-1 1z" clipRule="evenodd" />
      </svg>
    ),
    success: (
      <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
      </svg>
    ),
  };

  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border ${styles[type]} ${className}`}>
      {icons[type]}
      <div className="text-sm">{children}</div>
    </div>
  );
};

// ============================================
// STEP-BASED FLOW COMPONENTS
// ============================================

export const StepContainer: React.FC<{
  children: ReactNode;
  className?: string;
}> = ({ children, className = "" }) => (
  <div className={`relative ${className}`} style={{ minHeight: '280px' }}>
    {children}
  </div>
);

export const StepContent: React.FC<{
  isActive: boolean;
  isLeft: boolean;
  children: ReactNode;
}> = ({ isActive, isLeft, children }) => {
  let transformClass = isActive
    ? 'translate-x-0 opacity-100'
    : isLeft
      ? '-translate-x-full opacity-0'
      : 'translate-x-full opacity-0';

  return (
    <div className={`absolute inset-0 transform transition-all duration-300 ease-out ${transformClass}`}>
      {children}
    </div>
  );
};

// ============================================
// BOTTOM SHEET COMPONENTS
// ============================================

export type BottomSheetMaxWidth = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const bottomSheetMaxWidthMap: Record<BottomSheetMaxWidth, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-full',
};

export const BottomSheetContainer: React.FC<{
  isOpen: boolean;
  children: ReactNode;
  className?: string;
  onClose?: () => void;
  /** Maximum width of the sheet (default: 'full' - uses parent container width) */
  maxWidth?: BottomSheetMaxWidth;
  /** Maximum height as viewport percentage (default: 90) */
  maxHeightVh?: number;
  /** Whether sheet takes full height (for QR scanner, etc.) */
  fullHeight?: boolean;
  /** Whether to show a backdrop overlay (useful for nested sheets) */
  showBackdrop?: boolean;
}> = ({ isOpen, children, className = "", onClose, maxWidth = 'full', maxHeightVh = 90, fullHeight = false, showBackdrop = false }) => {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const currentY = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
    currentY.current = e.touches[0].clientY;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    currentY.current = e.touches[0].clientY;
    const diff = currentY.current - startY.current;
    if (diff > 0) {
      setDragY(diff);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    if (dragY > 100 && onClose) {
      onClose();
    }
    setDragY(0);
  };

  const maxWidthClass = bottomSheetMaxWidthMap[maxWidth];
  const heightClass = fullHeight ? 'h-full' : `max-h-[${maxHeightVh}vh]`;

  return (
    <Transition show={isOpen} as="div" className="absolute inset-0 z-50 overflow-hidden flex flex-col justify-end pointer-events-none">
      {/* Optional backdrop for nested sheets */}
      {showBackdrop && (
        <Transition.Child
          as="div"
          enter="transition-opacity ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition-opacity ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
          className="absolute inset-0 bg-black/60 pointer-events-auto z-0"
          onClick={onClose}
        />
      )}
      <Transition.Child
        as="div"
        enter="transform transition ease-out duration-300"
        enterFrom="translate-y-full"
        enterTo="translate-y-0"
        leave="transform transition ease-in duration-200"
        leaveFrom="translate-y-0"
        leaveTo="translate-y-full"
        className={`mx-auto w-full ${maxWidthClass} ${heightClass} pointer-events-auto z-10 ${className}`}
        style={{ transform: dragY > 0 ? `translateY(${dragY}px)` : undefined }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </Transition.Child>
    </Transition>
  );
};

export const BottomSheetCard = forwardRef<HTMLDivElement, DialogCardProps>(
  ({ children, className = "" }, ref) => {
    return (
      <div
        ref={ref}
        className={`bg-spark-surface border-t border-spark-border rounded-t-3xl shadow-glass-lg overflow-hidden w-full safe-area-top ${className}`}
      >
        {/* Drag handle indicator */}
        <div className="bottom-sheet-handle" />
        <div className="px-6 pb-10 pt-3">
          {children}
        </div>
      </div>
    );
  }
);

BottomSheetCard.displayName = 'BottomSheetCard';

// ============================================
// TAB COMPONENTS
// ============================================

export const TabContainer: React.FC<{
  children: ReactNode;
  className?: string;
}> = ({ children, className = "" }) => (
  <div className={`w-full ${className}`}>
    {children}
  </div>
);

export const TabList: React.FC<{
  children: ReactNode;
  className?: string;
}> = ({ children, className = "" }) => (
  <div className={`flex bg-spark-dark/50 rounded-xl p-1 ${className}`}>
    {children}
  </div>
);

export const Tab: React.FC<{
  children: ReactNode;
  isActive: boolean;
  onClick: () => void;
  className?: string;
}> = ({ children, isActive, onClick, className = "" }) => (
  <button
    onClick={onClick}
    className={`
      flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-display font-semibold transition-all duration-200
      ${isActive
        ? 'bg-spark-primary text-white shadow-glow-primary'
        : 'text-spark-text-muted hover:text-spark-text-primary hover:bg-white/5'
      }
      ${className}
    `}
  >
    {children}
  </button>
);

/**
 * TabPanelGroup - Wrapper for TabPanels that ensures consistent height
 *
 * Uses CSS grid to stack all panels in the same cell. This makes the container
 * height dynamically match the tallest panel at any time, preventing layout
 * shifts when switching tabs. All panels remain in the DOM and contribute to
 * the height calculation, so if any panel's content grows, the container
 * grows to accommodate it.
 */
export const TabPanelGroup: React.FC<{
  children: ReactNode;
  className?: string;
}> = ({ children, className = "" }) => (
  <div className={`grid ${className}`}>
    {children}
  </div>
);

/**
 * TabPanel - Container for tab content
 *
 * Must be used inside TabPanelGroup for consistent height behavior.
 * All panels stack in the same grid cell, with only the active one visible.
 */
export const TabPanel: React.FC<{
  children: ReactNode;
  isActive: boolean;
  className?: string;
}> = ({ children, isActive, className = "" }) => (
  <div
    className={`col-start-1 row-start-1 pt-6 transition-opacity duration-200 ${isActive ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
      } ${className}`}
    aria-hidden={!isActive}
  >
    {children}
  </div>
);

// ============================================
// LOADING SPINNER
// ============================================

export const LoadingSpinner: React.FC<{
  text?: string;
  size?: 'small' | 'medium' | 'large';
  className?: string;
}> = ({ text, size = 'medium', className = "" }) => {
  const sizeClasses = {
    small: 'w-5 h-5',
    medium: 'w-8 h-8',
    large: 'w-12 h-12'
  };

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div className="relative">
        <div className={`${sizeClasses[size]} border-2 border-spark-border border-t-spark-primary rounded-full animate-spin`} />
      </div>
      {text && (
        <p className="mt-3 text-sm text-spark-text-secondary">{text}</p>
      )}
    </div>
  );
};

// ============================================
// CONFIRM DIALOG
// ============================================

export const ConfirmDialog: React.FC<{
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  const confirmButtonStyles = {
    danger: 'bg-spark-error hover:bg-spark-error/80 text-white',
    warning: 'bg-spark-warning hover:bg-spark-warning/80 text-spark-dark',
    default: 'bg-spark-primary hover:bg-spark-primary-light text-white',
  };

  return (
    <DialogContainer>
      <DialogCard maxWidth="sm">
        <div className="text-center">
          <h3 className="font-display text-lg font-bold text-spark-text-primary mb-3">
            {title}
          </h3>
          <p className="text-sm text-spark-text-secondary whitespace-pre-line mb-6">
            {message}
          </p>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-3 font-display font-semibold text-spark-text-secondary border border-spark-border rounded-xl hover:text-spark-text-primary hover:border-spark-border-light transition-colors"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              className={`flex-1 py-3 font-display font-semibold rounded-xl transition-colors ${confirmButtonStyles[variant]}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </DialogCard>
    </DialogContainer>
  );
};
