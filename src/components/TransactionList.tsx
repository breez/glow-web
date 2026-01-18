import React from 'react';
import { Payment } from '@breeztech/breez-sdk-spark';

// Format number with space as thousand separator
const formatWithSpaces = (num: number): string => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};

interface TransactionListProps {
  transactions: Payment[];
  onPaymentSelected: (payment: Payment) => void;
}

const TransactionList: React.FC<TransactionListProps> = ({ transactions, onPaymentSelected }) => {
  if (!transactions.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6">
        {/* Empty state illustration */}
        <div className="w-20 h-20 rounded-2xl bg-spark-surface border border-spark-border flex items-center justify-center mb-6">
          <svg className="w-10 h-10 text-spark-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
        <h3 className="font-display text-lg font-semibold text-spark-text-primary mb-2">No payments yet</h3>
        <p className="text-spark-text-muted text-sm text-center max-w-xs">
          Your payment history will appear here once you send or receive your first payment.
        </p>
      </div>
    );
  }

  const formatTimeAgo = (timestamp: number): string => {
    const now = Math.floor(Date.now() / 1000);
    const diffSeconds = now - timestamp;

    if (diffSeconds < 60) {
      return 'Just now';
    } else if (diffSeconds < 3600) {
      const minutes = Math.floor(diffSeconds / 60);
      return `${minutes}m ago`;
    } else if (diffSeconds < 86400) {
      const hours = Math.floor(diffSeconds / 3600);
      return `${hours}h ago`;
    } else if (diffSeconds < 2592000) {
      const days = Math.floor(diffSeconds / 86400);
      return `${days}d ago`;
    } else if (diffSeconds < 31536000) {
      const months = Math.floor(diffSeconds / 2592000);
      return `${months}mo ago`;
    } else {
      const years = Math.floor(diffSeconds / 31536000);
      return `${years}y ago`;
    }
  };

  const getTransactionIcon = (payment: Payment): React.ReactNode => {
    if (payment.paymentType === 'receive') {
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      );
    } else {
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
        </svg>
      );
    }
  };

  const getDescription = (payment: Payment): string => {
    if (payment.method === 'lightning') {
      if (payment.details?.type === 'lightning') {
        // Show Lightning address if available
        if (payment.details.lnurlPayInfo?.lnAddress) {
          return payment.details.lnurlPayInfo.lnAddress;
        }
        return payment.details?.description || 'Lightning Payment';
      }
      return 'Lightning Payment';
    } else if (payment.method === 'spark') {
      return 'Spark Transfer';
    } else if (payment.method === 'deposit') {
      return 'Deposit';
    } else if (payment.method === 'withdraw') {
      return 'Withdrawal';
    }
    return 'Payment';
  };

  const getMethodIcon = (payment: Payment): React.ReactNode => {
    if (payment.method === 'lightning') {
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
        </svg>
      );
    } else if (payment.method === 'spark') {
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 12l10 10 10-10L12 2zm0 3.414L18.586 12 12 18.586 5.414 12 12 5.414z" />
        </svg>
      );
    }
    return null;
  };

  return (
    <div className="px-4 py-3 relative">
      {/* Background glow for list */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[300px] h-[200px] bg-gradient-radial from-spark-primary/10 via-spark-primary/5 to-transparent blur-3xl opacity-60" />
      </div>
      
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3 relative">
        <h2 className="font-display text-sm font-semibold text-spark-text-muted tracking-wide uppercase">
          Payments
        </h2>
        <div className="flex-1 h-px bg-gradient-to-r from-spark-border to-transparent" />
      </div>

      {/* Transaction list */}
      <ul className="space-y-1.5 relative">
        {transactions.map((tx, index) => {
          const isReceive = tx.paymentType === 'receive';
          const isPending = tx.status === 'pending';
          const isFailed = tx.status === 'failed';

          return (
            <li
              key={tx.id || `${tx.timestamp}-${tx.amount}-${index}`}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all hover:bg-white/[0.03] active:bg-white/[0.05] active:scale-[0.99] relative"
              onClick={() => onPaymentSelected(tx)}
            >
              {/* Transaction type icon */}
              <div className={`
                w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0
                ${isReceive ? 'bg-spark-success/15 text-spark-success' : 'bg-spark-electric/15 text-spark-electric'}
                ${isPending ? 'animate-pulse' : ''}
              `}>
                {getTransactionIcon(tx)}
              </div>

              {/* Transaction details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-display text-[15px] font-medium text-spark-text-primary truncate">
                    {getDescription(tx)}
                  </p>
                  <span className="text-spark-text-muted flex-shrink-0">{getMethodIcon(tx)}</span>
                  {isPending && (
                    <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-spark-warning animate-pulse" />
                  )}
                  {isFailed && (
                    <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-spark-error/15 text-spark-error text-[10px] font-medium uppercase">
                      Failed
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs text-spark-text-muted">
                  <span>{formatTimeAgo(tx.timestamp)}</span>
                  {tx.fees > 0 && (
                    <>
                      <span>·</span>
                      <span>fee {formatWithSpaces(Number(tx.fees))}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Amount - right aligned */}
              <span className={`
                font-mono font-semibold text-[15px] flex-shrink-0
                ${isFailed ? 'text-spark-text-muted line-through' : ''}
                ${!isFailed && isReceive ? 'text-spark-success' : ''}
                ${!isFailed && !isReceive ? 'text-spark-electric' : ''}
              `}>
                {isReceive ? '+' : '-'}{formatWithSpaces(Number(tx.amount))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default TransactionList;
