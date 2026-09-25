# In-app Office editing

Controlled-document Word (`.docx`) and Excel (`.xlsx`) files can be opened in the browser through a self-hosted [ONLYOFFICE Document Server](https://github.com/ONLYOFFICE/DocumentServer). The editor is optional. With the settings below unset, AccuQual runs exactly as before and the Open-in-editor action reports that editing is not configured.

Published revisions stay frozen. A person who can view the document gets a read-only editor. A person who can edit it, and only while the revision is still a draft, gets an editor that can save. Saving a draft that still shares its file with another revision copies the file onto the draft first, so the other revision's bytes do not change.

## Access check

One helper, `services/api/src/modules/onlyoffice/access.ts`, decides every open and every save. It calls the existing document permission check (`document.view` and `document.edit`) and the same attachment rule as the signed download link: the file has to be on that revision, and the path has to sit in document storage. The editor, the file fetch, and the save callback do not repeat that decision.

There is no new table and no new column. Edited bytes stay on the existing document-file row. Company scoping is confined to that helper so it can be simplified when tenancy is removed.

## License

Use the Community Edition image (`onlyoffice/documentserver`). For a single self-hosted company deployment, the Community Edition (20 simultaneous connections) may be sufficient. A connection is one open editor, not one user account. More than 20 editors open at the same time needs a commercial ONLYOFFICE license on that same server.

## Run the document server

From the repo root, with `ONLYOFFICE_JWT_SECRET` set to a long random value:

```bash
docker compose -f docker-compose.yml -f docker-compose.onlyoffice.yml up -d onlyoffice
```

Then point the API at it:

```bash
ONLYOFFICE_URL=http://localhost:8080
ONLYOFFICE_JWT_SECRET=the-same-secret-as-the-document-server
ONLYOFFICE_INTERNAL_URL=http://onlyoffice
ONLYOFFICE_API_BASE_URL=http://api:3000
```

| Variable | Who uses it |
| --- | --- |
| `ONLYOFFICE_URL` | The browser, to load the editor script. |
| `ONLYOFFICE_JWT_SECRET` | Shared HMAC secret. Must equal the document server's `JWT_SECRET`. |
| `ONLYOFFICE_INTERNAL_URL` | This API, when it downloads a file the document server just saved. Defaults to `ONLYOFFICE_URL`. |
| `ONLYOFFICE_API_BASE_URL` | The document server, when it downloads the original file and posts the save callback. In Compose that is `http://api:3000`. |

`ONLYOFFICE_URL` has to be reachable from the user's browser. `ONLYOFFICE_API_BASE_URL` has to be reachable from the document server, and `ONLYOFFICE_INTERNAL_URL` from the API. On a single machine running the API directly (not in Compose), `http://localhost:8080` for the document server and `http://localhost:3000` for the API are enough, and the internal URL can be left blank.

The compose file uses `ONLYOFFICE_JWT_SECRET` from the environment. If that variable is unset it falls back to `dev-onlyoffice-secret` so the container can start; the API does not use that fallback and leaves the editor off until the secret is set on both sides.

The document server must be allowed to call a private address (`ALLOW_PRIVATE_IP_ADDRESS` in `docker-compose.onlyoffice.yml`). Otherwise it refuses to fetch the file from the API container.

## What the browser and the document server exchange

1. The browser asks `GET /onlyoffice/session` with a normal AccuQual session.
2. The API returns a DocsAPI config whose file URL and callback URL are short-lived HS256 links.
3. The document server downloads the file from `GET /onlyoffice/file`.
4. On save it `POST`s `/onlyoffice/callback` with its own signed body. The API accepts the saved bytes only from `ONLYOFFICE_URL` or `ONLYOFFICE_INTERNAL_URL`, checks the draft permission again, and rejects a file that is not valid `.docx` or `.xlsx` or is over 15 MB.

The callback link is not a user session. The signature is the credential, same as the existing short-lived document download link.

## Limits

- `.docx` and `.xlsx` only. PDF and images stay download-only.
- 15 MB, the same cap as other controlled-document files.
- The document server has to be one you run. AccuQual does not send files to ONLYOFFICE's cloud.
- Community Edition allows 20 simultaneous connections. See the license note above.
