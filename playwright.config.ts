import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',

  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  projects: [
    { name: 'clients', testMatch: '**/clients/**/*.spec.ts' },
    { name: 'api', testMatch: '**/api/**/*.spec.ts' },
    { name: 'opcua', testMatch: '**/opcua/**/*.spec.ts' },
    { name: 'security', testMatch: '**/security/**/*.spec.ts' },
    {
      name: 'ui',
      testMatch: '**/ui/**/*.spec.ts',
      use: {
        headless: !!process.env.CI,
        channel:
          (process.env.PLAYWRIGHT_CHANNEL as 'chrome' | 'msedge' | undefined) ??
          (process.env.CI ? undefined : 'chrome'),
      },
    },
    { name: 'integration', testMatch: '**/integration/**/*.spec.ts' },
  ],

  expect: {
    timeout: 5_000,
  },

  use: {
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL as 'chrome' | 'msedge' | undefined,
    locale: 'en-GB',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    viewport: {
      width: 1440,
      height: 900,
    },

    ignoreHTTPSErrors: false,

    screenshot: 'only-on-failure',

    trace: 'retain-on-failure',
  },
});
