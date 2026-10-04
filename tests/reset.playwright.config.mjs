import { defineConfig } from "@playwright/test";
import base from "./playwright.config.mjs";
export default defineConfig({
  ...base,
  testMatch: ["reset.ui.spec.mjs"],
  timeout: 120000,
  outputDir: "test-results-reset",
  use: { ...base.use, baseURL: "http://127.0.0.1:4185" },
  webServer: {
    ...base.webServer,
    command: "npx vite --config tests/vite.config.mjs --port 4185",
    url: "http://127.0.0.1:4185",
  },
});
