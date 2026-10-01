# AccuQual QMS audit — 1 October 2026

**Product:** AccuQual for DMA Industries (Shawn Parnell)  
**Scope:** Security, forms, quarantine, NCR / CAPA / 8D, Document Control, signatures, audit trail, suppliers, calibration, training, admin, deploy  
**Code reviewed:** `main` at `a34c535` (same build the live API reported)  
**Live checks (read-only):** `GET https://api.accuqualqms.com/health` returned 200. `https://app.accuqualqms.com/` returned 200. No sign-in. No production data was changed.

This is a product and control audit, not a certification. “No critical finding” means no confirmed path that lets an outsider in, wipes records, or forges a signature from the code and the public endpoints checked here.

---

## 1. Executive summary

The app is demo-ready for a **short, scripted walkthrough** on a phone: sign in, open **Blank Forms**, start **FRM NCR**, show the sheet, show **CAPA** and **8D** as separate modules, and show **Folder Explorer** as folders plus saved forms. Do not wander.

Three things will embarrass a higher-up demo if someone clicks around:

1. **FRM NCR and Quarantine Notice can crash** after the list page loads. The sidebar opens the list, and opening or creating a record then reads a shared cache in the wrong shape. This is already being fixed elsewhere. It is still in this build.
2. **A filled FRM NCR does not file into Documents.** The list page says a filled copy can be saved into any folder. Save on that form only stores the row. Folder Explorer will not show it.
3. **That same form has no on-record audit history.** NCR, CAPA, 8D, suppliers, calibration, and controlled documents do. The spreadsheet NCR does not.

Security basics are in good shape for a single-company cloud system: hashed passwords, lockout, httpOnly refresh cookie, CSRF header, short-lived access tokens, PIN checked on the server, signature fields that a normal save cannot overwrite, and an append-only audit design. Two controls are written down and not actually applied on the request path: the database role switch that is supposed to make audit rows immutable, and supplier status on purchase orders.

**Verdict for the phone:** show the happy path above. Stay off Home’s NCR counters, the command palette “New NCR”, Workflow Builder automation, and any claim that a filled FRM NCR already lives in Folder Explorer or has a per-record history panel.

---

## 2. Findings

Ordered **Low → Medium → High → Critical**.

### Low

#### AQ-L01 — Public health reports build and dependency state

| | |
|---|---|
| **Severity** | Low |
| **Area** | Ops / Security |
| **Evidence** | Live `GET /health` on 1 Oct 2026: `version` `a34c535`, database latency, `redis.status` `not configured`. `services/api/src/app.ts` serves that report with no login. `services/api/src/modules/monitoring/healthMonitor.ts` puts the driver error string in `database.detail` when Postgres is down. |
| **Impact** | Anyone can see which commit is live and whether Redis or the database is unhappy. A database failure can add a driver message (host or auth hints) to that public JSON. |
| **Fix** | Keep a tiny public `/health/live` for the load balancer. Move version, latency, and error text to an admin-only health page. Public failure text should stay “Unreachable”. |

#### AQ-L02 — Live NCR is off the sidebar and still one tap away

| | |
|---|---|
| **Severity** | Low |
| **Area** | Functionality |
| **Evidence** | Sidebar is correct: `apps/web/src/components/layout/sidebarStructure.ts` (FRM NCR → `/iso-forms/frm-ncr-001`; comment that `/ncr` is not a sidebar item). Tests lock that in `apps/web/src/lib/qualityDocumentFolders.test.ts`. Residual links: Home cards in `apps/web/src/components/dashboard/NcrCapaDashboard.tsx` (`to="/ncr"`), command palette “New NCR” in `apps/web/src/components/layout/CommandPalette.tsx`, `/quality` and `/complaints` redirects in `apps/web/src/App.tsx`, quarantine rows linking to `/ncr/:id` in `apps/web/src/routes/Quarantine/QuarantinePage.tsx`. |
| **Impact** | A demo that starts on Home, or a quarantine row, opens the live NCR module that the sidebar was changed to hide. |
| **Fix** | Point those counters and the command action at FRM NCR or at CAPA. Leave `/ncr` for people who already have a link, until that module is retired on purpose. |

#### AQ-L03 — Web content security policy is report-only

