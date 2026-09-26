// Loaded before every test file (see vitest.config.ts). Some pure-logic
// modules (e.g. utils/crudFactory.ts) transitively import config/env.ts for
// unrelated reasons (it's on the import path to something they do need),
// and that module validates the full env schema at import time — so unit
// tests need *some* value for every required var, even ones the test itself
// never touches.
//
// .env.test is loaded FIRST so it wins on any key it sets (dotenv never
// overwrites an already-set process.env key) — today that's just
// DATABASE_URL/NODE_ENV, pointed at a real, separately-migrated
// `accuqual_test` database (see .env.test's own comment for how to create
// and migrate it). This is a deliberate fix, not the original design: this
// file used to load the real .env first, so test/integration/*.test.ts —
// which DOES connect to a real Postgres, deliberately, see its own header
// comment — silently wrote its companies into the exact same database
// `npm run dev` and any demo used, which is how that database ended up with
// dozens of leftover "... Test Company ..." rows still marked Active. Real
// .env values still load second, for every other required var (JWT
// secrets, encryption key, etc.) that has no reason to differ in tests. In
// CI there is no .env or .env.test file (both imports are then a no-op) and
// the workflow's own `env:` block has already set real values directly; in
// any environment with none of the three, the fallback below still keeps
// the pure-logic unit tests running without a real DB.
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Deliberately NOT `import "dotenv/config"` — that's a static import, hoisted
// above any other code in this file regardless of where it's written, which
// would load the real .env (and lock in its DATABASE_URL) before a
// same-named override from .env.test ever got a chance to run. Calling
// dotenv's config() explicitly, in this order, is what actually lets
// .env.test win.
const testDir = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: join(testDir, "../.env.test") }); // test DB override — see .env.test's own comment
loadDotenv({ path: join(testDir, "../.env") }); // everything else; never overwrites what .env.test already set
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";

// Hard guardrail, independent of the loading order above: whatever value
// DATABASE_URL ends up with — from .env.test, a CI workflow's own env
// block, or a future config change nobody thought to check against this
// file — the database name itself must contain "test". This is what
// actually prevents test/integration/*.test.ts (which creates and deletes
// real companies) from ever writing into a shared demo/prod database again,
// regardless of *why* the env ended up misconfigured. Loud and immediate:
// better a hard-failed test run than a silent company leak.
const databaseName = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, "");
if (!databaseName.includes("test")) {
  throw new Error(
    `Refusing to run tests against database "${databaseName}" — its name doesn't contain "test". ` +
      "Integration tests create and delete real companies; running them against a shared demo/prod " +
      "database is exactly how it ended up full of leftover test companies before. Point DATABASE_URL " +
      "(in .env.test) at a dedicated test database instead — see .env.test's own comment."
  );
}
