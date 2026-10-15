import { defineConfig } from '@playwright/test';
import base from './playwright.config';
const baseURL = 'http://127.0.0.1:5195';
export default defineConfig({
  ...base,
  testMatch: 'quick-ballots.spec.ts',
  outputDir: '.artifacts/quick-ballots/browser',
  use: { ...base.use, baseURL },
  webServer: {
    command: 'npm run dev -- --port 5195 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30000,
    env: { VITE_NETWORK: '', VITE_API_ORIGIN: '', VITE_API_TESTNET: '', VITE_API_PRODUCTION: '' },
  },
});
