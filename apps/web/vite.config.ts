// vitest/config re-exports Vite's defineConfig and adds the `test` key.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // The API server (apps/server) listens on 8787. Proxying keeps the browser
    // on one origin, so there is no CORS to configure during development.
    proxy: { "/api": "http://localhost:8787" },
  },
  preview: {
    proxy: { "/api": "http://localhost:8787" },
  },
  test: {
    environment: "node",
  },
});
