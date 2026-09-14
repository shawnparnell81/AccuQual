// Loaded before every test file (see vitest.config.ts). Some pure-logic
// modules (e.g. utils/crudFactory.ts) transitively import config/env.ts for
// unrelated reasons (it's on the import path to something they do need),
// and that module validates the full env schema at import time — so unit
// tests need *some* value for every required var, even ones the test itself
// never touches.
//
// Real .env values are loaded first (dotenv never overwrites an already-set
// process.env key) so test/integration/*.test.ts — which DOES connect to a
// real, migrated Postgres, deliberately, see its own header comment — picks
// up the same DATABASE_URL `npm run dev`/`db:migrate` already use in local
// dev. In CI there is no .env file (this import is then a no-op) and the
// workflow's own `env:` block has already set real values directly; in any
// environment with neither, the fallback below still keeps the pure-logic
// unit tests running without a real DB.
import "dotenv/config";
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";
