/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BREEZ_API_KEY: string;
  readonly VITE_STAGING_PASSWORD?: string;
  readonly VITE_CONSOLE_LOGGING?: 'true' | 'false';
  /** Chain API (mempool.space) overriding the per-network default. The unilateral exit reads it, and so does a wallet on the local Spark environment. */
  readonly VITE_ESPLORA_BASE_URL?: string;
  /** Seconds between unilateral exit passes, overriding the per-network default. */
  readonly VITE_UNILATERAL_EXIT_POLL_SECS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Version of the web bundle, injected by vite.config.ts from package.json. */
declare const __APP_VERSION__: string;

/** The local Spark environment's spark-config.json, when the dev server was given one. */
declare const __SPARK_CONFIG__: string | null;
