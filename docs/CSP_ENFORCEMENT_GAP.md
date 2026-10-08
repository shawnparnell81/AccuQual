# CSP enforcement gap (AQ-L03)

Leave the header as `Content-Security-Policy-Report-Only`. Do not switch it to `Content-Security-Policy` until the blockers below are removed. The header is set on the Render static site in `render.yaml` (`accuqual-web`, path `/*`).

## Policy today

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self';
form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';
worker-src 'self' blob:; frame-src 'self' blob:; manifest-src 'self'
```

The header name is `Content-Security-Policy-Report-Only`. A violating load is reported by the browser and still runs. There is no `report-uri` or `Reporting-Endpoints` entry, so those reports stay in the browser console. They are not collected on the server.

`services/api` `helmet()` is the API response, not the app shell. Stored-file downloads set `Content-Security-Policy: sandbox` on that file response only.

## What report-only already describes

| Directive | Intended limit |
| --- | --- |
| `script-src 'self'` | No inline scripts and no third-party script hosts |
| `style-src 'self' 'unsafe-inline'` | Stylesheets from this origin, plus inline styles |
| `font-src 'self' data:` | No Google Fonts (or any other font host) |
| `connect-src 'self'` | XHR/fetch only to this origin (the `/api` rewrite is same-origin) |
| `frame-src 'self' blob:` | No third-party editor frame |
| `object-src 'none'` | No plugins |
| `frame-ancestors 'self'` | Only this origin may frame the page (matches `X-Frame-Options: SAMEORIGIN`). Print preview loads the page in a same-origin frame; `DENY` / `'none'` makes that frame fail while the live page can still print. |

## What enforcement would break

These are present on `main` and would fail the policy above.

1. **Inline scripts in `apps/web/index.html`.** Two blocking scripts run before React: the marketing-host redirect (`accuqualqms.com` / `www` → `/welcome` or the app host) and the theme paint (`accuqual-theme-mode`, color scheme, CSS variables). `script-src 'self'` has no `'unsafe-inline'` and no hash. Enforcing CSP drops both. The first paint can flash the wrong theme, and the marketing host can boot the signed-in app instead of the landing page.

2. **Google Fonts on `/welcome`.** `apps/web/public/welcome/index.html` loads `https://fonts.googleapis.com` (stylesheet) and the font files that stylesheet requests (typically `fonts.gstatic.com`). `style-src` and `font-src` are same-origin only. The marketing page would render with fallback fonts. The page also uses inline `style` attributes; those are already allowed by `'unsafe-inline'`.

3. **ONLYOFFICE.** When in-app Word/Excel editing is on, the browser loads the document server script and frames the editor from `ONLYOFFICE_URL`, which is not this origin. `script-src 'self'` and `frame-src 'self' blob:` block that. Editing Office files in the app would fail. Same-origin PDF/blob previews would still work.

4. **Sentry in the browser.** `apps/web/src/lib/errorTracking.ts` loads `@sentry/react` and sends events to the DSN host when `VITE_SENTRY_DSN` is set. `connect-src 'self'` blocks that host. Error reporting from the browser would stop. The API's server-side Sentry client is not covered by this static-site header.

5. **No collected reports.** Turning on enforce without a report sink does not tell us about a new violation after deploy. A report endpoint (or `report-to`) should exist before enforce, and a deploy should be watched against it.

Same-origin `/api/*` rewrites to `https://api.accuqualqms.com` are browser requests to the static site's own origin, so `connect-src 'self'` does not block them.

## Left as they are

- The header stays `Content-Security-Policy-Report-Only`. `frame-ancestors` is `'self'` so a same-origin print preview can frame the page. The policy is not enforced.
- The two inline scripts in `index.html` are still inline. Moving them needs a retest of the marketing redirect and the theme paint on both hosts.
- Welcome-page fonts still load from Google.
- ONLYOFFICE and Sentry hosts are not in the policy. Adding them before the inline scripts are external would widen the policy and would still not make enforce safe.
- This document does not change gage or training behavior.

## Before enforce is safe

1. Replace the two `index.html` inline scripts with external scripts (or hash-source them) and confirm theme paint plus the marketing-host redirect.
2. Self-host the welcome fonts, or explicitly allow `fonts.googleapis.com` and `fonts.gstatic.com`.
3. Allow the configured ONLYOFFICE origin on `script-src` and `frame-src` only when that feature is on, and confirm an Office file still opens.
4. Allow the Sentry ingest host on `connect-src` when `VITE_SENTRY_DSN` is set, and confirm a browser exception is delivered.
5. Add a report endpoint and review a report-only deploy before renaming the header to `Content-Security-Policy`.
