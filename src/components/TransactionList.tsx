import React from 'react';
import { Payment } from '@breeztech/breez-sdk-spark';

// Format number with comma as thousand separator
const formatWithSpaces = (num: number): string => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

interface TransactionListProps {
  transactions: Payment[];
  onPaymentSelected: (payment: Payment) => void;
}

const TransactionList: React.FC<TransactionListProps> = ({ transactions, onPaymentSelected }) => {
  if (!transactions.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6">
        <div className="w-20 h-20 rounded-2xl bg-spark-surface border border-spark-border flex items-center justify-center mb-6">
          <svg className="w-10 h-10 text-spark-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-spark-text-primary mb-2">No payments yet</h3>
        <p className="text-spark-text-muted text-sm text-center max-w-xs">
          Your payment history will appear here once you send or receive your first payment.
        </p>
      </div>
    );
  }

  const formatTimeAgo = (timestamp: number): string => {
    const now = Math.floor(Date.now() / 1000);
    const diffSeconds = now - timestamp;

    if (diffSeconds < 60) return 'Just now';
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
    if (diffSeconds < 2592000) return `${Math.floor(diffSeconds / 86400)}d ago`;
    if (diffSeconds < 31536000) return `${Math.floor(diffSeconds / 2592000)}mo ago`;
    return `${Math.floor(diffSeconds / 31536000)}y ago`;
  };

  const getTransactionIcon = (payment: Payment): React.ReactNode => {
    if (payment.paymentType === 'receive') {
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      );
    }
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
    );
  };

  const getDescription = (payment: Payment): string => {
    if (payment.method === 'lightning') {
      if (payment.details?.type === 'lightning') {
        if (payment.details.lnurlPayInfo?.lnAddress) {
          return payment.details.lnurlPayInfo.lnAddress;
        }
        return payment.details?.description || 'Lightning Payment';
      }
      return 'Lightning Payment';
    }
    if (payment.method === 'spark') return 'Spark Transfer';
    if (payment.method === 'deposit') return 'BTC Transfer';
    if (payment.method === 'withdraw') return 'BTC Transfer';
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
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      );
    } else if (payment.method === 'deposit' || payment.method === 'withdraw') {
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M14.24 10.56c-.31 1.24-2.24.61-2.84.44l.55-2.18c.62.18 2.61.44 2.29 1.74zm-3.11 1.56l-.6 2.41c.74.19 3.03.92 3.37-.44.36-1.42-2.03-1.79-2.77-1.97zm10.57 2.3c-1.34 5.36-6.76 8.62-12.12 7.28S1.04 14.84 2.38 9.48C3.72 4.12 9.14.86 14.5 2.2s8.62 6.76 7.28 12.12l-.08.1zM14.11 9.19c.38-1.57-1.08-2.24-2.85-2.61l.46-1.86-1.14-.28-.45 1.82c-.3-.07-.61-.14-.92-.21l.45-1.84-1.14-.28-.46 1.86c-.25-.06-.49-.12-.73-.18l-1.57-.39-.3 1.22s.84.19.82.2c.46.12.55.42.53.66l-.53 2.15.12.03-.12-.03-.75 2.98c-.06.14-.2.35-.52.27.01.02-.83-.21-.83-.21l-.57 1.31 1.49.37c.28.07.55.14.81.21l-.47 1.89 1.14.28.46-1.86c.31.09.62.17.92.24l-.46 1.85 1.14.28.47-1.88c1.95.37 3.42.22 4.03-1.54.5-1.42-.02-2.24-1.05-2.77.75-.18 1.31-.68 1.46-1.72z"/>
        </svg>
      );
    }
    return null;
  };

  return (
    <div className="px-4 py-3">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-spark-text-muted tracking-wide uppercase">
          Payments
        </h2>
        <div className="flex-1 h-px bg-gradient-to-r from-spark-border to-transparent" />
      </div>

      {/* Transaction list - compact rows */}
      <ul className="space-y-1">
        {transactions.map((tx, index) => {
          const isReceive = tx.paymentType === 'receive';
          const isPending = tx.status === 'pending';
          const isFailed = tx.status === 'failed';

          return (
            <li
              key={tx.id || `${tx.timestamp}-${tx.amount}-${index}`}
              className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all hover:bg-white/[0.03] active:bg-white/[0.05]"
              onClick={() => onPaymentSelected(tx)}
            >
              {/* Transaction type icon */}
              <div className={`
                w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
                ${isReceive ? 'bg-spark-success/15 text-spark-success' : 'bg-spark-electric/15 text-spark-electric'}
                ${isPending ? 'animate-pulse' : ''}
              `}>
                {getTransactionIcon(tx)}
              </div>

              {/* Transaction details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-[15px] font-medium text-spark-text-primary truncate">
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
                <div className="flex items-center gap-1 text-xs text-spark-text-muted mt-0.5">
                  <span>{formatTimeAgo(tx.timestamp)}</span>
                  {tx.fees > 0 && !isFailed && (
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
