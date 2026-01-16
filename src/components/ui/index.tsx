import React, { ReactNode, forwardRef } from 'react';
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
}> = ({ title, onClose }) => (
  <div className="flex justify-center items-center mb-6 relative">
    <h2 className="font-display text-xl font-bold text-spark-text-primary">{title}</h2>
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
    className={`w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 text-spark-text-primary placeholder-spark-text-muted focus:border-spark-amber focus:ring-2 focus:ring-spark-amber/20 transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
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
    className={`w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 text-spark-text-primary placeholder-spark-text-muted focus:border-spark-amber focus:ring-2 focus:ring-spark-amber/20 transition-all resize-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
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
    className={`px-4 py-3 font-display font-semibold text-spark-text-secondary hover:text-spark-text-primary transition-colors rounded-xl hover:bg-white/5 ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
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
}> = ({ label, value, isBold = false }) => (
  <div className="flex justify-between items-center">
    <span className="text-spark-text-secondary text-sm">{label}</span>
    <span className={`text-spark-text-primary ${isBold ? 'font-display font-bold text-lg' : 'font-mono'}`}>
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
}> = ({ label, value, isVisible, onToggle }) => (
  <div className="flex flex-col">
    <div className="flex justify-between items-center">
      <span className="text-spark-text-secondary text-sm">{label}</span>
      <button
        onClick={onToggle}
        className="text-spark-amber text-sm hover:text-spark-amber-light flex items-center gap-1 transition-colors"
      >
        {isVisible ? 'Hide' : 'Show'}
        <svg 
          className={`w-4 h-4 transition-transform ${isVisible ? 'rotate-180' : ''}`} 
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
        <code className="text-spark-text-secondary font-mono text-xs break-all">
          {value}
        </code>
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
}> = ({ value, size = 220, className = "" }) => (
  <div className={`qr-container inline-block ${className}`}>
    <QRCode value={value} size={size} />
  </div>
);

export const CopyableText: React.FC<{
  text: string;
}> = ({ text }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(err => console.error('Failed to copy: ', err));
  };

  return (
    <div className="relative w-full">
      <input
        type="text"
        value={text}
        readOnly
        className="w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 pr-24 text-spark-text-secondary font-mono text-sm text-center"
      />
      <button
        onClick={handleCopy}
        className={`
          absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all
          ${copied 
            ? 'bg-spark-success/20 text-spark-success' 
            : 'bg-spark-amber text-black hover:bg-spark-amber-light'
          }
        `}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
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

export const BottomSheetContainer: React.FC<{
  isOpen: boolean;
  children: ReactNode;
  className?: string;
  onClose?: () => void;
}> = ({ isOpen, children, className = "" }) => {
  return (
    <Transition show={isOpen} as="div" className="absolute inset-0 z-50 overflow-hidden">
      <Transition.Child
        as="div"
        enter="transform transition ease-out duration-300"
        enterFrom="translate-y-full"
        enterTo="translate-y-0"
        leave="transform transition ease-in duration-200"
        leaveFrom="translate-y-0"
        leaveTo="translate-y-full"
        className={`mx-auto h-full max-w-full ${className}`}
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
        className={`bg-spark-surface border-t border-spark-border rounded-t-3xl shadow-glass-lg overflow-hidden w-full ${className}`}
      >
        {/* Handle */}
        <div className="bottom-sheet-handle" />
        <div className="p-6 pt-2">
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
      flex-1 px-4 py-2.5 rounded-lg text-sm font-display font-semibold transition-all duration-200
      ${isActive
        ? 'bg-spark-amber text-black shadow-glow-amber'
        : 'text-spark-text-secondary hover:text-spark-text-primary'
      }
      ${className}
    `}
  >
    {children}
  </button>
);

export const TabPanel: React.FC<{
  children: ReactNode;
  isActive: boolean;
  className?: string;
}> = ({ children, isActive, className = "" }) => (
  <div className={`${isActive ? 'block' : 'hidden'} pt-6 ${className}`}>
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
        <div className={`${sizeClasses[size]} border-2 border-spark-border border-t-spark-amber rounded-full animate-spin`} />
      </div>
      {text && (
        <p className="mt-3 text-sm text-spark-text-secondary">{text}</p>
      )}
    </div>
  );
};
