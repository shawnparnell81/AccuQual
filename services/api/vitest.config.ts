import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // One database and one company for the whole suite: test files take turns instead of running side by side.
    fileParallelism: false,
    // Clean-up hooks close the shared pool after late async writes land. On a busy machine that can pass 10 s.
    hookTimeout: 30000,
  },
});
