import React, { ReactNode, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { logger, LogCategory } from '@/services/logger';
import {
  CloseIcon,
  ChevronDownIcon,
  CopyFilledIcon,
  ShareIcon,
  InfoIcon,
  WarningIcon,
  CheckCircleIcon,
  ErrorIcon,
  AlertTriangleIcon,
  CheckIcon,
  ExternalLinkIcon,
  BackIcon,
} from '../Icons';
import { useBackButton } from '../../hooks/useBackButton';

// ============================================
// RE-EXPORTS FROM MODULAR FILES
// These enable tree-shaking and cleaner imports
// ============================================

// QR Code (lazy-loadable, contains react-qr-code dependency)
export { QRCodeContainer } from './QRCodeContainer';

// Buttons
export { PrimaryButton, SecondaryButton, TextButton, FloatingIconButton } from './buttons';
export type { ButtonProps } from './buttons';

// Forms
export {
  FormGroup,
  FormLabel,
  FormDescription,
  FormInput,
  FormTextarea,
  FormError,
  FormHint,
} from './forms';
export type { FormInputProps, FormTextareaProps } from './forms';

// Bottom Sheets
export { BottomSheetContainer, BottomSheetCard } from './sheets/BottomSheet';
export type { BottomSheetMaxWidth, BottomSheetContainerProps, BottomSheetCardProps } from './sheets/BottomSheet';

// Loading
export { default as LoadingSpinner } from '../LoadingSpinner';

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
  onBack?: () => void;
  icon?: ReactNode;
}> = ({ title, onClose, onBack, icon }) => (
  <div className="flex justify-center items-center mb-5 relative px-8">
    {onBack && (
      <button
        onClick={onBack}
        aria-label="Back"
        className="absolute left-0 top-1/2 -translate-y-1/2 py-2 pl-6 pr-2 -ml-6 text-spark-text-muted hover:text-spark-text-primary transition-colors rounded-lg hover:bg-white/5"
      >
        <BackIcon />
      </button>
    )}
    <div className="flex items-center gap-2 min-w-0 max-w-full">
      {icon && <span className="text-spark-primary shrink-0">{icon}</span>}
      <h2 className="font-display text-lg font-bold text-spark-text-primary truncate">{title}</h2>
      {icon && <span className="w-5 h-5 shrink-0" aria-hidden="true" />}
    </div>
    <button
      onClick={onClose}
      aria-label="Close"
      className="absolute right-0 top-1/2 -translate-y-1/2 py-2 pl-2 pr-6 -mr-6 text-spark-text-muted hover:text-spark-error transition-colors rounded-lg hover:bg-white/5"
    >
      <CloseIcon />
    </button>
  </div>
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


export const CollapsibleSection: React.FC<{
  label: string;
  isVisible: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Drop the bordered container so children render as a flush list. */
  bare?: boolean;
}> = ({ label, isVisible, onToggle, children, bare = false }) => (
  <div className="py-2">
    <button
      onClick={onToggle}
      className="flex justify-between items-center w-full text-left"
    >
      <span className="text-spark-text-secondary text-sm">{label}</span>
      <span className="text-spark-primary hover:text-spark-primary-light flex items-center transition-colors p-1">
        <ChevronDownIcon size="md" className={`transition-transform ${isVisible ? 'rotate-180' : ''}`} />
      </span>
    </button>
    {isVisible && (
      bare ? (
        <div className="mt-2">{children}</div>
      ) : (
        <div className="mt-2 bg-spark-dark border border-spark-border rounded-xl p-3">
          {children}
        </div>
      )
    )}
  </div>
);

export const CollapsibleCodeField: React.FC<{
  label: string;
  value: string;
  isVisible: boolean;
  onToggle: () => void;
  href?: string;
  /** Show a tap-to-copy button next to the value. */
  copyable?: boolean;
}> = ({ label, value, isVisible, onToggle, href, copyable }) => {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <CollapsibleSection label={label} isVisible={isVisible} onToggle={onToggle}>
      <div className="flex items-start gap-2">
        <div className="overflow-x-auto flex-1 min-w-0">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs break-all flex items-center gap-1 group"
            >
              <span className="text-spark-text-secondary">{value}</span>
              <ExternalLinkIcon className="w-3.5 h-3.5 shrink-0 text-spark-primary opacity-70 group-hover:opacity-100 transition-opacity" />
            </a>
          ) : (
            <code className="text-spark-text-secondary font-mono text-xs break-all">
              {value}
            </code>
          )}
        </div>
        {copyable && !href && (
          <button
            onClick={handleCopy}
            className="shrink-0 p-1 rounded-md hover:bg-white/5 transition-colors"
            aria-label="Copy"
          >
            {copied
              ? <CheckIcon size="sm" className="text-spark-success" />
              : <CopyFilledIcon size="sm" className="text-spark-text-secondary" />}
          </button>
        )}
      </div>
    </CollapsibleSection>
  );
};

