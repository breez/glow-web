import { backUpWhenExitLands, captureExitState, saveExitState } from '../exitState';
import { useEffect, useState } from 'react';
import type { BreezSdk, SdkEvent } from '@breeztech/breez-sdk-spark';
import {
  advanceNow,
  getUnilateralExitState,
  startUnilateralExitEngine,
  stopUnilateralExitEngine,
  subscribeUnilateralExit,
  type UnilateralExitEngineState,
} from '../engine';
import { createChainClient } from '@/services/chain';

/** The engine as it stands, re-rendering on every pass. */
export function useUnilateralExitEngineState(): UnilateralExitEngineState {
  const [state, setState] = useState(getUnilateralExitState);
  useEffect(() => subscribeUnilateralExit(setState), []);
  return state;
}

/**
 * Runs the engine for the connected wallet for as long as the app is open: an
 * exit's steps become sendable days apart, whether or not its page is showing.
 */
export function useUnilateralExitEngineLifecycle(
  identityPubkey: string | undefined,
  network: string | undefined,
  sdk?: BreezSdk | null,
): void {
  useEffect(() => {
    if (!identityPubkey || !network) return;
    startUnilateralExitEngine({ identityPubkey, network }, createChainClient(network), sdk);
    return () => stopUnilateralExitEngine();
  }, [identityPubkey, network, sdk]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void advanceNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    if (!sdk || !identityPubkey) return;
    return subscribeUnilateralExit(
      backUpWhenExitLands(sdk, state => saveExitState(identityPubkey, state)),
    );
  }, [sdk, identityPubkey]);

  // Once the operators stop serving them, the leaves an exit is built from
  // exist only on this device, so every change to them is backed up.
  useEffect(() => {
    if (!sdk || !identityPubkey) return;
    let listenerId: string | null = null;
    void (async () => {
      listenerId = await sdk.addEventListener({
        onEvent: (event: SdkEvent) => {
          if (event.type !== 'unilateralExitStateChanged') return;
          void captureExitState(sdk, getUnilateralExitState().plan, state =>
            saveExitState(identityPubkey, state),
          );
        },
      });
    })();
    return () => {
      if (listenerId) void sdk.removeEventListener(listenerId).catch(() => undefined);
    };
  }, [sdk, identityPubkey]);
}
