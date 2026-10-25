import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "orderList.browser.spec.mjs",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4176",
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  },
  webServer: {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js --config tests/sidebar.vite.config.mjs`,
    url: "http://127.0.0.1:4176",
    cwd: "..",
  },
});
