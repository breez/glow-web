import { describe, it, expect } from 'vitest';
import { crossChainFriendlyError } from './crossChainRoutes';

describe('crossChainFriendlyError', () => {
  it('turns a quote the fees took too much of into a next step', () => {
    const err = new Error('Invalid input: Cross-chain quote rate drift: expected destination amount 6192, got 4601 (drift 2569 bps > slippage budget 100 bps). Retry with a larger `target_overpay_bps` or send a bigger amount.');
    expect(crossChainFriendlyError(err, 'Failed to create request.'))
      .toBe('Amount too small for this network. Try a larger amount or another network.');
  });
});
