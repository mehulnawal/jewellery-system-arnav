import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: ["restoration.ui.spec.mjs", "challanChanges.ui.spec.mjs"],
  outputDir: "test-results/restoration",
  workers: 1,
  timeout: 90000,
  expect: { timeout: 12000 },
  use: {
    baseURL: "http://127.0.0.1:4175",
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js --config tests/vite.config.mjs`,
    env: {
      VITE_CLOUDINARY_CLOUD_NAME: "test-cloud",
      VITE_CLOUDINARY_UPLOAD_PRESET: "test-unsigned-preset",
    },
    url: "http://127.0.0.1:4175",
    cwd: "..",
  },
});
