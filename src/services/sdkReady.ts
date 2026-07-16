import initBreezSDK from '@breeztech/breez-sdk-spark';
import { logger, LogCategory } from '@/services/logger';

/**
 * The Breez SDK ships as a ~11 MB WASM module. We deliberately do NOT block
 * first paint on it: main.tsx renders <App/> immediately and kicks this off in
 * the background via startSdkInit(). The welcome / onboarding screen never
 * touches the SDK, so it can paint and become interactive while the module
 * compiles.
 *
 * Every runtime SDK call (connect, initLogging, defaultConfig, the browser
 * PasskeyProvider) must `await sdkReady()` first, since a call before the
 * module is instantiated throws. In the common case the module is ready long
 * before the user taps, so the await resolves immediately.
 */
let readyPromise: Promise<void> | null = null;

/** Begin loading + instantiating the SDK WASM module. Idempotent. */
export function startSdkInit(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      const t0 = performance.now();
      logger.info(LogCategory.SDK, 'Initializing WASM module');
      await initBreezSDK();
      logger.info(LogCategory.SDK, 'WASM module initialized successfully', {
        ms: Math.round(performance.now() - t0),
      });
    })();
    // Attach a logging handler so a failed init never surfaces as an unhandled
    // rejection when nobody happens to be awaiting it yet (e.g. a user just
    // looking at the welcome screen). Awaiters still observe the rejection.
    readyPromise.catch((e) => {
      logger.error(LogCategory.SDK, 'WASM module initialization failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    });
  }
  return readyPromise;
}

/** Resolves once the SDK WASM module is instantiated. Starts init if needed. */
export function sdkReady(): Promise<void> {
  return startSdkInit();
}
