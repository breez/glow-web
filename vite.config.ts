import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import pkg from './package.json' with { type: 'json' }

// The spark-config.json a local Spark environment writes, which regtest then
// connects to. Only the dev server reads it: a build's CSP refuses the plain
// http the environment is served over.
const localSparkConfig = (path: string | undefined): string | null => {
  if (!path) return null;
  const file = resolve(path);
  if (!existsSync(file)) {
    throw new Error(`No Spark config at ${file}: start the local Spark environment, or unset SPARK_CONFIG_PATH`);
  }
  return readFileSync(file, 'utf8');
};

// https://vitejs.dev/config/
// The local Spark environment is served over plain http on localhost, which
// the shipped `connect-src 'self' https: wss:` refuses. Widening it only in the
// dev server keeps the production policy (index.html + vercel.json) untouched.
const allowLocalEnvironmentCsp = () => ({
  name: 'allow-local-environment-csp',
  apply: 'serve' as const,
  transformIndexHtml: (html: string) =>
    html.replace(
      /(<meta http-equiv="Content-Security-Policy"[^>]*connect-src )([^;]*)/,
      '$1$2 http://localhost:* http://127.0.0.1:*',
    ),
});

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: env.VITE_BASE_PATH || '/',
    define: {
      // The web build has no native shell to ask, so the label falls back to
      // this. Kept in step with glow-app's package.json version.
      __APP_VERSION__: JSON.stringify(pkg.version),
      __SPARK_CONFIG__: JSON.stringify(command === 'serve' ? localSparkConfig(env.SPARK_CONFIG_PATH) : null),
    },
    plugins: [
      react(),
      wasm(),
      nodePolyfills(),
      allowLocalEnvironmentCsp(),
    ],
    server: {
      host: env.VITE_SERVER_HOST || 'localhost',
      allowedHosts: env.VITE_SERVER_ALLOWED_HOSTS
        ? env.VITE_SERVER_ALLOWED_HOSTS.split(',')
        : [],
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
      fs: {
        // Allow serving files from project root and node_modules
        allow: ['..'],
      },
    },
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    build: {
      target: 'esnext',
      outDir: 'dist',
      assetsDir: 'assets',
      // Dev only. A production map ships the full unminified source of the
      // seed, app-lock and passkey services inside the IPA / AAB, readable
      // by unzipping the store binary.
      sourcemap: mode !== 'production',
      chunkSizeWarningLimit: 1700,
    },
    optimizeDeps: {
      exclude: ['@breeztech/breez-sdk-spark'],
    }
  };
});