| | |
|---|---|
| **Severity** | Low |
| **Area** | Ops |
| **Evidence** | Live response header `content-security-policy-report-only` on `https://app.accuqualqms.com/`. Same header in `render.yaml` (web service headers). API responses use Helmet’s enforced policy (`services/api/src/app.ts`). Clickjacking is already blocked by `X-Frame-Options: DENY` on the web app (confirmed live). |
| **Impact** | A script injection in the web app would not be stopped by CSP yet. Framing the app is already refused. |
| **Fix** | After a quiet report-only period, enforce the same policy. The browser calls the API through the same-origin `/api` rewrite, so `connect-src 'self'` matches the current deploy. |

#### AQ-L04 — CodeQL job always succeeds and scans nothing

| | |
|---|---|
| **Severity** | Low |
| **Area** | Ops |
| **Evidence** | `.github/workflows/security.yml`: CodeQL steps are `if: false` and the job exits 0. |
| **Impact** | The security workflow looks green without static analysis. Dependency audit and gitleaks in that same file do run. |
| **Fix** | Turn on GitHub code scanning, or drop the stub job so the check name is honest. |

#### AQ-L05 — SSO can auto-provision an Owner

| | |
|---|---|
| **Severity** | Low |
| **Area** | Security / Admin |
| **Evidence** | `services/api/src/modules/sso/sso.service.ts`: `SSO_FORBIDDEN_ROLES` contains `admin` and does not contain `owner`. Domain verification is still required before SSO is enabled. |
| **Impact** | A bad default role on a verified domain could create Owner accounts for IdP users. It does not happen by itself. |
| **Fix** | Refuse `owner` the same way `admin` is refused. |

---

### Medium

#### AQ-M01 — Audit immutability is documented and not applied on API requests

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Security |
| **Evidence** | `services/api/src/drizzle/post-migrate/rls-policies.sql` says each request runs `SET LOCAL ROLE accuqual_app`. `services/api/src/lib/requestDb.ts` `withDb` runs `BEGIN` and `set_config('app.current_user_id', …)` only. `audit-triggers.sql` revokes `UPDATE` / `DELETE` on `audit_trail` from `accuqual_app`. No HTTP route deletes audit rows. |
| **Impact** | If `DATABASE_URL` is the table owner (the usual hosted setup), application SQL can still change or delete audit rows. The revoke never applies to that session. A bug or injection would not be stopped by the role design. |
| **Fix** | `SET LOCAL ROLE accuqual_app` at the start of `withDb`, and keep the owner connection only for the few tables that role is not allowed to touch. Add a test that an app transaction cannot `UPDATE audit_trail`. |

#### AQ-M02 — Older password-reset links stay valid

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Security |
| **Evidence** | `services/api/src/modules/auth/auth.service.ts` `forgotPassword` inserts a new hashed token and does not revoke older unused rows. `resetPassword` marks only the token that was used. Tokens expire in 30 minutes. The response does not reveal whether the email exists. |
| **Impact** | A reset link from a few minutes earlier still works after a newer request. Useful if a link lands in a log or a shared inbox. |
| **Fix** | On a new reset request, expire every unused token for that user. |

#### AQ-M03 — Database TLS is not verified unless a CA is configured

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Ops / Security |
| **Evidence** | `services/api/src/db/index.ts`: without `DATABASE_SSL_CA`, non-local Postgres uses `rejectUnauthorized: false`. `services/api/src/config/env.ts` warns at boot and still starts. `render.yaml` sets `DATABASE_URL` and does not set `DATABASE_SSL_CA`. This audit did not read the live Render env, so this is a blueprint and code gap, not a confirmed live certificate. |
| **Impact** | A network position between the API and Postgres can present any certificate and read the database connection. |
| **Fix** | Set `DATABASE_SSL_CA` from the provider CA on the API service. After it is in place, refuse to boot in production when it is missing. |

#### AQ-M04 — Retire does not lock a controlled document

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Docs |
| **Evidence** | `obsoleteHandler` in `services/api/src/modules/documents/documents.controller.ts` sets `status` to `obsolete` and leaves the category alone. `isInObsoleteArchive` in `obsoleteArchive.ts` is read-only only when status is `obsolete` **and** category is `obsolete-archive`. `move-to-obsolete` sets both. The detail page exposes both actions (`apps/web/src/routes/Documents/DocumentDetailPage.tsx`). |
| **Impact** | “Retire” looks final. The file can still be edited until someone also moves it to Obsolete / Archive. |
| **Fix** | Make retire do the same lock as move-to-archive, or rename the button so it is obvious the file is still editable. |

