import { describe, it, expect } from 'vitest';
import { resolveStableLabel } from './StableBalanceContext';

describe('resolveStableLabel', () => {
  it('uses the SDK label when the SDK has one', () => {
    expect(resolveStableLabel('USDB', null)).toEqual({ activeLabel: 'USDB', recoverToSdk: false });
  });

  it('lets the SDK win over a stale native backup', () => {
    expect(resolveStableLabel('USDB', 'EUR')).toEqual({ activeLabel: 'USDB', recoverToSdk: false });
  });

  it('recovers from the native backup when the SDK comes up empty (the wipe case)', () => {
    expect(resolveStableLabel(null, 'USDB')).toEqual({ activeLabel: 'USDB', recoverToSdk: true });
  });

  it('stays inactive when neither has a label (genuine deactivation)', () => {
    expect(resolveStableLabel(null, null)).toEqual({ activeLabel: null, recoverToSdk: false });
  });
});
