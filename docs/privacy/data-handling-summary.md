# AccuQual — how customer data is handled

_A plain-language summary for customers and for security questionnaires. Every statement below describes what the
software does today; where something is not done, or depends on a hosting choice not yet confirmed, it says so.
Items marked **[confirm]** need a value from the hosting accounts before this is sent to a customer._

AccuQual is not certified by ISO, IATF, or any other standards body, and nothing in this document claims or implies
otherwise. It is a quality management system built around ISO 9001 / IATF 16949-style practices.

## What is stored

| Category | Examples | Where |
|---|---|---|
| Account data | Name, work email, role, department, password (as a hash), two-step sign-in secret (encrypted) | Database |
| Quality records | NCRs, CAPAs, audits, suppliers, customers, inventory, work orders, forms and their history | Database |
| Uploaded files | Attachments, calibration and training certificates, document PDFs | Application file storage |
| Audit history | Who changed what and when, with old and new values | Database |
| Notifications | Copies of emails the system sent (recipient, subject, body) | Database |
| Machine data | Readings from connected devices, if the customer uses that feature | Database |
| AI activity | Inputs and outputs of AI suggestions, and monthly usage counters | Database |

## Separation between customers

Every customer organization ("tenant") is separated in two independent ways: every query filters by the tenant, and
the database itself enforces row-level security so that a session belonging to one tenant cannot read another's rows
even if a query forgot to filter. This is covered by automated tests that run on every change.

## Sign-in and access

- Passwords are stored only as bcrypt hashes. Minimum 12 characters; common and known-breached passwords are refused
  (the breach check sends only the first five characters of a SHA-1 hash to the Have I Been Pwned range service).
- Accounts lock for 15 minutes after 5 wrong passwords in 15 minutes; the owner is emailed and the event is audited.
- Sessions end after 60 minutes idle. Disabling a user or changing their role ends their sessions on the next request.
- Two-step sign-in (authenticator app) with one-time recovery codes. Administrators are required to use it by default;
  an organization may require it for everyone. Platform administrators always need it.
- Single sign-on (OpenID Connect) is available per organization, restricted to email domains the organization has
  proven it owns by publishing a DNS record.
- Access to each module is controlled by department and by custom roles that the organization's own administrator
  manages. External supplier logins are confined to that supplier's own data.

## Protection of secrets

- Credentials the system must be able to use again (a customer's own AI provider key, single-sign-on client secrets,
  two-step sign-in secrets) are encrypted with AES-256-GCM. The encryption key is held in the server environment, not in
  the database.
- Device ingest keys and password-reset tokens are stored only as hashes.
- No secret is returned to the browser after it is saved, and secrets are not included in the data export or written to logs.

## Records integrity and audit trail

- Changes to quality records are logged by a database trigger, field by field with old and new values and the acting
  user. The application's database role can read this log and add to it but cannot edit or delete entries.
- Published versions of workflows, the Management Review and the Context of the Organization cannot be edited or
  deleted (enforced in the database), only superseded by a reviewed newer version.
- This is protection against accidental and application-level tampering. It does not, by itself, protect against a
  person with administrative access to the database server (a per-tenant hash chain would be needed for that; it is not built).

## Data in transit and at rest

- In production, traffic between browsers and the application is protected by TLS, which the hosting platform terminates.
- The application connects to the database over TLS. **By default the server certificate is not verified**; setting
  the `DATABASE_SSL_CA` environment variable turns on full certificate verification. **[confirm it is set in production]**
- Encryption at rest of the database volume and of backups is provided by the database host. **[confirm the plan's settings]**
- Uploaded files are stored on the application host's storage. **[confirm whether that storage is encrypted and persistent in the chosen hosting setup]**

## Logging and monitoring

- Application logs record request method, path, status, timing, and numeric tenant and user ids — not request
  bodies, form contents or passwords. Every request has a reference id that appears in logs and error messages.
- Optional error tracking (Sentry) receives error details and ids only. Request bodies, cookies, authorization headers,
  query strings, email addresses and IP addresses are stripped before sending.
- Automated alerts watch the database, error rates, background workers, workflow failures, sign-in attacks and email delivery.

## Backups and recovery

- Database backups are provided by the database host. **[confirm plan, frequency and retention]**
- **Not yet done:** a restore from backup has not yet been tested end to end, and there is no written recovery
  procedure. This is the next item on the operations plan.

## Getting data out, and getting it deleted

- **Export:** an organization's administrator can download everything the organization holds — records, history and
  uploaded files — as a ZIP (JSON Lines or CSV) from Admin Console → Data Export. The administrator must re-enter
  their password (and authenticator code) first; each export is audited. Credentials are never included.
- **Ending an account:** the platform administrator deactivates the organization, which blocks all sign-in.
- **Permanent deletion:** currently a manual operator procedure carried out on written request; there is no
  self-service deletion yet. **[decide and state the deletion time frame, e.g. within 30 days of the request]**
- **Individual users:** people are deactivated, not deleted, so that the audit history stays intact and attributable.

## Who else handles the data

See [subprocessors.md](subprocessors.md).

## Known gaps (stated plainly)

1. Restore from backup is untested (above).
2. Permanent deletion of an organization is manual.
3. The database certificate is not verified unless `DATABASE_SSL_CA` is set.
4. Mid-session enforcement of two-step sign-in is at sign-in and token refresh (within about 15 minutes), not every request.
5. Alert counters live in the API process and assume a single API instance.
