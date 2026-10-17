import { defineConfig, devices } from '@playwright/test';

// Regenerates the README screenshots (docs/screenshots) with mock data: npm run screenshots
const executablePath = process.env.PW_CHROMIUM || undefined;

export default defineConfig({
  testDir: 'tests/screenshots',
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    serviceWorkers: 'block',
    locale: 'el-GR',
    ...devices['Desktop Chrome'],
    launchOptions: { executablePath },
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
  },
});
