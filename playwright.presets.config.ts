import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: 'dao-presets.spec.ts',
  outputDir: '.artifacts/browser/presets',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5278' },
  webServer: {
    command: 'npm run dev -- --port 5278',
    url: 'http://127.0.0.1:5278',
    reuseExistingServer: false,
  },
});
