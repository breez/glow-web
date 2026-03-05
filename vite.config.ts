import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { brand } from './src/config/brand';
import pkg from './package.json' with { type: 'json' };

/**
 * Vite plugin that injects brand values into index.html at build time.
 * Handles splash screen, meta tags, and font URLs that render before React.
 */
function brandHtmlPlugin(): Plugin {
  const { colors, fonts } = brand.theme;

  function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const fontFamilies = [
    `family=${fonts.display.replace(/ /g, '+')}:wght@300;400;500;600;700;800`,
    `family=${fonts.mono.replace(/ /g, '+')}:wght@400;500;600`,
  ];
  const fontsUrl = `https://fonts.googleapis.com/css2?${fontFamilies.join('&')}&display=swap`;

  return {
    name: 'brand-html',
    enforce: 'pre' as const,
    transformIndexHtml: {
      order: 'pre' as const,
      handler(html: string) {
        return html
          .replaceAll('%BRAND_NAME%', brand.name)
          .replaceAll('%BRAND_DESCRIPTION%', brand.description)
          .replaceAll('%BRAND_BG%', colors.background)
          .replaceAll('%BRAND_PRIMARY%', colors.primary)
          .replaceAll('%BRAND_PRIMARY_30%', hexToRgba(colors.primary, 0.3))
          .replaceAll('%BRAND_PRIMARY_60%', hexToRgba(colors.primary, 0.6))
          .replaceAll('%BRAND_FONTS_URL%', fontsUrl);
      },
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: env.VITE_BASE_PATH || '/',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
      react(),
      wasm(),
      topLevelAwait(),
      nodePolyfills(),
      brandHtmlPlugin(),
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
      rollupOptions: {
        output: {
          manualChunks: {
            polyfills: ['buffer', 'process', 'events', 'stream-browserify'],
          },
        },
      },
    },
    optimizeDeps: {
      exclude: ['@breeztech/breez-sdk-spark'],
    }
  };
});
