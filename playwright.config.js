// End-to-end tests: real Chromium playing the real game.
// Run with `npm run test:e2e`. Set CHROME_PATH to use an installed Chrome
// instead of the browser downloaded by `npx playwright install chromium`.
const { defineConfig, devices } = require('@playwright/test');

const launchOptions = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};

module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    launchOptions
  },
  webServer: {
    command: 'node tests/e2e/server.js',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: !process.env.CI
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions }, testIgnore: /phone\.spec/ },
    { name: 'phone', use: { ...devices['Pixel 7'], launchOptions }, testMatch: /phone\.spec/ }
  ]
});
