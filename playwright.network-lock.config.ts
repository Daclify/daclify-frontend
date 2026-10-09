import { defineConfig } from '@playwright/test';
import shared from './playwright.config';

const baseURL = 'http://127.0.0.1:5308';
export default defineConfig({
  ...shared,
  testMatch: 'network-lock.spec.ts',
  outputDir: '.artifacts/browser/network-lock',
  use: { ...shared.use, baseURL },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      DACLIFY_TEST_UI_PORT: '5308',
      VITE_NETWORK: 'testnet',
      VITE_API_TESTNET: 'https://testnet-api.example',
      VITE_API_PRODUCTION: 'https://api.example',
      VITE_API_ORIGIN: '',
    },
  },
});
