import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
  },
  server: {
    deps: {
      inline: [/@3dprintmty\//],
    },
  },
});
