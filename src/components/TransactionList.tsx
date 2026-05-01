import React, { useMemo } from 'react';
import { Payment } from '@breeztech/breez-sdk-spark';
import type { ExtendedPayment } from '../utils/depositHelpers';
import { formatWithCommas } from '../utils/formatNumber';
import { ArrowDownIcon, ArrowUpIcon, LightningBoltIcon, WalletIcon } from './Icons';
import { useStableBalance } from '../contexts/StableBalanceContext';
import { useFiatData } from '../contexts/FiatDataContext';
import { useContactsContext } from '../contexts/ContactsContext';
import { formatTokenAmount, buildTokenDisplayConfig, tokenAmountDisplaysAsZero } from '../utils/tokenFormatting';
import { getPaymentDescription } from '../utils/paymentDescription';

// Use centralized formatting utility
const formatWithSpaces = formatWithCommas;

// Hoisted static JSX elements (rendering-hoist-jsx optimization)
const ReceiveIcon = <ArrowDownIcon size="sm" />;

const SendIcon = <ArrowUpIcon size="sm" />;

const LightningIcon = <LightningBoltIcon size="xs" />;

const EmptyStateIcon = <WalletIcon className="w-10 h-10 text-spark-text-muted" />;

// Hoisted helper functions (rendering-hoist-jsx optimization)
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
  return payment.paymentType === 'receive' ? ReceiveIcon : SendIcon;
};



const getMethodIcon = (payment: Payment): React.ReactNode => {
  return payment.method === 'lightning' ? LightningIcon : null;
};

const SkeletonTransactionRow: React.FC<{ index: number }> = ({ index }) => (
  <li
    className="flex items-center gap-3 px-3 py-3 rounded-xl animate-skeleton-item"
    style={{ animationDelay: `${index * 100}ms` }}
  >
    <div className="w-10 h-10 rounded-xl bg-spark-surface animate-pulse shrink-0" />
    <div className="flex-1 min-w-0 space-y-2">
      <div className="h-4 w-32 rounded-sm bg-spark-surface animate-pulse" />
      <div className="h-3 w-20 rounded-sm bg-spark-surface animate-pulse" />
    </div>
    <div className="h-4 w-16 rounded-sm bg-spark-surface animate-pulse shrink-0" />
  </li>
);

interface TransactionListProps {
  transactions: Payment[];
  onPaymentSelected: (payment: Payment) => void;
  isSyncing?: boolean;
}

