import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testMatch: ['dao-claims.spec.ts', 'creation-session.spec.ts', 'creation-resume.spec.ts'],
  use: { ...base.use, baseURL: 'http://localhost:' + (process.env.DACLIFY_TEST_UI_PORT ?? '5178') },
  outputDir: '.artifacts/browser/claims',
});
