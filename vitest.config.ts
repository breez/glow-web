import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [react(), wasm()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules',
        'src/test',
        '**/*.d.ts',
        '**/*.config.*',
        'e2e',
      ],
    },
    // Pool configuration for test isolation
    pool: 'forks',
    forks: {
      singleFork: false,
    },
    // Deps handling for WASM module
    server: {
      deps: {
        inline: ['@breeztech/breez-sdk-spark'],
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
