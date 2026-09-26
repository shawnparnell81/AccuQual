import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // One database and one company for the whole suite: test files take turns instead of running side by side.
    fileParallelism: false,
  },
});
