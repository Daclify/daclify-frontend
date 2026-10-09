import { defineConfig } from '@playwright/test';
import shared from './playwright.config';

const baseURL = 'http://127.0.0.1:5418';
export default defineConfig({
  ...shared,
  testMatch: 'pwa.spec.ts',
  outputDir: '.artifacts/browser/pwa',
  use: { ...shared.use, baseURL },
  webServer: {
    command:
      'npm run build -- --mode pwa-test --outDir .artifacts/pwa-dist && npx vite preview --outDir .artifacts/pwa-dist --host 127.0.0.1 --port 5418 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      VITE_NETWORK: '',
      VITE_API_ORIGIN: '',
      VITE_API_TESTNET: '',
      VITE_API_PRODUCTION: '',
    },
  },
});
