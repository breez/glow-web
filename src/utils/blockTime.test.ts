import { describe, it, expect } from 'vitest';
import { formatBlockWait, formatDaysLeft } from './blockTime';

describe('formatBlockWait', () => {
  it('reads as ready when nothing is left to wait', () => {
    expect(formatBlockWait(0)).toBe('ready now');
  });

  it('describes a single block as about ten minutes', () => {
    expect(formatBlockWait(1)).toBe('~10 min');
  });

  it('describes an hour of blocks in minutes', () => {
    expect(formatBlockWait(3)).toBe('~30 min');
  });

  it('switches to hours past an hour', () => {
    expect(formatBlockWait(12)).toBe('~2 h');
  });

  it('switches to days past a day', () => {
    expect(formatBlockWait(144)).toBe('~1 d');
  });

  it('rounds a multi-day wait to whole days', () => {
    expect(formatBlockWait(2000)).toBe('~14 d');
  });

  it('treats a negative wait as ready', () => {
    expect(formatBlockWait(-5)).toBe('ready now');
  });
});

describe('formatDaysLeft', () => {
  it('rounds to whole days, with no marker', () => {
    expect(formatDaysLeft(2000)).toBe('14');
  });

  it('reads under a day as less than one', () => {
    expect(formatDaysLeft(60)).toBe('<1');
  });

  it('reads nothing left as zero', () => {
    expect(formatDaysLeft(0)).toBe('0');
  });
});