#### AQ-M05 — Any signed-in user can post IoT readings

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Security |
| **Evidence** | `POST /digital-twin/iot-ingest` in `services/api/src/modules/digital-twin/digital-twin.routes.ts` is behind `requireAuth` only. `ingestIot` upserts `iotDevices` and stores the payload. The PLC path is the separate device-key route. |
| **Impact** | Any account can invent devices and readings. Drift and digital-twin history can be polluted. This is outside the forms demo. |
| **Fix** | Remove this route or require the same device key as device ingest. Admin-only is a weaker substitute. |

#### AQ-M06 — Company login history is not a record an admin can open

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Admin |
| **Evidence** | Password and MFA login in `completeLogin` (`services/api/src/modules/auth/auth.service.ts`) update `users.lastLoginAt` and do not write an audit row. SSO writes `sso_login` on the User entity. Account-history reads are limited to Owner or Administrator (`auditTrailVisibility.ts`). The user list does not return `lastLoginAt` (`users.controller.ts`). There is no admin login-history screen. |
| **Impact** | The rule “login history is admin-only” is true for the rows that exist. Successful password sign-ins are not rows, so an admin cannot show who signed in, from where, or when. |
| **Fix** | Append an audit row on every successful login and logout (who, when, method; store a hash of IP / user agent if you keep the address). Show it only on Admin. Keep the current block that hides other people’s account rows from everyone else. |

#### AQ-M07 — Overdue gages and untrained readers are not stopped at the point of use

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Functionality |
| **Evidence** | Calibration: a failed calibration sets equipment `out_of_service` (`calibration.service.ts`). Overdue equipment is listed and emailed to Quality (`attention`, digest). No inspection, form, or traveler route checks due status. Training: qualification is computed in the training module. `services/api/src/modules/documents` has no training or qualification check. |
| **Impact** | ISO 7.1.5 and 7.2 are tracked, not enforced. A person can record a result with an overdue gage, and can open a controlled document they are not qualified for, if document permissions allow it. |
| **Fix** | Block use of `overdue`, `failed`, `uncalibrated`, and `out_of_service` equipment unless a reviewer records an override reason. Optionally block download of a document that has a required course until the person is qualified on the current revision. |

#### AQ-M08 — Development seed has no production guard and prints a known password

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Ops |
| **Evidence** | `services/api/src/db/seed.ts` creates `admin@accuqual.local` / `ChangeMe123!` when the company table is empty, and always logs that password. No `NODE_ENV` check. Production setup is documented as `db:create-company`, which prints a one-time password to the shell and does not log it the same way. |
| **Impact** | Running seed against the live database on an empty company table creates a known admin. Running it against the existing company still writes the password into logs. |
| **Fix** | Refuse seed when `NODE_ENV` is production. Stop logging the password. |

#### AQ-M09 — Redis is off, and background work fails open

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Ops |
| **Evidence** | Live health: `redis.status` = `not configured`. `render.yaml` leaves `REDIS_URL` unset and `MONITOR_EXPECTED_WORKERS` empty. `publishEvent` in `services/api/src/lib/eventBus.ts` returns without error when Redis is absent (one warning). Rate limits use an in-memory store (`rateLimit.ts`), which matches a single API instance. Sessions are Postgres refresh tokens, not Redis. |
| **Impact** | Workflow runs, async jobs, and digital-twin workers do not run. The API still returns success to the caller. A demo of Workflow Builder will look like it saved and then nothing will happen. |
| **Fix** | Say so on the workflow screen and on admin health: “Background jobs are off on this deploy.” Turn Redis and workers on only when that sentence should go away. |

---

### High

#### AQ-H01 — `form-templates` cache shape still crashes ISO forms

