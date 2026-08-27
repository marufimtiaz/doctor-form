import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    // Schemas are pure functions. No jsdom, no component rendering - the
    // markup is what this project churns, so DOM tests written now would be
    // rewritten twice.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
