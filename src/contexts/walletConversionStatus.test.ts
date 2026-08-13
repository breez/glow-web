import { describe, it, expect } from 'vitest';
import type { Payment } from '@breeztech/breez-sdk-spark';
import { hasConversionInFlight } from './WalletContext';

const NOW = 1_786_544_000;

const payment = (timestamp: number, status?: 'pending' | 'completed'): Payment => ({
  id: `p-${timestamp}`,
  paymentType: 'receive',
  status: 'completed',
  amount: 1000n,
  fees: 0n,
  timestamp,
  method: 'spark',
  conversionDetails: status ? { status } : undefined,
});

describe('hasConversionInFlight', () => {
  it('gates on a conversion that just started', () => {
    expect(hasConversionInFlight([payment(NOW - 5, 'pending')], NOW)).toBe(true);
  });

  it('ignores a pending status the SDK stranded (#367)', () => {
    expect(hasConversionInFlight([payment(NOW - 3600, 'pending')], NOW)).toBe(false);
  });

  it('ignores completed conversions and payments without one', () => {
    expect(hasConversionInFlight([payment(NOW, 'completed'), payment(NOW)], NOW)).toBe(false);
  });
});