| | |
|---|---|
| **Severity** | High |
| **Area** | Forms |
| **Evidence** | One React Query key, `["form-templates"]`, stores different shapes. `IsoFormListPage.tsx` and `ValidationReportsPanel.tsx` store the API object `{ fileNamePattern, templates }`. `BlankFormsPage.tsx`, `IsoFormDetailPage.tsx`, and others store `response.data.templates` (an array). Detail page line that calls `.find` on that cache: `templates.data?.find(...)`. For `ncr_report`, `quarantine_notice`, and `concession`, `formKey` is null so the query is disabled, but a disabled query still returns the cached value. Sidebar FRM NCR opens the list (cache becomes the object). Creating or opening a record then calls `.find` on that object. `ValidationReportsPanel.tsx` calls `filing.data?.templates.find` with no guard on `.find`. `BlankFormsPage.tsx` iterates `templates.data` with `for…of`. |
| **Impact** | The path a higher-up will take — sidebar **FRM NCR**, then open or create — throws. Quarantine Notice uses the same list and detail pages. Blank Forms throws if it is opened after the list. This matches the bug already in progress. **Do not treat this report as that fix.** |
| **Fix** | One `queryFn` for `["form-templates"]` that always returns `{ fileNamePattern, templates }`. Every screen reads `.templates`. Invalidate after form-number edits, which `FormDocumentControls.tsx` already does. |

#### AQ-H02 — Filled FRM NCR, Quarantine Notice, and Concession do not enter Documents

| | |
|---|---|
| **Severity** | High |
| **Area** | Forms / Docs |
| **Evidence** | `FILEABLE_FORM_KEYS` and `ISO_TYPE_TO_FORM_KEY` in `services/api/src/modules/document-folders/editableForms.ts` omit `frm-ncr-001`, `frm-ncr-002`, and `frm-ncr-003` (`ncr_report`, `quarantine_notice`, `concession`). The web map `FORM_KEY_BY_TYPE` in `apps/web/src/lib/formDocument.ts` omits the same types. `IsoFormDetailPage.tsx` sets `formKey` from that map, shows `RecordFolderField` only when `formKey` is set, and on save returns early with “saved” when `formKey` is missing (`fileChosenFolder` is not called). The list subtitle in `IsoFormListPage.tsx` still says “A filled copy can be saved into any Documents folder” for every ISO list, including FRM NCR. The same maps also omit competency training, cross-training, and the internal audit sheet. |
| **Impact** | Blank → fill → save works as a database row. It does not become a saved form in Folder Explorer. The sentence on the list page describes a path the NCR family does not have. Folder Explorer itself is doing the right job for forms that are fileable (`folderBrowse.ts` hides blank drawers). |
| **Fix** | Add the three NCR keys to the fileable set and both maps, snapshot the form number on create the way the other ISO forms do, and show the folder field on the detail page. Change the list sentence for any type that still cannot be filed. |

#### AQ-H03 — Spreadsheet ISO forms have no per-record audit a reviewer can open

| | |
|---|---|
| **Severity** | High |
| **Area** | Forms / Admin |
| **Evidence** | Creates, updates, and deletes of ISO forms call `recordAuditTrail` with `entityType: "ISO form"` (`crudFactory.ts`, `iso-quality-forms.controller.ts`). `"ISO form"` is not in `ENTITY_TYPE_TO_RESOURCE` (`auditTrailVisibility.ts`). A non-admin history read throws `Unknown record type "ISO form"`. Company audit rows for unmapped types are hidden from anyone who is not Owner or Administrator (`visibleEntityTypes`). `MODULE_ENTITY_TYPES` in `workflow.controller.ts` has no ISO form module. `IsoFormDetailPage.tsx` does not render `WorkflowHistoryPanel`. `iso_quality_forms` is not in the trigger list in `audit-triggers.sql` (nearby tables `validation_reports` and `qms_forms` are). `form_data` autosave (`forms.service.ts` `saveData`) writes cells with no audit call and no trigger. |
| **Impact** | NCR, CAPA, 8D, documents, suppliers, and calibration show who / what / when on the record. FRM NCR does not. A quality manager does not see those rows in the company log either. Admins may see a raw “update” whose body is the whole sheet, not a cell-level description. Worksheet autosave on other form types can change answers with no trail. |
| **Fix** | Register `"ISO form"` (resource: documents or a dedicated key). Add `iso_quality_forms` to the audit trigger list. Put the same history panel used on CAPA onto the ISO detail page. For `form_data`, audit on save for controlled types, or add the trigger and accept the volume. |

#### AQ-H04 — Quarantine on the sidebar depends on the NCR module the sidebar hid

