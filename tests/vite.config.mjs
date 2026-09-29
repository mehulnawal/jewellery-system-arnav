import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// This separate test server replaces only session/config modules. The actual
// forms, services, routes and CSS run against a local demo Firestore project.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: [
    { find: /^(?:\.\.\/|\.\/)+(?:auth\/)?AuthContext(?:\.jsx)?$/, replacement: fileURLToPath(new URL("./fixtures/auth.jsx", import.meta.url)) },
    { find: /^(?:\.\.\/|\.\/)+firebase\/config(?:\.js)?$/, replacement: fileURLToPath(new URL("./fixtures/firebase.js", import.meta.url)) },
  ] },
  server: { host: "127.0.0.1", port: 4175, strictPort: true },
});
