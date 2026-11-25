/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BREEZ_API_KEY: string;
  readonly VITE_STAGING_PASSWORD?: string;
  readonly VITE_TRANSLATION_REPORT_EMAIL?: string;
  readonly VITE_CONSOLE_LOGGING?: 'true' | 'false';
  /** Esplora API the unilateral exit reads chain state from, overriding the per-network default. */
  readonly VITE_ESPLORA_BASE_URL?: string;
  /** JSON SparkConfig of a locally-run operator cluster, replacing the hosted pool. */
  readonly VITE_SPARK_LOCAL_CONFIG?: string;
  /** Seconds between unilateral exit passes, overriding the per-network default. */
  readonly VITE_UNILATERAL_EXIT_POLL_SECS?: string;
  /** Where the mempool `/v1` endpoints live, when not alongside the esplora ones. */
  readonly VITE_MEMPOOL_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Version of the web bundle, injected by vite.config.ts from package.json. */
declare const __APP_VERSION__: string;
