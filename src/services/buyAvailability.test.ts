import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Capacitor } from '@capacitor/core';
import {
  filterProvidersByPlatform,
  hasBuyProviderSettings,
  buyCopy,
  isBuyIconOnly,
  ALL_BUY_PROVIDERS,
} from './settings';

const onPlatform = (p: string) => vi.spyOn(Capacitor, 'getPlatform').mockReturnValue(p);

describe('buy availability by platform', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('leaves web and android untouched, whether or not Cash App is installed', () => {
    for (const platform of ['web', 'android']) {
      onPlatform(platform);
      // Cash App stays on offer off iOS: someone without it can still install it.
      expect(filterProvidersByPlatform(ALL_BUY_PROVIDERS, false)).toEqual(ALL_BUY_PROVIDERS);
      expect(filterProvidersByPlatform(ALL_BUY_PROVIDERS, true)).toEqual(ALL_BUY_PROVIDERS);
      expect(hasBuyProviderSettings()).toBe(true);
      expect(buyCopy('Buy')).toBe('Buy');
      expect(isBuyIconOnly()).toBe(false);
    }
  });

  it('offers Cash App alone on iOS, and only while it is installed', () => {
    onPlatform('ios');
    expect(filterProvidersByPlatform(ALL_BUY_PROVIDERS, true)).toEqual(['cashApp']);
    expect(filterProvidersByPlatform(ALL_BUY_PROVIDERS, false)).toEqual([]);
    expect(buyCopy('Buy')).toBe('Add funds from Cash App');
    expect(isBuyIconOnly()).toBe(true);
  });

  it('has no provider settings to show on iOS', () => {
    onPlatform('ios');
    expect(hasBuyProviderSettings()).toBe(false);
  });
});
