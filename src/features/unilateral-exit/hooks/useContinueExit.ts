import { useCallback, useEffect, useState } from 'react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import type { ChainClient } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';
import { awaitsUpdate, type ExitStatus, type WalletKey } from '../model/plan';
import { RebuildLaterError } from '../building';
import { rebuildExit } from '../rebuild';
import { advanceNow } from '../engine/polling';
import { setUnilateralExitPlan } from '../engine/api';
import type { UnilateralExitEngineState } from '../engine/state';

interface ContinueInputs {
  wallet: BreezSdk;
  walletKey: WalletKey | null;
  chain: ChainClient;
  engine: Pick<UnilateralExitEngineState, 'plan' | 'tipHeight'>;
}

// The redo card's button: the rebuild the engine runs on its own, from a tap.
// A diverged exit needs no new fee rate or funding, so the wizard would only
// add steps, and the tap is what lets a passkey wallet sign.
export function useContinueExit({ wallet, walletKey, chain, engine }: ContinueInputs) {
  const { plan, tipHeight } = engine;
  const [isContinuing, setIsContinuing] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);

  const continueExit = useCallback(async () => {
    if (!plan || !walletKey) return;
    setIsContinuing(true);
    setContinueError(null);
    try {
      // A rebuild with nothing left comes back done, and the engine archives it.
      const rebuilt = await rebuildExit(plan, wallet, walletKey.identityPubkey, { interactive: true });
      // This build just read the chain, so a step it still could not read waits
      // for the next block instead of asking for the tap again at once. Read
      // here, after the prompt: the engine's tip is stale while a redo waits.
      const tip = await chain.tipHeight().catch(() => tipHeight ?? undefined);
      setUnilateralExitPlan(walletKey, { ...rebuilt, unverifiedRebuiltAt: tip });
    } catch (e) {
      // Nothing to build until the chain shows where a leaf went: waiting, not
      // failure. A sign-in request stays until a tap lifts it, so this one
      // does. A failed rebuild is the engine's to clear on its next pass, and
      // the plan held here may already be stale.
      if (e instanceof RebuildLaterError) {
        const { status } = plan;
        if (status.type === 'needsUpdate' && status.why === 'signIn') {
          const lifted: ExitStatus = status.cause ? { type: 'running' } : { type: 'rebuilding' };
          setUnilateralExitPlan(walletKey, { ...plan, status: lifted, rebuildFailingSince: undefined });
        } else void advanceNow();
        return;
      }
      logger.error(LogCategory.SDK, 'Failed to continue unilateral exit', { error: formatError(e) });
      setContinueError(formatError(e));
    } finally {
      setIsContinuing(false);
    }
  }, [plan, wallet, walletKey, chain, tipHeight]);

  // A card that comes back explains itself again rather than showing an error
  // from before. Cleared on the way out, not in the body, which would set
  // state during the effect.
  const asksForUpdate = !!plan && awaitsUpdate(plan);
  useEffect(() => {
    if (!asksForUpdate) return;
    return () => setContinueError(null);
  }, [asksForUpdate]);

  const clearContinueError = useCallback(() => setContinueError(null), []);
  return { continueExit, isContinuing, continueError, clearContinueError };
}
