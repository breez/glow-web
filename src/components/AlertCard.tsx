import React, { ReactNode } from 'react';
import { WarningIcon, CheckCircleIcon, ErrorIcon, InfoIcon } from './Icons';

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
  body: string;
}> = {
  info: {
    container: 'bg-spark-electric/10 border-spark-electric/30',
    iconBg: 'bg-spark-electric/20',
    title: 'text-spark-electric',
    body: '',
  },
  warning: {
    container: 'bg-spark-warn-surface border-spark-warn-border',
    iconBg: 'bg-spark-primary/20',
    title: 'text-spark-warn-title',
    body: 'text-spark-warn-text',
  },
  success: {
    container: 'bg-spark-success/10 border-spark-success/30',
    iconBg: 'bg-spark-success/20',
    title: 'text-spark-success',
    body: '',
  },
  error: {
    container: 'bg-spark-warn-surface border-spark-warn-border',
    iconBg: 'bg-spark-primary/20',
    title: 'text-spark-warn-title',
    body: 'text-spark-warn-text',
  },
};

const defaultIcons: Record<AlertVariant, ReactNode> = {
  info: <InfoIcon size="md" className="text-spark-electric" />,
  warning: <WarningIcon size="md" className="text-spark-primary" />,
  success: <CheckCircleIcon size="md" className="text-spark-success" />,
  error: <ErrorIcon size="md" className="text-spark-primary" />,
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
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${styles.iconBg}`}>
            {displayIcon}
          </div>
        )}
        <h3 className={`font-display font-bold ${styles.title}`}>{title}</h3>
      </div>
      <div className={`pl-[52px] ${styles.body}`}>
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
  dataTestId?: string;
}

export const SimpleAlert: React.FC<SimpleAlertProps> = ({
  variant,
  children,
  className = '',
  dataTestId,
}) => {
  const iconColors: Record<AlertVariant, string> = {
    info: 'text-spark-electric',
    warning: 'text-spark-primary',
    success: 'text-spark-success',
    error: 'text-spark-primary',
  };

  const bgStyles: Record<AlertVariant, string> = {
    info: 'bg-spark-electric/10 border-spark-electric/30 text-spark-electric-light',
    warning: 'bg-spark-warn-surface border-spark-warn-border text-spark-warn-text',
    success: 'bg-spark-success/10 border-spark-success/30 text-spark-success',
    error: 'bg-spark-warn-surface border-spark-warn-border text-spark-warn-text',
  };

  const icons: Record<AlertVariant, ReactNode> = {
    info: <InfoIcon className={`shrink-0 ${iconColors[variant]}`} />,
    warning: <WarningIcon size="md" className={iconColors[variant]} />,
    success: <CheckCircleIcon size="md" className={iconColors[variant]} />,
    error: <ErrorIcon size="md" className={iconColors[variant]} />,
  };

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-xl border ${bgStyles[variant]} ${className}`}
      data-testid={dataTestId}
    >
      {icons[variant]}
      <div className="text-sm">{children}</div>
    </div>
  );
};

export default AlertCard;
