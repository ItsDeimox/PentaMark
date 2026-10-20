import { defineConfig } from '@playwright/test';
const port = Number(process.env.PM_TEST_PORT || 3417);
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.mjs', fullyParallel: false, workers: 1,
  timeout: 30000, expect: { timeout: 6000 }, retries: 0,
  reporter: [['line'], ['json', { outputFile: 'test-results/results.json' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1672, height: 941 }, headless: true, launchOptions: { ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox','--enable-unsafe-swiftshader'] }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node tests/start-vault.mjs', url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 30000 },
});
