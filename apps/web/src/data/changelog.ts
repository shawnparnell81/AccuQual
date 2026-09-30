/**
 * What's new — hand-maintained. Add one entry per release at the top of
 * this array (newest first). `version` is a plain dated tag, not semver
 * (this app ships multiple times a week, not on a version-number
 * schedule) — it only has to sort/compare as a string against what a
 * user last saw (see users.lastSeenChangelogVersion, GET/PATCH
 * /users/me/changelog-seen).
 */
export interface ChangelogEntry {
  version: string;
  date: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "2026-09-30",
    date: "2026-09-30",
    items: [
      "Form signatures use a 4-digit PIN. Set it once the first time you sign in, and change it later under Settings → Security. Signing a form asks for the PIN and a certification checkbox, then writes your name with the date and time. A wrong PIN does not sign the form. The PIN is stored as a hash and is not visible to an administrator.",
    ],
  },
  {
    version: "2026-09-27",
    date: "2026-09-27",
    items: [
      "Roles are listed from the top of the organization down. An administrator can edit a role's name, description, rank, and permissions, and can remove a role after moving its people to another one.",
      "An administrator can edit a person's name, email, role, department, and manager, and can remove an account. Someone with quality records is turned off instead of erased. Their name stays on history as inactive, and records they created or signed stay editable. Open work must be handed to someone else first.",
      "Import data reads a CSV or Excel file into suppliers, customer contacts, parts, scorecards, certifications, inspections, lots, equipment, or users. Large files run in the background.",
      "Audits has an Internal Audits folder for uploading files, with the same list and preview as the other audit folders.",
      "Quality has an Obsolete / Archive folder. Moving a document there asks for a reason and a confirmation, then the document is read-only until an Owner or Administrator restores it. The move and the restore are written to the audit log.",
      "Due-date reminders and escalation for overdue or stuck NCRs, CAPAs, 8Ds, and approvals waiting too long.",
      "Repeat NCRs now suggest a CAPA, with one click to open it and link the group.",
      "A personal daily digest in Settings lists what is due and which approvals are waiting, with a link to each record.",
    ],
  },
  {
    version: "2026-09-22",
    date: "2026-09-22",
    items: [
      "New: Worker Profiles — job title, shift and skills on top of every user, plus a live view of what they're currently assigned to.",
      "New: an app-wide anti-CSRF check on every cookie-carried request.",
      "New: Quarantine, Equipment & Calibration, and Training & Competency.",
    ],
  },
];

/** The newest entry's version — what a fresh badge compares against. */
export const LATEST_CHANGELOG_VERSION = CHANGELOG[0]?.version ?? null;
