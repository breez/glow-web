import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

// Load test environment variables (in order of priority)
// 1. .env.test.local - test-specific secrets (highest priority)
// 2. .env.local - local development secrets
// 3. .env - default config
dotenv.config({ path: '.env.test.local' });
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false, // Wallet tests should run serially to avoid conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Serial execution for wallet E2E tests
  reporter: process.env.CI ? 'github' : 'html',
  timeout: 60000, // 60s per test (wallet operations can be slow)

  use: {
    // Use regtest for E2E tests
    baseURL: process.env.TEST_BASE_URL || 'http://localhost:5173?network=regtest',
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment for additional browser coverage
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
    // Mobile viewport
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
  ],

  // Run local dev server before tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000, // 2 minutes to start server (WASM takes time)
  },
});
