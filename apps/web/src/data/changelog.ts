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
    version: "2026-09-27",
    date: "2026-09-27",
    items: [
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
