import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  convertDepositsToPayments,
  mergeDepositsWithTransactions,
  isUnclaimedDepositPayment,
  ExtendedPayment,
} from './depositHelpers';
import type { Payment, DepositInfo } from '@breeztech/breez-sdk-spark';

// Mock the depositState module
vi.mock('../services/depositState', () => ({
  isDepositRejected: vi.fn().mockReturnValue(false),
}));

import { isDepositRejected } from '../services/depositState';

describe('depositHelpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('convertDepositsToPayments', () => {
    it('converts empty deposits array to empty payments array', () => {
      const result = convertDepositsToPayments([]);
      expect(result).toEqual([]);
    });

    it('converts a single deposit to payment format', () => {
      const deposits: DepositInfo[] = [
        {
          txid: 'abc123',
          vout: 0,
          amountSats: 1000n,
        } as DepositInfo,
      ];

      const result = convertDepositsToPayments(deposits);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'deposit-abc123-0',
        paymentType: 'receive',
        method: 'deposit',
        amount: 1000n,
        status: 'pending',
        fees: 0n,
        isUnclaimedDeposit: true,
      });
      expect(result[0].depositInfo).toEqual(deposits[0]);
    });

    it('converts multiple deposits to payment format', () => {
      const deposits: DepositInfo[] = [
        { txid: 'tx1', vout: 0, amountSats: 1000n } as DepositInfo,
        { txid: 'tx2', vout: 1, amountSats: 2000n } as DepositInfo,
      ];

      const result = convertDepositsToPayments(deposits);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('deposit-tx1-0');
      expect(result[1].id).toBe('deposit-tx2-1');
    });

    it('filters out rejected deposits', () => {
      const deposits: DepositInfo[] = [
        { txid: 'accepted', vout: 0, amountSats: 1000n } as DepositInfo,
        { txid: 'rejected', vout: 0, amountSats: 2000n } as DepositInfo,
      ];

      // Mock isDepositRejected to return true for the second deposit
      vi.mocked(isDepositRejected).mockImplementation((txid) => txid === 'rejected');

      const result = convertDepositsToPayments(deposits);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('deposit-accepted-0');
    });

    it('includes transaction details with txId', () => {
      const deposits: DepositInfo[] = [
        { txid: 'mytxid', vout: 0, amountSats: 1000n } as DepositInfo,
      ];

      const result = convertDepositsToPayments(deposits);

      expect(result[0].details).toEqual({
        type: 'deposit',
        txId: 'mytxid',
      });
    });
  });

  describe('mergeDepositsWithTransactions', () => {
    it('returns empty array when both inputs are empty', () => {
      const result = mergeDepositsWithTransactions([], []);
      expect(result).toEqual([]);
    });

    it('returns only transactions when no deposits', () => {
      const transactions: Payment[] = [
        {
          id: 'payment-1',
          paymentType: 'send',
          amount: 500n,
          timestamp: 1000,
          status: 'completed',
          fees: 1n,
        } as Payment,
      ];

      const result = mergeDepositsWithTransactions(transactions, []);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('payment-1');
      expect(result[0].isUnclaimedDeposit).toBe(false);
    });

    it('returns only deposits when no transactions', () => {
      const deposits: DepositInfo[] = [
        { txid: 'tx1', vout: 0, amountSats: 1000n } as DepositInfo,
      ];

      const result = mergeDepositsWithTransactions([], deposits);

      expect(result).toHaveLength(1);
      expect(result[0].isUnclaimedDeposit).toBe(true);
    });

    it('places deposits before transactions (at top of list)', () => {
      const transactions: Payment[] = [
        { id: 'payment-1', paymentType: 'send', timestamp: 2000 } as Payment,
      ];
      const deposits: DepositInfo[] = [
        { txid: 'tx1', vout: 0, amountSats: 1000n } as DepositInfo,
      ];

      const result = mergeDepositsWithTransactions(transactions, deposits);

      expect(result).toHaveLength(2);
      expect(result[0].isUnclaimedDeposit).toBe(true);
      expect(result[1].isUnclaimedDeposit).toBe(false);
    });

    it('marks regular transactions with isUnclaimedDeposit: false', () => {
      const transactions: Payment[] = [
        { id: 'payment-1', paymentType: 'receive' } as Payment,
        { id: 'payment-2', paymentType: 'send' } as Payment,
      ];

      const result = mergeDepositsWithTransactions(transactions, []);

      expect(result.every((p) => p.isUnclaimedDeposit === false)).toBe(true);
    });
  });

  describe('isUnclaimedDepositPayment', () => {
    it('returns true for unclaimed deposit payments', () => {
      const payment: ExtendedPayment = {
        id: 'deposit-1',
        isUnclaimedDeposit: true,
      } as ExtendedPayment;

      expect(isUnclaimedDepositPayment(payment)).toBe(true);
    });

    it('returns false for regular payments', () => {
      const payment: Payment = {
        id: 'payment-1',
        paymentType: 'send',
      } as Payment;

      expect(isUnclaimedDepositPayment(payment)).toBe(false);
    });

    it('returns false for payments with isUnclaimedDeposit: false', () => {
      const payment: ExtendedPayment = {
        id: 'payment-1',
        isUnclaimedDeposit: false,
      } as ExtendedPayment;

      expect(isUnclaimedDepositPayment(payment)).toBe(false);
    });

    it('returns false for payments without isUnclaimedDeposit property', () => {
      const payment = { id: 'payment-1' } as Payment;
      expect(isUnclaimedDepositPayment(payment)).toBe(false);
    });
  });
});
