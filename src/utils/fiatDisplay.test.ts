import { describe, expect, it } from 'vitest';
import { fiatName, fiatSymbol } from './fiatDisplay';

describe('fiat display', () => {
  it('writes the symbol the way the language does', () => {
    expect(fiatSymbol('USD', 'en')).toBe('$');
    expect(fiatSymbol('EUR', 'en')).toBe('€');
    expect(fiatSymbol('TRY', 'tr')).toBe('₺');
  });

  it('names a currency in the language', () => {
    expect(fiatName('EUR', 'de', 'Euro')).toBe('Euro');
    expect(fiatName('USD', 'de', 'US Dollar')).toBe('US-Dollar');
    expect(fiatName('USD', 'tr', 'US Dollar')).toBe('ABD doları');
  });

  it('keeps the SDK name for a code the runtime does not know', () => {
    expect(fiatName('ZZZ', 'de', 'Custom')).toBe('Custom');
    expect(fiatSymbol('not-a-code', 'en')).toBe('not-a-code');
  });
});
