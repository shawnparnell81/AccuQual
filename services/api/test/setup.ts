// Loaded before every test file (see vitest.config.ts). Some pure-logic
// modules (e.g. utils/crudFactory.ts) transitively import config/env.ts for
// unrelated reasons (it's on the import path to something they do need),
// and that module validates the full env schema at import time — so unit
// tests need *some* value for every required var, even ones the test itself
// never touches. Real values are never read from here; nothing in this repo
// connects to a real Postgres/Redis during `vitest run`.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";
