import { Payment, DepositInfo } from '@breeztech/breez-sdk-spark';
import { isDepositRejected } from '../services/depositState';

// Extended payment type that includes a marker for unclaimed deposits
export interface ExtendedPayment extends Payment {
  isUnclaimedDeposit?: boolean;
  depositInfo?: DepositInfo;
}

/**
 * Convert unclaimed deposits to payment-like objects for display in the transaction list
 * Only includes deposits that have NOT been rejected
 */
export function convertDepositsToPayments(deposits: DepositInfo[]): ExtendedPayment[] {
  return deposits
    .filter(d => !isDepositRejected(d.txid, d.vout)) // Only show non-rejected deposits
    .map(deposit => ({
      id: `deposit-${deposit.txid}-${deposit.vout}`,
      paymentType: 'receive' as const,
      method: 'deposit' as const,
      amount: BigInt(deposit.amountSats),
      timestamp: Math.floor(Date.now() / 1000), // Use current time since we don't have deposit timestamp
      status: 'pending' as const, // Show as pending
      fees: BigInt(0),
      isUnclaimedDeposit: true,
      depositInfo: deposit,
      details: {
        type: 'deposit' as const,
        txId: deposit.txid,
      }
    } as ExtendedPayment));
}

/**
 * Merge unclaimed deposits with regular transactions
 * Deposits appear at the top (most recent)
 */
export function mergeDepositsWithTransactions(
  transactions: Payment[],
  deposits: DepositInfo[]
): ExtendedPayment[] {
  const depositPayments = convertDepositsToPayments(deposits);

  // Convert regular payments to ExtendedPayment
  const extendedTransactions: ExtendedPayment[] = transactions.map(t => ({
    ...t,
    isUnclaimedDeposit: false,
  }));

  // Deposits appear first (at the top of the list)
  return [...depositPayments, ...extendedTransactions];
}

/**
 * Check if a payment is an unclaimed deposit
 */
export function isUnclaimedDepositPayment(payment: Payment | ExtendedPayment): payment is ExtendedPayment {
  return (payment as ExtendedPayment).isUnclaimedDeposit === true;
}
