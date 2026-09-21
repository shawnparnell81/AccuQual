# Testing readiness (as of 2026-09-21)

What is deployed, what a tester can and cannot exercise, and the known limits. No secrets here; see `backup-and-restore.md` for the backup runbook.

## What is running

- Local Docker stack (api on :3000, web on :5183) against the Supabase database, built from `main` at `5a2935f`.
- Supabase is at migration 0064 (65 applied). Includes equipment & calibration, quarantine, training & competency, document versioning.
- The CSRF guard (PR #78) is active: a state-changing request carried only by the refresh cookie must send `X-AccuQual-Csrf`; the web client sends it on every call.
- Verified on the running stack: login sets the refresh cookie, refresh works with the header and is refused (403) without it, login with a stale cookie present still works.
- Nothing auto-deploys. Changes reach the running stack only by `git pull`, `docker compose build api web`, `docker compose up -d api web` (plus `npm run db:migrate` when a migration is added).
- **Running scripts against Supabase:** scripts run from `services/api` read `services/api/.env`, which is the LOCAL dev database. The containers and Supabase use the ROOT `.env`. Export `DATABASE_URL` from the root `.env` first and check the host before migrating.

## Starting state

- The test quarantine hold "deploy-check widget" was released (record kept as history; quarantine resolutions are append-only).
- Two disabled test users remain: `deploy-check-0921@test.local`, `deploy-check-0921b@test.local`. They cannot sign in; their audit entries are permanent.
- Demo tenant `demo` also holds the Phase 11 demo seed data.

## What testing covers, and what to expect

- The UI for equipment & calibration, quarantine, training & competency, and document versioning has been verified through the API and automated tests (927 backend tests) but not clicked through in a browser. Expect layout and wording issues rather than logic bugs.

## Not testable yet

- Worker Runtime (not built).
- Self-service signup (blocked on billing-tier decisions).
- SSO with a real identity provider (never tried).
- "Similar past NCRs" (needs an embeddings key).
- Sentry, alert webhooks, uptime monitoring (need accounts; an outage is otherwise silent).
- Email is sent through ZeptoMail.

## Known limits

- By default only the Quality department has edit rights on training and calibration.
- Held stock does not trigger below-minimum alerts.
- Training has no prerequisites.
- The uploads folder is not in the nightly backup; it now holds document files.

## Safety net

- Nightly encrypted backup to Cloudflare R2; last run succeeded 2026-09-21 14:22 UTC. Take a manual backup before destructive testing.
- Pending: store the backup passphrase (password manager + offline copy), create the Healthchecks URL for `BACKUP_HEARTBEAT_URL`, decide keep-vs-switch passphrase.
