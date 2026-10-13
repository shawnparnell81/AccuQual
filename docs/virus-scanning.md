# Virus scanning of uploads

Every file a person uploads to AccuQual is scanned by ClamAV before it is stored or a record is created.

- **Infected file:** refused with "This file was blocked because it contains a virus: <name>." Nothing is stored.
- **Scanner unavailable or failing:** refused with "Virus scanning is unavailable right now, please try again shortly." (it fails closed).
- Each blocked file is audit-logged (who, what, when, where), visible to an Owner or Administrator in the Audit log.
- Admin → System Health shows "Virus scanning": on or off, whether clamd is up, and the date of the virus definitions.

## How it runs

The API image (`services/api/Dockerfile`) installs ClamAV. `services/api/docker/entrypoint.sh`:

1. runs `freshclam` once, so a restart never begins on old definitions;
2. runs `freshclam` as a daemon, checking 4 times a day (every 6 hours);
3. starts `clamd` on `127.0.0.1:3310`;
4. waits (up to 240 seconds, `CLAMAV_WAIT_SECONDS`) until clamd answers PING, then starts the API.

`freshclam` and `clamd` each run in a loop, so one that exits is started again. While clamd is down the API refuses uploads and
says to try again shortly. A baseline set of definitions is baked into the image at build time so the first start is quick.

The API talks to clamd with the INSTREAM protocol (`services/api/src/lib/virusScan.ts`). `scanUploads` (in
`modules/upload-scan/uploadScan.ts`) is the middleware every upload route uses, right after the multer step. Uploads that do not come
through a route (a document saved back from the Word/Excel editor, and the pictures taken out of a Monthly Quality Report Word
file) call `assertUploadClean` directly.

## Settings

| Variable | Meaning |
| --- | --- |
| `VIRUS_SCAN_ENABLED` | `true` / `false`. Unset means on in production and off in development and tests. |
| `CLAMD_HOST`, `CLAMD_PORT` | Where clamd listens. Default `127.0.0.1:3310`. |
| `CLAMD_SOCKET` | A unix socket path, instead of host and port. |
| `CLAMAV_DB_DIR` | Where definitions are kept. Default `/var/lib/clamav` (inside the container; the baked baseline is the starting point after every deploy). Set it to a folder on a persistent disk to keep updates across deploys. |
| `CLAMAV_WAIT_SECONDS` | How long the container waits for clamd before starting the API anyway. Default 240. |

## Render

- clamd holds the virus signatures in memory (about 1.1 GB). The `starter` plan (512 MB) is too small: the API service needs the
  `standard` plan (2 GB) or larger.
- No disk change is needed. The definitions live inside the container (about 300 MB) and are refreshed on every start.
- No build command change. The image build downloads the baseline definitions and needs outbound network access, which Render builds have.
- The container takes up to a minute or two longer to become healthy after a deploy, because the API starts once clamd is ready.

## Testing

- `test/virus-scan-unit.test.ts` runs the client against a fake clamd (`test/helpers/fakeClamd.ts`) that speaks the same protocol and flags the EICAR test string.
- `test/virus-scan-uploads.test.ts` posts the EICAR string to every upload route.
- `test/integration/virus-scan-clamav.test.ts` runs against a real ClamAV and is skipped when none is reachable:
  `docker run -d -p 3310:3310 clamav/clamav`, then `CLAMD_PORT=3310 npx vitest run test/integration/virus-scan-clamav.test.ts`.
