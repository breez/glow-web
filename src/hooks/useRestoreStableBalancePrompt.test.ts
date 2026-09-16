import { describe, it, expect } from 'vitest';
import { shouldPromptStableRestore } from './useRestoreStableBalancePrompt';

describe('shouldPromptStableRestore', () => {
  it('prompts for USD held outside USD mode that was never answered', () => {
    expect(shouldPromptStableRestore(5_000n, false, null)).toBe(true);
  });

  it('stays quiet in USD mode', () => {
    expect(shouldPromptStableRestore(5_000n, true, null)).toBe(false);
  });

  it('stays quiet with no USD held', () => {
    expect(shouldPromptStableRestore(0n, false, null)).toBe(false);
  });

  it('stays quiet at or below the balance already answered', () => {
    expect(shouldPromptStableRestore(5_000n, false, 5_000n)).toBe(false);
    expect(shouldPromptStableRestore(30n, false, 5_000n)).toBe(false);
  });

  it('prompts again when another device converts the balance after an answer', () => {
    // Answered with dust left after switching to sats here, then a device still
    // in USD mode converted the balance.
    expect(shouldPromptStableRestore(900_000n, false, 30n)).toBe(true);
  });
});
