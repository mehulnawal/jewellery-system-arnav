import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'inventoryForm.browser.spec.mjs', workers: 1,
  use: { baseURL: 'http://127.0.0.1:4175', channel: 'chrome' },
  expect: { timeout: 10000 },
  webServer: {
    command: 'npx vite --config tests/vite.config.mjs',
    url: 'http://127.0.0.1:4175', cwd: '..',
  },
});