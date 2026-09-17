import { useCallback, useEffect, useState } from 'react';
import type { GetInfoResponse } from '@breeztech/breez-sdk-spark';
import { USDB_TOKEN_IDENTIFIER } from '../constants/stableBalance';
import { getTokenBalance } from '../utils/tokenFormatting';
import { getStableRestoreAcknowledged, setStableRestoreAcknowledged } from '../services/settings';

interface UseRestoreStableBalancePromptArgs {
  isSyncing: boolean;
  walletInfo: GetInfoResponse | null;
  isStableBalanceActive: boolean;
}

interface UseRestoreStableBalancePromptResult {
  shouldPrompt: boolean;
  markPrompted: () => void;
}

/**
 * Whether USD held outside USD mode calls for the restore prompt. It does only
 * when there is more USD than this device last answered for: the mode is kept
 * per device, but conversions move the whole balance, so another device still
 * in USD mode can convert it after the prompt was answered here.
 */
export function shouldPromptStableRestore(
  tokenBalance: bigint,
  isStableBalanceActive: boolean,
  acknowledged: bigint | null,
): boolean {
  return !isStableBalanceActive && tokenBalance > 0n && (acknowledged === null || tokenBalance > acknowledged);
}

export function useRestoreStableBalancePrompt({
  isSyncing,
  walletInfo,
  isStableBalanceActive,
}: UseRestoreStableBalancePromptArgs): UseRestoreStableBalancePromptResult {
  // The acknowledged balance lives in localStorage; bump this tick on writes
  // so the hook re-renders and re-reads it.
  const [, setTick] = useState(0);

  const heldUsd = walletInfo
    ? (getTokenBalance(walletInfo.tokenBalances, USDB_TOKEN_IDENTIFIER)?.balance ?? 0n)
    : null;
  const settledUsd = isSyncing ? null : heldUsd;
  const acknowledged = getStableRestoreAcknowledged();

  // USD converted back or spent lowers the mark, so USD that arrives later
  // prompts again. No re-render needed: a lower mark only matters once USD
  // rises, and that change re-renders.
  useEffect(() => {
    if (settledUsd === null || acknowledged === null || settledUsd >= acknowledged) return;
    setStableRestoreAcknowledged(settledUsd);
  }, [settledUsd, acknowledged]);

  const shouldPrompt = settledUsd !== null
    && shouldPromptStableRestore(settledUsd, isStableBalanceActive, acknowledged);

  const markPrompted = useCallback(() => {
    if (heldUsd === null) return;
    setStableRestoreAcknowledged(heldUsd);
    setTick(t => t + 1);
  }, [heldUsd]);

  return { shouldPrompt, markPrompted };
}
