import { useCallback, useState } from 'react';
import type { GetInfoResponse } from '@breeztech/breez-sdk-spark';
import { USDB_TOKEN_IDENTIFIER } from '../constants/stableBalance';
import { getTokenBalance } from '../utils/tokenFormatting';
import { hasPromptedStableRestore, setStableRestorePrompted } from '../services/settings';

interface UseRestoreStableBalancePromptArgs {
  isSyncing: boolean;
  walletInfo: GetInfoResponse | null;
  isStableBalanceActive: boolean;
}

interface UseRestoreStableBalancePromptResult {
  shouldPrompt: boolean;
  markPrompted: () => void;
}

export function useRestoreStableBalancePrompt({
  isSyncing,
  walletInfo,
  isStableBalanceActive,
}: UseRestoreStableBalancePromptArgs): UseRestoreStableBalancePromptResult {
  // The "prompted" flag lives in localStorage; bump this tick on
  // markPrompted so the hook re-renders and re-reads it.
  const [, setPromptedTick] = useState(0);

  let shouldPrompt = false;
  if (
    !isSyncing
    && walletInfo
    && !isStableBalanceActive
    && !hasPromptedStableRestore()
  ) {
    const tokenBal = getTokenBalance(walletInfo.tokenBalances, USDB_TOKEN_IDENTIFIER);
    if (tokenBal && tokenBal.balance > 0n) {
      shouldPrompt = true;
    }
  }

  const markPrompted = useCallback(() => {
    setStableRestorePrompted();
    setPromptedTick(t => t + 1);
  }, []);

  return { shouldPrompt, markPrompted };
}
