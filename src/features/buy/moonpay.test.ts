import { describe, it, expect, vi } from 'vitest';
import { getMoonpayUrl, moonpayAmountError, parseMoonpayAmount } from './moonpay';

describe('parseMoonpayAmount', () => {
  it('scales dollars to 6-decimal base units', () => {
    expect(parseMoonpayAmount('50')).toBe(50_000_000n);
    expect(parseMoonpayAmount('12.34')).toBe(12_340_000n);
  });

  it('rejects empty, zero and malformed input', () => {
    for (const input of ['', '.', '0', '0.00', 'abc', '1e5']) {
      expect(parseMoonpayAmount(input)).toBeNull();
    }
  });
});

describe('moonpayAmountError', () => {
  it('refuses amounts under MoonPay\'s $20 floor', () => {
    expect(moonpayAmountError(19_990_000n)).toBe('Amount must be at least $20');
    expect(moonpayAmountError(20_000_000n)).toBeNull();
  });
});

describe('getMoonpayUrl', () => {
  it('asks for USDC delivery with the amount', async () => {
    const sdk = { buyBitcoin: vi.fn().mockResolvedValue({ url: 'usdc-url' }) };

    await expect(getMoonpayUrl(sdk, 50_000_000n)).resolves.toBe('usdc-url');
    expect(sdk.buyBitcoin).toHaveBeenCalledWith({
      type: 'moonpay',
      delivery: { type: 'crossChain', amount: 50_000_000n },
    });
  });

  it('falls back to bitcoin delivery when USDC delivery fails', async () => {
    const sdk = {
      buyBitcoin: vi.fn()
        .mockRejectedValueOnce(new Error('USDC on Solana is not offered'))
        .mockResolvedValueOnce({ url: 'btc-url' }),
    };

    await expect(getMoonpayUrl(sdk, 50_000_000n)).resolves.toBe('btc-url');
    expect(sdk.buyBitcoin).toHaveBeenLastCalledWith({ type: 'moonpay', delivery: { type: 'bitcoin' } });
  });
});
