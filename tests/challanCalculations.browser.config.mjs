import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "challanCalculations.browser.spec.mjs",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4178", channel: "chrome" },
  expect: { timeout: 10000 },
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 4178 --strictPort",
    url: "http://127.0.0.1:4178",
    cwd: "..",
  },
});
