import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "goodsWithCustomers.browser.spec.mjs",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4189", channel: "msedge" },
  webServer: {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4189 --strictPort`,
    url: "http://127.0.0.1:4189",
    cwd: "..",
  },
});