| | |
|---|---|
| **Severity** | High |
| **Area** | Quarantine |
| **Evidence** | Sidebar item “Quarantined items” → `/quarantine` (`sidebarStructure.ts`). `QuarantinePage.tsx` lists `/quarantine/items` and the empty state says “Add them from an NCR.” Rows link to `/ncr/:id`, not to `/quarantine/:id`. `CreateHoldModal` in `QuarantineModals.tsx` posts `POST /quarantine` and is not imported anywhere else. `QuarantineDetailPage.tsx` (release, move, history) exists and is not linked from the list. FRM-NCR-002 is a separate spreadsheet (`isoFormCatalog.ts`) with no write into `quarantine_records`. |
| **Impact** | Two different “quarantine” things. The sidebar list only fills up from the live NCR module. The notice sheet does not create a hold. The hold screen that can release or destroy is not how the list behaves. A demo of quarantine from the sidebar shows an empty table and points at a module that is no longer on the menu. |
| **Fix** | Pick one story before the demo. Short term: empty-state text should name the real entry (live NCR, or “not from the FRM sheet”). Longer term: filing a Quarantine Notice should create the hold, and the list should open the hold, not only the NCR. |

#### AQ-H05 — Purchase orders do not check supplier approval

| | |
|---|---|
| **Severity** | High |
| **Area** | Functionality |
| **Evidence** | `createPurchaseOrder` and `sendPurchaseOrder` in `services/api/src/modules/erp/erp.service.ts` require a supplier id and, on send, at least one line. They do not read `suppliers.status`. New suppliers default to `active` (`services/api/src/drizzle/schema/supplier.ts`). Approve / suspend / disqualify are real, audited actions on the supplier controller and do not gate purchasing or receiving. |
| **Impact** | A disqualified, suspended, or probation supplier can still be sent a PO and received against. That is an ISO 9001 clause 8.4 gap if this purchasing screen is in use. It does not affect the forms demo. |
| **Fix** | One server check used by PO create, PO send, requisition conversion, and receiving: block `disqualified` and `suspended` (and `probation`, if that is the company rule). Return the supplier status in the error so the buyer sees why. |

---

### Critical

No critical finding.

Checked and not found: unauthenticated access to records, a signature that can be typed in through a normal save, a default admin that this deploy creates by itself, or a public endpoint that returns company data. `/health` is the only unauthenticated JSON reviewed, and it does not include records (AQ-L01).

---

## 3. Improvements

These are not defects. They are what would change if this were the daily system for a quality department. Do them after the High findings.

1. **One NCR story.** Keep the spreadsheet as the record people fill. Either retire the live `/ncr` screens from Home, search, and redirects, or label them “legacy tracker” so nobody files the same nonconformance twice.
2. **History on every filled sheet**, including a one-line description a registrar can read (“Changed disposition and quantity”) rather than a JSON blob. Signatures already store a certify sentence. Cell edits should read the same way.
3. **Login history on Admin only**, with failures as well as successes. Lockouts already exist; they are hard to review without a list.
4. **Gage status on the form.** When a sheet names an instrument, show Current / Due soon / Overdue next to the field. Blocking can follow (AQ-M07). Seeing it is the first step operators will accept.
5. **Training as a column, then as a gate.** On the document, show “qualified / not qualified” for the current user and revision. Turn that into a block only after the course list is trustworthy.
6. **Supplier status on the PO picker.** Gray out disqualified suppliers in the UI and enforce it on the server (AQ-H05). Default new suppliers to a pending state instead of `active` if approval is a real step.
7. **Retire means locked.** One button, one result: obsolete and in the archive, restorable only by an administrator (the restore rule already exists).
8. **PIN length later, not before the demo.** Four digits with bcrypt and a lockout after five failures (`signaturePin.ts`) matches the current certify flow. For a registrar who asks about assurance, the honest answer is: it is an attestation bound to the account, with lockout, not a long passphrase. Lengthen it only if a customer requires it.
9. **Admin health in plain language.** Database ok, background jobs off, last backup, mail transport real or log-only. The log-only mail path currently logs the full message (`notification.service.ts` `logTransport`). If mail is not configured, that log line can contain reset links.
10. **Phone layout for the three screens the demo uses:** Blank Forms search, the FRM NCR sheet, Folder Explorer. Wide sheets already print. A higher-up on a phone needs the save line and the folder name without horizontal hunting.

---

## 4. What’s solid

