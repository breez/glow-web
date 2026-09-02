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
      // A deposit record carries no timestamp, and upstream declined to add
      // one (breez/spark-sdk#518), so this is when the deposit was read, not
      // when it was made. Anything displaying it is showing fetch time.
      timestamp: Math.floor(Date.now() / 1000),
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

/**
 * Whether a deposit is waiting on the user rather than on the network.
 * A mature deposit only carries a claimError once the automatic claim gave
 * up, and that is the only state where the details sheet offers approve /
 * reject. Everything else resolves on its own.
 */
export function depositNeedsAction(payment: Payment | ExtendedPayment): boolean {
  const deposit = (payment as ExtendedPayment).depositInfo;
  return Boolean(deposit?.isMature && deposit.claimError);
}
