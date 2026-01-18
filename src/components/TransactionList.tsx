import React from 'react';
import { Payment } from '@breeztech/breez-sdk-spark';

// Format number with thin space as thousand separator
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
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
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
    if (payment.method === 'deposit') return 'Deposit';
    if (payment.method === 'withdraw') return 'Withdrawal';
    return 'Payment';
  };

  return (
    <div className="px-5 py-4">
      {/* Section header */}
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-xs font-semibold text-spark-text-muted tracking-widest uppercase">
          Transactions
        </h2>
        <div className="flex-1 h-px bg-gradient-to-r from-spark-border to-transparent" />
      </div>

      {/* Transaction cards */}
      <div className="space-y-3">
        {transactions.map((tx, index) => {
          const isReceive = tx.paymentType === 'receive';
          const isPending = tx.status === 'pending';
          const isFailed = tx.status === 'failed';

          return (
            <div
              key={tx.id || `${tx.timestamp}-${tx.amount}-${index}`}
              className="bg-spark-surface/60 border border-spark-border rounded-2xl p-4 cursor-pointer transition-all hover:border-spark-border-light hover:bg-spark-surface/80 active:scale-[0.99]"
              onClick={() => onPaymentSelected(tx)}
            >
              {/* Icon */}
              <div className={`
                w-12 h-12 rounded-2xl flex items-center justify-center mb-3
                ${isReceive ? 'bg-spark-success/15 text-spark-success' : 'bg-spark-electric/15 text-spark-electric'}
                ${isPending ? 'animate-pulse' : ''}
              `}>
                {getTransactionIcon(tx)}
              </div>

              {/* Content row */}
              <div className="flex items-start justify-between">
                {/* Left: Title and time */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-base font-medium text-spark-text-primary truncate">
                      {getDescription(tx)}
                    </p>
                    {tx.method === 'lightning' && (
                      <svg className="w-4 h-4 text-spark-text-muted flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
                      </svg>
                    )}
                    {isPending && (
                      <span className="w-2 h-2 rounded-full bg-spark-warning animate-pulse flex-shrink-0" />
                    )}
                    {isFailed && (
                      <span className="px-1.5 py-0.5 rounded bg-spark-error/15 text-spark-error text-[10px] font-semibold uppercase flex-shrink-0">
                        Failed
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-spark-text-muted mt-0.5">
                    {formatTimeAgo(tx.timestamp)}
                  </p>
                </div>

                {/* Right: Amount and fee */}
                <div className="text-right flex-shrink-0 ml-4">
                  <p className={`
                    font-mono font-semibold text-lg
                    ${isFailed ? 'text-spark-text-muted line-through' : ''}
                    ${!isFailed && isReceive ? 'text-spark-success' : ''}
                    ${!isFailed && !isReceive ? 'text-spark-electric' : ''}
                  `}>
                    {isReceive ? '+' : '-'}{formatWithSpaces(Number(tx.amount))}
                  </p>
                  {tx.fees > 0 && !isFailed && (
                    <p className="text-xs text-spark-text-muted mt-0.5">
                      Fee: {formatWithSpaces(Number(tx.fees))}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TransactionList;
