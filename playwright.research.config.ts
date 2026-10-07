import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: ['research-modules.spec.ts', 'spending-reports.spec.ts'],
  outputDir: '.artifacts/browser/research',
  metadata: { nativeFixture: 'daclify-research-native' },
  globalSetup: './tools/check-browser-fixture.ts',
});
