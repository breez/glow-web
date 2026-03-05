/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_BREEZ_API_KEY: string;
  readonly VITE_STAGING_PASSWORD?: string;
  readonly VITE_CONSOLE_LOGGING?: 'true' | 'false';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
