import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5000 },
  reporter: [['html', { open: 'never' }]],
  webServer: {
    command: 'npx cross-env PORT=5175 npm run dev',
    url: 'http://localhost:5175',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    baseURL: 'http://localhost:5175',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});
