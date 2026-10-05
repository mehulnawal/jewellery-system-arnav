import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [
    { find: /^(?:\.\.\/|\.\/)+(?:auth\/)?AuthContext(?:\.jsx)?$/, replacement: fileURLToPath(new URL("./fixtures/auth.jsx", import.meta.url)) },
    { find: /^(?:\.\.\/|\.\/)+firebase\/config(?:\.js)?$/, replacement: fileURLToPath(new URL("./fixtures/firebase.js", import.meta.url)) },
    { find: /^\.\/BusinessGate$/, replacement: fileURLToPath(new URL("./fixtures/sidebarWrappers.jsx", import.meta.url)) },
    { find: /^\.\.\/hooks\/useMasterPrices$/, replacement: fileURLToPath(new URL("./fixtures/sidebarWrappers.jsx", import.meta.url)) },
  ] },
  server: { host: "127.0.0.1", port: 4176, strictPort: true },
});