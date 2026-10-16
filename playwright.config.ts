import { defineConfig, devices } from '@playwright/test';
import { z } from 'zod';
const port = z.coerce
  .number()
  .int()
  .min(1024)
  .max(65535)
  .parse(process.env.DACLIFY_TEST_UI_PORT ?? 5178);
const host = z
  .enum(['127.0.0.1', 'localhost'])
  .parse(process.env.DACLIFY_TEST_UI_HOST ?? '127.0.0.1');
const baseURL = `http://${host}:${port}`;
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  outputDir: '.artifacts/browser',
  use: { baseURL, trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
