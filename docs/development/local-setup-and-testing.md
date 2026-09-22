# Local setup and testing

This is the guide for working on AccuQual on a development machine — which
`.env` file is which, how to run the app, and how to run the tests. For
deploying to Render/Supabase, see `DEPLOY.md`. For rotating a credential
that's already in use, see `docs/operations/credential-rotation.md`.

## The three `.env` files — the gotcha that costs the most time

There are three separate `.env` files, and it is easy to run a script
against the wrong database without any error telling you so.

| File | Read by | Points at |
|---|---|---|
| `.env` (repo root) | `docker compose` (all containers: api, web, workers) | **Supabase** — the real cloud database this app actually runs against, even in local dev |
| `services/api/.env` | Any script run directly with `npx tsx ...` or `npm run ...` **from inside `services/api`** (dotenv loads the nearest `.env` to the working directory) | **Local Docker Postgres**, `localhost:5433/accuqual` |
| `apps/web/.env` | Vite dev server / build | `VITE_API_BASE_URL=http://localhost:3000` — just where the frontend calls the API |

The trap: `cd services/api && npx tsx src/db/someScript.ts` silently uses
the **local** database, not Supabase, because `dotenv/config` loads
whichever `.env` is nearest. If you meant to run something against
Supabase (the database the running containers actually use), you have to
override it explicitly:

```bash
# from the repo root
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
cd services/api && npx tsx some-script.mts
```

**Always print the masked host before running anything that writes** —
`echo $DATABASE_URL | sed -E 's#://[^@]*@#://***@#'` — and confirm it says
`aws-0-us-east-1.pooler.supabase.com` (Supabase) or `localhost:5433`
(local), whichever you meant.

## Running the app

```bash
docker compose up -d          # postgres, redis, api, web, and all 3 workers
docker compose ps             # everything should show "Up"
```

- Web: http://localhost:5183
- API: http://localhost:3000 (health check: `/health`)
- The containers use the **root** `.env`, i.e. Supabase — there is no
  "fully offline" local mode. See the note at the end of this file.

To rebuild after a code change:

```bash
docker compose build api web
docker compose up -d api web
```

Docker Desktop does not restart itself after the machine sleeps or
reboots — `docker compose ps` failing with a pipe/socket error means
Docker Desktop itself isn't running, not that something is broken in the
app. Start it (on this machine:
`C:\Users\<you>\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe`),
wait for `docker info` to succeed, then `docker compose up -d` again.

## Running the tests

The test suite runs against a **local** Postgres, never Supabase — it's
destructive (it creates and tears down real rows) and needs to be fast
and disposable.

```bash
cd services/api
DATABASE_URL="postgres://<user>:<pass>@localhost:5433/accuqual_test" npm test
```

The `accuqual_test` database lives in the same `postgres` container as the
dev database (`docker-compose.yml`, port 5433) — create it once with
`createdb` (or `psql -c "CREATE DATABASE accuqual_test"`) if it doesn't
exist yet, then run `db:migrate` and the post-migrate SQL against it the
same way you would against any fresh database.

Run everything three times before calling a change done — a flaky
integration test (usually a teardown ordering issue, not a real bug) is
easier to catch that way than from a single green run.

## The drizzle-kit / drizzle-orm workaround

`npm run db:generate` (drizzle-kit) resolves `drizzle-orm` by walking up
from the workspace root, not from `services/api`'s own
`node_modules` — in this monorepo layout that lookup fails ("install the
latest drizzle-orm") even though it's already installed. The workaround:

```bash
# from the repo root
cp -r services/api/node_modules/drizzle-orm node_modules/drizzle-orm
npm run db:generate --workspace services/api
rm -rf node_modules/drizzle-orm
```

Do this every time you add or change a schema file and need a new
migration. Delete the copy afterward — leaving it in place can shadow the
real dependency resolution for other tools.

## Ports at a glance

| Thing | Port |
|---|---|
| Web (dev and containerized) | 5183 (not Vite's default 5173 — see `apps/web/vite.config.ts`) |
| API | 3000 |
| Local Postgres (dev + test databases) | 5433 (not Postgres's default 5432 — avoids clashing with a native install) |
| Redis | 6379 |

## Why there's no fully-offline mode

The containers all read the root `.env`, and `DATABASE_URL` there points
at Supabase — a cloud database. Even running everything locally in
Docker, the app is only as available as your internet connection. A
Postgres container does run locally (port 5433), but it holds the
disposable test database, not a mirror of the real data, so it isn't a
drop-in offline fallback without deliberately setting one up.