// ============================================
// TEXT COMPONENTS
// ============================================

export const CopyableText: React.FC<{
  text: string;
  truncate?: boolean;
  hideText?: boolean;
  showShare?: boolean;
  onCopied?: () => void;
  onShareError?: () => void;
  label?: string;
  additionalActions?: ReactNode;
  textColor?: string;
  textToCopy?: string;
  textToShare?: string;
  shareLabel?: string;
  'data-testid'?: string;
}> = ({ text, truncate = false, hideText = false, showShare = false, onCopied, onShareError, label = 'Address', additionalActions, textColor = 'text-spark-text-muted', textToCopy, textToShare, shareLabel, 'data-testid': testId }) => {
  const [copied, setCopied] = React.useState(false);
  // Share is available via @capacitor/share on native (Android System
  // WebView does not implement navigator.share, which is why the
  // button only appeared on iOS before) and via the Web Share API on
  // the web. Fixed for the page lifetime; read once at init.
  const [canShare] = React.useState(
    () =>
      Capacitor.isNativePlatform() ||
      (typeof navigator !== 'undefined' && !!navigator.share),
  );

  const handleCopy = () => {
    const textToUse = textToCopy || text;
    navigator.clipboard.writeText(textToUse)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        onCopied?.();
      })
      .catch(err => {
        logger.error(LogCategory.UI, 'Failed to copy text to clipboard', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  };

  const handleShare = async () => {
    const textToUse = textToShare || text;
    const shareTitle = shareLabel || label;
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({ title: shareTitle, text: textToUse });
      } else {
        await navigator.share({ title: shareTitle, text: textToUse });
      }
    } catch (err) {
      // Web AbortError = user dismissed the sheet; the native plugin
      // rejects a dismissed share with a "canceled"/"Share canceled"
      // message. Neither is an error worth surfacing.
      const name = (err as Error).name;
      const message = (err as Error).message ?? '';
      if (name !== 'AbortError' && !/cancel/i.test(message)) {
        onShareError?.();
      }
    }
  };

  // Truncate text for display if requested
  const displayText = truncate && text.length > 24
    ? `${text.slice(0, 12)}...${text.slice(-12)}`
    : text;

  return (
    <div className="flex flex-col items-center gap-4 w-full" data-testid={testId}>
      {/* Clickable text display */}
      {!hideText && (
        <button
          onClick={handleCopy}
          className={`text-center font-mono text-xs sm:text-sm break-all hover:opacity-80 transition-opacity ${textColor}`}
          title="Tap to copy"
          data-testid="copyable-text-content"
        >
          {displayText}
        </button>
      )}

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
          data-testid="copy-button"
        >
          <CopyFilledIcon />
          {copied ? 'Copied!' : 'Copy'}
        </button>

        {showShare && canShare && (
          <button
            onClick={handleShare}
            className="flex items-center gap-2 px-4 py-2 border border-spark-border text-spark-text-secondary rounded-xl font-medium text-sm hover:text-spark-text-primary hover:border-spark-border-light transition-colors"
            title={`Share ${label}`}
          >
            <ShareIcon />
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
    info: <InfoIcon className="shrink-0" />,
    warning: <WarningIcon className="shrink-0" />,
    success: <CheckCircleIcon className="shrink-0" />,
    error: <ErrorIcon className="shrink-0" size="md" />,
  };

  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border ${styles[type]} ${className}`}>
      {icons[type]}
      <div className="text-sm">{children}</div>
    </div>
  );
};

/**
 * ErrorMessageBox - Displays error messages with optional stack trace support
 *
 * Parses error messages to separate the main message from stack traces,
 * showing the stack trace in a scrollable code block.
 */
export const ErrorMessageBox: React.FC<{
  title?: string;
  error: string;
  className?: string;
}> = ({ title = 'Error', error, className = "" }) => {
  // Try to separate main message from stack trace
  // Stack traces often contain patterns like "at function" or "wasm-function"
  const stackTracePatterns = [
    /\s+at\s+[\w.$]+\s*\(/,  // " at functionName("
    /wasm-function\[\d+\]/,   // "wasm-function[123]"
    /:\d+:\d+\)?$/m,          // ":123:45)" at end of line
  ];

  let mainMessage = error;
  let stackTrace: string | null = null;

  // Check if error contains stack trace patterns
  for (const pattern of stackTracePatterns) {
    const match = error.match(pattern);
    if (match && match.index !== undefined) {
      // Find the start of the stack trace (look for "at " or similar)
      const atIndex = error.lastIndexOf(' at ', match.index);
      const splitIndex = atIndex > 0 ? atIndex : match.index;

      // Only split if stack trace is substantial
      if (error.length - splitIndex > 50) {
        mainMessage = error.substring(0, splitIndex).trim();
        stackTrace = error.substring(splitIndex).trim();
        break;
      }
    }
  }

  // Clean up the main message (remove trailing colons, etc.)
  mainMessage = mainMessage.replace(/:\s*$/, '').trim();
  if (!mainMessage) {
    mainMessage = 'An error occurred';
  }

  return (
    <div className={`bg-spark-error/10 border border-spark-error/30 rounded-2xl p-4 ${className}`}>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-spark-error/20 flex items-center justify-center shrink-0">
          <AlertTriangleIcon className="text-spark-error" />
        </div>
        <h3 className="font-display font-bold text-spark-error">{title}</h3>
      </div>
      <div className="pl-[52px]">
        <p className="text-spark-text-secondary text-sm">{mainMessage}</p>
        {stackTrace && (
          <div className="mt-3 bg-spark-dark/50 border border-spark-border rounded-xl p-3 max-h-32 overflow-auto">
            <code className="text-xs text-spark-text-muted font-mono whitespace-pre-wrap break-all">
              {stackTrace}
            </code>
          </div>
        )}
      </div>
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
  <div className={`flex bg-spark-dark/50 rounded-xl ${className}`}>
    {children}
  </div>
);

export const Tab: React.FC<{
  children: ReactNode;
  isActive: boolean;
  onClick: () => void;
  className?: string;
  'data-testid'?: string;
}> = ({ children, isActive, onClick, className = "", 'data-testid': testId }) => (
  <button
    onClick={onClick}
    data-testid={testId}
    className={`
      flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-display font-semibold transition-all duration-200
      ${isActive
        ? 'bg-spark-primary text-black'
        : 'text-spark-text-muted hover:text-spark-text-primary hover:bg-white/5'
      }
      ${className}
    `}
  >
    {children}
  </button>
);


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
    // Android hardware back button dismisses the confirm dialog (maps
    // to "Cancel" — the safer of the two options). This is placed
    // BEFORE the early-return so the hook order stays stable across
    // renders regardless of isOpen flips.
    useBackButton(() => {
      onCancel();
    }, isOpen);

    if (!isOpen) return null;

    const confirmButtonStyles = {
      danger: 'bg-spark-error hover:bg-spark-error/80 text-white',
      warning: 'bg-spark-warning hover:bg-spark-warning/80 text-spark-dark',
      default: 'bg-spark-primary hover:bg-spark-primary-light text-white',
    };

    const content = (
      // Portaled to document.body (below) so this fixed overlay is
      // positioned against the viewport. Rendered inside a bottom sheet
      // it would otherwise sit under Sheet.Container's translateY
      // transform, which makes position:fixed resolve relative to that
      // transformed ancestor and shoves the dialog off-screen whenever
      // the sheet is snapped or keyboard-lifted.
      <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-[70] p-4 transition-opacity duration-300">
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
                data-testid="confirm-dialog-cancel"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className={`flex-1 py-3 font-display font-semibold rounded-xl transition-colors ${confirmButtonStyles[variant]}`}
                data-testid="confirm-dialog-confirm"
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </DialogCard>
      </div>
    );

    return createPortal(content, document.body);
  };

// ============================================
// CHECKBOX COMPONENT
// ============================================

export const Checkbox: React.FC<{
  checked: boolean;
  onChange: () => void;
  className?: string;
}> = ({ checked, onChange, className = "" }) => (
  <button
    type="button"
    onClick={onChange}
    className={`w-6 h-6 rounded border-2 flex items-center justify-center shrink-0 transition-all ${checked
      ? 'bg-spark-primary border-spark-primary'
      : 'bg-transparent border-spark-text-muted hover:border-spark-text-secondary'
      } ${className}`}
    role="checkbox"
    aria-checked={checked}
  >
    {checked && (
      <CheckIcon size="sm" className="text-spark-text-primary" />
    )}
  </button>
);

// ============================================
// SWITCH COMPONENT (Material 3 Style)
// ============================================

export const Switch: React.FC<{
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  className?: string;
}> = ({ checked, onChange, disabled = false, className = "" }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={onChange}
    className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-hidden focus-visible:ring-2 focus-visible:ring-spark-primary focus-visible:ring-offset-2 focus-visible:ring-offset-spark-dark ${checked ? 'bg-spark-primary' : 'bg-spark-border'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
  >
    <span
      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-6' : 'translate-x-1'
        } mt-1`}
    />
  </button>
);
