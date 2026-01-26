import { describe, it, expect } from 'vitest';
import {
  formatWithSpaces,
  formatWithThinSpaces,
  formatWithCommas,
  formatLocaleWithSpaces,
  formatLocaleWithThinSpaces,
} from './formatNumber';

describe('formatNumber utilities', () => {
  describe('formatWithSpaces', () => {
    it('formats small numbers without spaces', () => {
      expect(formatWithSpaces(0)).toBe('0');
      expect(formatWithSpaces(1)).toBe('1');
      expect(formatWithSpaces(123)).toBe('123');
    });

    it('formats thousands with single space', () => {
      expect(formatWithSpaces(1000)).toBe('1 000');
      expect(formatWithSpaces(1234)).toBe('1 234');
    });

    it('formats millions with multiple spaces', () => {
      expect(formatWithSpaces(1000000)).toBe('1 000 000');
      expect(formatWithSpaces(1234567)).toBe('1 234 567');
    });

    it('formats large numbers correctly', () => {
      expect(formatWithSpaces(1000000000)).toBe('1 000 000 000');
      expect(formatWithSpaces(123456789012)).toBe('123 456 789 012');
    });

    it('handles bigint values', () => {
      expect(formatWithSpaces(1000n)).toBe('1 000');
      expect(formatWithSpaces(1234567890n)).toBe('1 234 567 890');
    });
  });

  describe('formatWithThinSpaces', () => {
    it('formats small numbers without spaces', () => {
      expect(formatWithThinSpaces(0)).toBe('0');
      expect(formatWithThinSpaces(999)).toBe('999');
    });

    it('formats thousands with thin space (U+2009)', () => {
      expect(formatWithThinSpaces(1000)).toBe('1\u2009000');
      expect(formatWithThinSpaces(1234)).toBe('1\u2009234');
    });

    it('formats millions with thin spaces', () => {
      expect(formatWithThinSpaces(1000000)).toBe('1\u2009000\u2009000');
    });
  });

  describe('formatWithCommas', () => {
    it('formats small numbers without commas', () => {
      expect(formatWithCommas(0)).toBe('0');
      expect(formatWithCommas(999)).toBe('999');
    });

    it('formats thousands with commas', () => {
      expect(formatWithCommas(1000)).toBe('1,000');
      expect(formatWithCommas(1234)).toBe('1,234');
    });

    it('formats millions with commas', () => {
      expect(formatWithCommas(1000000)).toBe('1,000,000');
      expect(formatWithCommas(1234567)).toBe('1,234,567');
    });
  });

  describe('formatLocaleWithSpaces', () => {
    it('formats numbers using locale and replaces commas with spaces', () => {
      expect(formatLocaleWithSpaces(1000)).toBe('1 000');
      expect(formatLocaleWithSpaces(1234567)).toBe('1 234 567');
    });

    it('handles decimal numbers', () => {
      // toLocaleString includes decimals, so we test the space replacement
      const result = formatLocaleWithSpaces(1234.56);
      expect(result).toContain(' ');
      expect(result).not.toContain(',');
    });
  });

  describe('formatLocaleWithThinSpaces', () => {
    it('formats numbers using locale and replaces commas with thin spaces', () => {
      expect(formatLocaleWithThinSpaces(1000)).toBe('1\u2009000');
      expect(formatLocaleWithThinSpaces(1234567)).toBe('1\u2009234\u2009567');
    });
  });
});
