import { describe, it, expect } from 'vitest';
import type { CrossChainRoutePair } from '@breeztech/breez-sdk-spark';
import { crossChainFriendlyError, landsInThisWallet } from './crossChainRoutes';

describe('crossChainFriendlyError', () => {
  it('turns a quote the fees took too much of into a next step', () => {
    const err = new Error('Invalid input: Cross-chain quote rate drift: expected destination amount 6192, got 4601 (drift 2569 bps > slippage budget 100 bps). Retry with a larger `target_overpay_bps` or send a bigger amount.');
    expect(crossChainFriendlyError(err, 'Failed to create request.'))
      .toBe('Amount too small for this network. Try a larger amount or another network.');
  });

  it('says whether an unavailable network is worth retrying', () => {
    const temporary = new Error('Cross-chain route temporarily unavailable: This route is temporarily unavailable. Please try again later.');
    const refused = new Error('Cross-chain route not supported: This route is not supported');
    expect(crossChainFriendlyError(temporary, 'Failed to get quote.'))
      .toBe('This network is temporarily unavailable. Try again in a moment.');
    expect(crossChainFriendlyError(refused, 'Failed to create request.'))
      .toBe("This network isn't available. Try another network.");
  });
});

describe('landsInThisWallet', () => {
  const USDB = 'btkn1usdb';
  const route = (...assets: ({ type: 'bitcoin' } | { type: 'token'; tokenIdentifier: string })[]) =>
    ({ acceptedAssets: assets.map(asset => ({ asset })) }) as unknown as CrossChainRoutePair;

  it('keeps a route that lands bitcoin', () => {
    expect(landsInThisWallet(route({ type: 'bitcoin' }), null)).toBe(true);
    expect(landsInThisWallet(route({ type: 'bitcoin' }), USDB)).toBe(true);
  });

  it('drops a token-only route in sats mode', () => {
    expect(landsInThisWallet(route({ type: 'token', tokenIdentifier: USDB }), null)).toBe(false);
  });

  it('keeps a token-only route once the USD balance holds that token', () => {
    expect(landsInThisWallet(route({ type: 'token', tokenIdentifier: USDB }), USDB)).toBe(true);
    expect(landsInThisWallet(route({ type: 'token', tokenIdentifier: 'btkn1other' }), USDB)).toBe(false);
  });
});
