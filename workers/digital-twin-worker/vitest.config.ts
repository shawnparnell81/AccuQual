import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The first test wipes the shared test database before it seeds its company. On a busy machine that can pass 10 s.
    hookTimeout: 30000,
  },
});
