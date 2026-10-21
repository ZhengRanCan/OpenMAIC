import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e/tests',
  testMatch: 'quiz-evidence-live.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240000,
  reporter: 'list',
  use: {
    baseURL: process.env.F64_LIVE_BASE_URL,
    storageState: process.env.F64_LIVE_STORAGE_STATE,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium' }],
  // Deliberately no webServer or default localhost: an explicitly prepared instance only.
});
