import React, { ReactNode } from 'react';
import { WarningIcon, CheckCircleIcon, ErrorIcon } from './Icons';

/**
 * AlertCard - Reusable alert/notification card with icon, title, and content.
 * Use for displaying errors, warnings, success messages, or informational content.
 *
 * @example
 * <AlertCard
 *   variant="warning"
 *   title="Claim Failed"
 *   icon={<WarningIcon size="md" />}
 * >
 *   <p>The claim could not be processed.</p>
 *   <p className="mt-2">You can reject to process a refund instead.</p>
 * </AlertCard>
 */

export type AlertVariant = 'info' | 'warning' | 'success' | 'error';

const variantStyles: Record<AlertVariant, {
  container: string;
  iconBg: string;
  title: string;
}> = {
  info: {
    container: 'bg-spark-electric/10 border-spark-electric/30',
    iconBg: 'bg-spark-electric/20',
    title: 'text-spark-electric',
  },
  warning: {
    container: 'bg-spark-warning/10 border-spark-warning/30',
    iconBg: 'bg-spark-warning/20',
    title: 'text-spark-warning',
  },
  success: {
    container: 'bg-spark-success/10 border-spark-success/30',
    iconBg: 'bg-spark-success/20',
    title: 'text-spark-success',
  },
  error: {
    container: 'bg-spark-error/10 border-spark-error/30',
    iconBg: 'bg-spark-error/20',
    title: 'text-spark-error',
  },
};

const defaultIcons: Record<AlertVariant, ReactNode> = {
  info: null, // No default info icon yet
  warning: <WarningIcon size="md" className="text-spark-warning" />,
  success: <CheckCircleIcon size="md" className="text-spark-success" />,
  error: <ErrorIcon size="md" className="text-spark-error" />,
};

export interface AlertCardProps {
  /** Visual style variant */
  variant: AlertVariant;
  /** Title displayed next to the icon */
  title: string;
  /** Content displayed below the title */
  children: ReactNode;
  /** Custom icon (optional, defaults based on variant) */
  icon?: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

export const AlertCard: React.FC<AlertCardProps> = ({
  variant,
  title,
  children,
  icon,
  className = '',
}) => {
  const styles = variantStyles[variant];
  const displayIcon = icon ?? defaultIcons[variant];

  return (
    <div className={`border rounded-2xl p-4 ${styles.container} ${className}`}>
      <div className="flex items-center gap-3 mb-2">
        {displayIcon && (
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${styles.iconBg}`}>
            {displayIcon}
          </div>
        )}
        <h3 className={`font-display font-bold ${styles.title}`}>{title}</h3>
      </div>
      <div className="pl-[52px]">
        {children}
      </div>
    </div>
  );
};

/**
 * SimpleAlert - Inline alert for simpler use cases without title.
 */
export interface SimpleAlertProps {
  variant: AlertVariant;
  children: ReactNode;
  className?: string;
}

export const SimpleAlert: React.FC<SimpleAlertProps> = ({
  variant,
  children,
  className = '',
}) => {
  const iconColors: Record<AlertVariant, string> = {
    info: 'text-spark-electric',
    warning: 'text-spark-warning',
    success: 'text-spark-success',
    error: 'text-spark-error',
  };

  const bgStyles: Record<AlertVariant, string> = {
    info: 'bg-spark-electric/10 border-spark-electric/30 text-spark-electric-light',
    warning: 'bg-spark-warning/10 border-spark-warning/30 text-spark-warning',
    success: 'bg-spark-success/10 border-spark-success/30 text-spark-success',
    error: 'bg-spark-error/10 border-spark-error/30 text-spark-error',
  };

  const icons: Record<AlertVariant, ReactNode> = {
    info: (
      <svg className={`w-5 h-5 flex-shrink-0 ${iconColors[variant]}`} fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
      </svg>
    ),
    warning: <WarningIcon size="md" className={iconColors[variant]} />,
    success: <CheckCircleIcon size="md" className={iconColors[variant]} />,
    error: <ErrorIcon size="md" className={iconColors[variant]} />,
  };

  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border ${bgStyles[variant]} ${className}`}>
      {icons[variant]}
      <div className="text-sm">{children}</div>
    </div>
  );
};

export default AlertCard;
