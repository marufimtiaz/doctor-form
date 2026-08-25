import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Required for HMR to work through the Docker port mapping.
    watch: { usePolling: true },
    proxy: {
      // Dev-only: mirrors what Caddy does in production, so the app code
      // can always talk to a same-origin /api regardless of environment.
      "/api": {
        target: process.env.VITE_PROXY_TARGET ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
