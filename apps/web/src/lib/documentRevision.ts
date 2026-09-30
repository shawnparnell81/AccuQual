/**
 * One story for a controlled document's revision across the list, the detail
 * header, the version being shown, and version history.
 *
 * The versioning engine (controlled versions) is what "a version" means,
 * including a draft that has not been published. The document row's
 * currentVersion and revisionCode mirror only the released revision.
 * "Not released" is reserved for a document that has no released revision
 * and is not sitting in draft or review.
 */

export interface DocumentRevisionFacts {
  currentVersion: number;
  revisionCode: string | null;
  status: string;
}

export interface OpenRevisionFacts {
  versionNumber: number;
  status: string;
  revisionCode?: string | null;
}

const releasedCode = (doc: DocumentRevisionFacts) => doc.revisionCode?.trim() || `Rev ${doc.currentVersion}`;

/** Documents list, Revision column. */
export function listRevisionLabel(doc: DocumentRevisionFacts): string {
  if (doc.currentVersion > 0) return `${doc.revisionCode?.trim() || "—"} (v${doc.currentVersion})`;
  if (doc.status === "draft") return "Draft — not released";
  if (doc.status === "in_review") return "In review — not released";
  return "Not released";
}

/**
 * Detail header subtitle. When nothing is published but a draft or review is
 * open, name that version and its proposed code so "not released" and the
 * draft's revision code are the same fact.
 */
export function documentControlStandard(doc: DocumentRevisionFacts, open?: OpenRevisionFacts | null): string {
  if (doc.currentVersion > 0) return `${releasedCode(doc)} · document control`;
  if (open && (open.status === "draft" || open.status === "in_review")) {
    const state = open.status === "in_review" ? "in review" : "draft";
    const proposed = open.revisionCode?.trim() ? ` (proposed ${open.revisionCode.trim()})` : "";
    return `Not released yet · Version ${open.versionNumber} ${state}${proposed} · document control`;
  }
  if (doc.status === "in_review") return "Not released yet · in review · document control";
  if (doc.status === "draft") return "Not released yet · draft in progress · document control";
  return "Not released yet · document control";
}

/** Banner above the document form: which version is on screen, and whether it is released. */
export function showingVersionLabel(version: OpenRevisionFacts): string {
  const code = version.revisionCode?.trim() || "—";
  const n = version.versionNumber;
  if (version.status === "published") return `Showing version ${n} (${code}) — released`;
  if (version.status === "archived") return `Showing version ${n} (${code}) — earlier revision`;
  if (version.status === "in_review") return `Showing version ${n} (proposed ${code}) — in review, not released`;
  return `Showing version ${n} (proposed ${code}) — draft, not released`;
}

/** Short revision line shared by the Versions tab and Retention & history. */
export function versionRevisionNote(version: { status: string; revisionCode?: string | null }): string | null {
  const code = version.revisionCode?.trim();
  if (!code) return null;
  if (version.status === "published") return `${code} — released`;
  if (version.status === "archived") return `${code} — earlier revision`;
  if (version.status === "in_review") return `Proposed ${code} — in review, not released`;
  if (version.status === "draft") return `Proposed ${code} — draft, not released`;
  return null;
}

export function revisionCodeFieldLabel(status: string): string {
  if (status === "published") return "Revision code";
  if (status === "archived") return "Revision code (earlier revision)";
  if (status === "in_review") return "Revision code (proposed, in review)";
  return "Revision code (proposed)";
}

export function revisionCodeFieldHint(status: string): string | null {
  if (status === "draft") return "Proposed code for this draft. It is not released until this version is published.";
  if (status === "in_review") return "Proposed code for this version. It is in review and is not released yet.";
  if (status === "archived") return "Code from an earlier revision, not the revision in force.";
  return null;
}

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "");

/** Who moved this version, in the same words on the Versions tab and in Retention & history. */
export function versionActivityLine(version: {
  status: string;
  createdAt?: string | null;
  createdByName?: string | null;
  submittedAt?: string | null;
  submittedByName?: string | null;
  publishedAt?: string | null;
  publishedByName?: string | null;
}): string {
  if (version.publishedAt) return `Published ${when(version.publishedAt)} by ${version.publishedByName ?? "—"}`;
  if (version.status === "in_review") return `Submitted ${when(version.submittedAt)} by ${version.submittedByName ?? "—"}`;
  return `Started ${when(version.createdAt)} by ${version.createdByName ?? "—"}`;
}
