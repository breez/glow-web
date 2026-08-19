/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BREEZ_API_KEY: string;
  readonly VITE_STAGING_PASSWORD?: string;
  readonly VITE_CONSOLE_LOGGING?: 'true' | 'false';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
