import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "inventoryTable.browser.spec.mjs",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4178", channel: "chrome" },
  expect: { timeout: 10000 },
  webServer: {
    command: "npx vite --config tests/inventoryTable.vite.config.mjs",
    url: "http://127.0.0.1:4178",
    cwd: "..",
  },
});
