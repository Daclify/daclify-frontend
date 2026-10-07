import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testIgnore: [
    'research-modules.spec.ts',
    'spending-reports.spec.ts',
    'connected-payments.spec.ts',
  ],
  outputDir: '.artifacts/browser/paid',
  metadata: { nativeFixture: 'daclify-research-paid-native' },
  globalSetup: './tools/check-browser-fixture.ts',
});