const TransactionList: React.FC<TransactionListProps> = ({ transactions, onPaymentSelected, isSyncing }) => {
  const stableBalance = useStableBalance();
  const { fiatCurrencies } = useFiatData();
  const { findContactByAddress } = useContactsContext();
  // Split transactions into pending deposits and regular payments
  const { confirming, pendingApproval, regularPayments } = useMemo(() => {
    const conf: Payment[] = [];
    const pending: Payment[] = [];
    const regular: Payment[] = [];

    for (const tx of transactions) {
      if (tx.method === 'deposit' && tx.status === 'pending') {
        const ext = tx as ExtendedPayment;
        if (ext.depositInfo && !ext.depositInfo.isMature) {
          conf.push(tx);
        } else {
          pending.push(tx);
        }
      } else {
        regular.push(tx);
      }
    }

    return { confirming: conf, pendingApproval: pending, regularPayments: regular };
  }, [transactions]);

  if (!transactions.length) {
    if (isSyncing) {
      return (
        <div className="px-4 py-3 flex-1 overflow-hidden" style={{ maskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)' }}>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-spark-text-muted tracking-wide uppercase">Payments</h2>
            <div className="flex-1 h-px bg-linear-to-r from-spark-border to-transparent" />
          </div>
          <ul className="space-y-2">
            {Array.from({ length: 20 }, (_, i) => (
              <SkeletonTransactionRow key={i} index={i} />
            ))}
          </ul>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6" data-testid="empty-state">
        <div className="w-20 h-20 rounded-2xl bg-spark-surface border border-spark-border flex items-center justify-center mb-6">
          {EmptyStateIcon}
        </div>
        <h3 className="text-lg font-semibold text-spark-text-primary mb-2">No payments yet</h3>
        <p className="text-spark-text-muted text-sm text-center max-w-xs">
          Your payment history will appear here once you send or receive your first payment.
        </p>
      </div>
    );
  }

  const renderTransactionItem = (tx: Payment, index: number) => {
    const isReceive = tx.paymentType === 'receive';
    const isFailed = tx.status === 'failed';
    const isPending = !isFailed && (tx.status === 'pending' || tx.conversionDetails?.status === 'pending');

    return (
      <li
        key={tx.id || `${tx.timestamp}-${tx.amount}-${index}`}
        className="transaction-item flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer animate-list-item"
        style={{ animationDelay: `${Math.min(index * 30, 240)}ms` }}
        onClick={() => onPaymentSelected(tx)}
        data-testid="transaction-item"
      >
        {/* Transaction type icon */}
        <div className={`
          w-10 h-10 rounded-xl flex items-center justify-center shrink-0
          ${isReceive ? 'bg-spark-success/15 text-spark-success' : 'bg-spark-electric/15 text-spark-electric'}
          ${isPending ? 'animate-pulse' : ''}
        `}>
          {getTransactionIcon(tx)}
        </div>

        {/* Transaction details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-[15px] font-medium text-spark-text-primary truncate">
              {getPaymentDescription(tx, findContactByAddress, stableBalance.displayConfig?.fiatCurrencyName)}
            </p>
            <span className="text-spark-text-muted shrink-0">{getMethodIcon(tx)}</span>
            {isPending && (
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-spark-warning animate-pulse" />
            )}
            {isFailed && (
              <span className="shrink-0 px-1.5 py-0.5 rounded-sm bg-spark-error/15 text-spark-error text-[10px] font-medium uppercase">
                Failed
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-spark-text-muted mt-0.5">
            <span>{formatTimeAgo(tx.timestamp)}</span>
            {(() => {
              if (isFailed || tx.fees <= 0) return null;
              let feeText: string;
              if (tx.details?.type === 'token') {
                const feeBigInt = BigInt(tx.fees);
                const config = stableBalance.displayConfig
                  ?? buildTokenDisplayConfig(tx.details.metadata, fiatCurrencies);
                if (tokenAmountDisplaysAsZero(feeBigInt, config)) return null;
                feeText = formatTokenAmount(feeBigInt, config);
              } else {
                feeText = formatWithSpaces(Number(tx.fees));
              }
              return (
                <>
                  <span>·</span>
                  <span>fee {feeText}</span>
                </>
              );
            })()}
          </div>
        </div>

        {/* Amount - right aligned */}
        <span
          className={`
            font-mono font-semibold text-[15px] shrink-0 inline-flex items-center
            ${isFailed ? 'text-spark-text-muted line-through' : ''}
            ${!isFailed && isReceive ? 'text-spark-success' : ''}
            ${!isFailed && !isReceive ? 'text-spark-electric' : ''}
          `}
          data-testid="transaction-amount"
        >
          {isReceive ? '+' : '-'}
          {(tx.details?.type === 'token' || tx.conversionDetails)
            ? (() => {
                const formatted = stableBalance.formatPaymentAmount(tx);
                // Style the leading currency symbol (e.g. $, €) to match ₿ treatment
                const match = formatted.match(/^([^\d-]+)(.*)/);
                if (match) return <><span className="text-[0.8em] opacity-70">{match[1]}</span>{match[2]}</>;
                return formatted;
              })()
            : <><span className="text-[0.8em] opacity-70">₿</span>{formatWithSpaces(Number(tx.amount))}</>
          }
        </span>
      </li>
    );
  };

  return (
    <div className="px-4 py-3">
      {/* Confirming section */}
      {confirming.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-spark-text-muted tracking-wide uppercase">
              Pending Confirmation
            </h2>
            <div className="flex-1 h-px bg-linear-to-r from-spark-border to-transparent" />
          </div>
          <ul className="space-y-2 mb-6">
            {confirming.map((tx, index) => renderTransactionItem(tx, index))}
          </ul>
        </>
      )}

      {/* Pending Approval section */}
      {pendingApproval.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-spark-text-muted tracking-wide uppercase">
              Pending Approval
            </h2>
            <div className="flex-1 h-px bg-linear-to-r from-spark-border to-transparent" />
          </div>
          <ul className="space-y-2 mb-6">
            {pendingApproval.map((tx, index) => renderTransactionItem(tx, index))}
          </ul>
        </>
      )}

      {/* Payments section */}
      {regularPayments.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-spark-text-muted tracking-wide uppercase">
              Payments
            </h2>
            <div className="flex-1 h-px bg-linear-to-r from-spark-border to-transparent" />
          </div>
          <ul className="space-y-2">
            {regularPayments.map((tx, index) => renderTransactionItem(tx, index))}
          </ul>
        </>
      )}
    </div>
  );
};

export default TransactionList;
