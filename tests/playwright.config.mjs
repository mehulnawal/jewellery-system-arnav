import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: [
    "ui.spec.mjs",
    "inventoryDiscovery.ui.spec.mjs",
    "masterPrices.ui.spec.mjs",
    "statusSettings.ui.spec.mjs",
    "challanChanges.ui.spec.mjs",
    "sidebarPolish.ui.spec.mjs",
  ],
  fullyParallel: false,
  workers: 1,
  maxFailures: 1,
  timeout: 45000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:4175",
    viewport: { width: 1440, height: 1000 },
    channel: "chrome",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx vite --config tests/vite.config.mjs",
    env: {
      VITE_CLOUDINARY_CLOUD_NAME: "test-cloud",
      VITE_CLOUDINARY_UPLOAD_PRESET: "test-unsigned-preset",
    },
    url: "http://127.0.0.1:4175",
    reuseExistingServer: process.env.TEST_REUSE_SERVER === "true",
    cwd: "..",
  },
});
