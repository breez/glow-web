import { describe, it, expect } from 'vitest';
import { normalizeDecimalInput } from './decimalInput';

describe('normalizeDecimalInput', () => {
  it('maps a comma separator to a dot', () => {
    expect(normalizeDecimalInput('5,25')).toBe('5.25');
  });

  it('drops a second separator', () => {
    expect(normalizeDecimalInput('5.2,5')).toBe('5.25');
    expect(normalizeDecimalInput('5,2.5')).toBe('5.25');
  });

  it('leaves dot input unchanged', () => {
    expect(normalizeDecimalInput('1.5')).toBe('1.5');
  });

  it('leaves the empty string unchanged', () => {
    expect(normalizeDecimalInput('')).toBe('');
  });

  it('keeps a trailing separator while typing', () => {
    expect(normalizeDecimalInput('5,')).toBe('5.');
  });

  it('strips characters that are neither digits nor separators', () => {
    expect(normalizeDecimalInput('1a2')).toBe('12');
  });
});
