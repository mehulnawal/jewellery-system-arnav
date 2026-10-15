import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import base from "./vite.config.mjs";

export default defineConfig({
  ...base,
  resolve: {
    alias: [
      ...base.resolve.alias,
      {
        find: /^(?:\.\.\/|\.\/)+hooks\/useInventoryDiscovery(?:\.js)?$/,
        replacement: fileURLToPath(
          new URL("./fixtures/inventoryTableRows.js", import.meta.url),
        ),
      },
    ],
  },
  server: { host: "127.0.0.1", port: 4178, strictPort: true },
});
