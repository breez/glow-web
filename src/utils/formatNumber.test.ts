import { describe, expect, it } from 'vitest';
import { groupUsd } from './formatNumber';

describe('groupUsd', () => {
  it('groups the whole part and leaves the cents alone', () => {
    expect(groupUsd('11049582.62')).toBe('11,049,582.62');
    expect(groupUsd('999.99')).toBe('999.99');
    expect(groupUsd('1000')).toBe('1,000');
  });
});
