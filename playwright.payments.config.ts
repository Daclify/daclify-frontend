import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'connected-payments.spec.ts',
  workers: 1,
  timeout: 30000,
  outputDir: '.artifacts/browser/connected-payments',
  use: { baseURL: 'http://127.0.0.1:5218', trace: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5218',
    url: 'http://127.0.0.1:5218',
    reuseExistingServer: false,
  },
});
