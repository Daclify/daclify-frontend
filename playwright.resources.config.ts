import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testMatch: ['files.spec.ts', 'platform.spec.ts'],
  outputDir: '.artifacts/browser/resources',
  metadata: { nativeFixture: 'daclify-resources-native' },
  globalSetup: './tools/check-browser-fixture.ts',
});
