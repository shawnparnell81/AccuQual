// Flat ESLint config shared by every workspace package.
// ESLint resolves this by walking up from each package's cwd, so
// `npm run lint --workspace services/api` (etc.) picks it up automatically.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/drizzle/migrations/**", "**/*.js"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
    },
  }
);
