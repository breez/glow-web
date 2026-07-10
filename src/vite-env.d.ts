/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BREEZ_API_KEY: string;
  readonly VITE_STAGING_PASSWORD?: string;
  readonly VITE_CONSOLE_LOGGING?: 'true' | 'false';
  /** TestFlight-only override for the iOS Buy Bitcoin hide (Guideline 3.1.5(iii)) */
  readonly VITE_IOS_ENABLE_BUY?: 'true' | 'false';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
