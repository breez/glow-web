import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [
      react(),
      wasm(),
      nodePolyfills()
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
      sourcemap: true,
      chunkSizeWarningLimit: 1700,
    },
    optimizeDeps: {
      exclude: ['@breeztech/breez-sdk-spark'],
    }
  };
});