- **Sidebar matches the current ask.** FRM NCR is on the menu. Live `/ncr` is not. Blank Forms is under Workspace. CAPA and 8D stay as modules. Tests cover the sidebar and the folder rules.
- **Folder Explorer shows folders and saved work.** Blank drawers stay out unless a saved form is filed under them (`folderBrowse.ts`, with tests).
- **Revision letters stay put when someone fills a form.** New ISO rows get a template stamp. Later saves keep it (`templateRevision.ts`). FRM NCR’s published letter is Rev C in `FIXED_TEMPLATE_REVISIONS`. Pass/Fail for first-article measurements comes from nominal, tolerance, and actual (`passFail.ts`), shared by API and web.
- **Signatures.** PIN is hashed, checked on the server, requires a certify flag, and writes an audit row with a fixed sentence. A generic save cannot replace signature fields (`retainSignatureValues`). Production sign-in can require a PIN before other work.
- **Account protection.** bcrypt passwords, lockout before the password is checked, httpOnly refresh cookie, rotation and reuse detection, CSRF header, short-lived access token checked against `tokenVersion` and `isActive`, MFA available, forgot-password response does not reveal whether the email exists.
- **Audit storage design** for the modules that use it: trigger-backed field changes, company log that hides other people’s sign-in rows, history panels on NCR, CAPA, 8D, documents, suppliers, calibration, quarantine holds, training, and purchase orders.
- **Document archive lock** once a file is actually in Obsolete / Archive, including for Owner and Administrator, until an admin restores it.
- **Single company database.** Tenant columns are gone (`0074_single_company.sql`). Plants still exist inside that one database; that is a site filter, not a second company.
- **Deploy hygiene.** Migrations are manual with a `MIGRATE` confirmation. Backups are encrypted and a restore drill exists. CI uses a test database whose name must contain “test”. Gitleaks and production `npm audit` run. The live API health check matches the commit reviewed here, database reachable, and the web app sends HSTS, `nosniff`, and `X-Frame-Options: DENY`.

---

## 5. Next 7 days

Script the demo on day 1 and again on day 7. Everything in between is to make that script true.

| Day | Do this | Leave this |
|---|---|---|
| **1** | Finish the `form-templates` cache fix (already in progress). Click, in one session: sidebar FRM NCR → create → save; Quarantine Notice the same way; Blank Forms after the list; validation list after Blank Forms. | Do not demo until that path stops throwing. |
| **2** | File FRM-NCR-001, FRM-NCR-002, and FRM-NCR-003 into a chosen Documents folder. Fix the list sentence so it matches. Confirm Folder Explorer shows the saved copy and does not show the blank. | Do not change VERSION/REV rules. They already hold the letter still on answer saves. |
| **3** | Put the audit panel on the ISO form page. Register `"ISO form"` so a quality manager can open that history. Add the table to the field-change trigger. | Do not rebuild the company audit log. |
| **4** | Write login and logout rows. Show them on Admin only. Confirm a non-admin still cannot open them. | Do not add a second database or a per-site split. |
| **5** | Quarantine copy: sidebar list, empty state, and FRM-NCR-002 should tell the same story. Hide or relabel Home “NCRs open” so it does not jump to `/ncr`. | Full hold-and-release redesign can wait. |
| **6** | Block PO send to a disqualified supplier. Make Retire lock the document, or rename the button. | Training gates and gage hard-stops are the following week unless a customer asks. |
| **7** | Dry run on a phone, signed in as a quality user, not only as admin: Blank Forms → FRM NCR → save → Folder Explorer → history on that record → CAPA → 8D. Then Admin login history as an administrator. | Do not open Workflow Builder, digital twin, or IoT. Those jobs are off while Redis is unset (AQ-M09). |

**Demo script that matches the product today, before day 2–3 land:** Blank Forms, start FRM NCR, fill two cells, save, say the copy is stored and Documents filing for this sheet is the next change. Show CAPA and 8D from the sidebar, including the history panel on those records. Show Folder Explorer with a form that already files (validation or FAI), and say NCR filing is next. Do not say login history is available yet.

---

## Method

Reviewed the web app, API modules, schema, post-migrate SQL, Render blueprint, and CI/security workflows on `a34c535`. Confirmed live behavior only for unauthenticated health and response headers. Authenticated screens were not exercised against production, so findings are from code (and tests that encode the intended rules), not from a production click-through.
