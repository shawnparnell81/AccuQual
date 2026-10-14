/**
 * Revision rules for a built form. Filling a copy never calls this.
 *
 * The app never changes a form's REV by itself. A draft keeps the REV a person
 * typed (A when the form is created). Once a form is published, a structural
 * change can only be saved or published with a new REV and a description of the
 * change, both entered by the person making it. The change then waits for
 * approval: the live REV and structure move only when it is approved.
 */
import { AppError } from "../../utils/appError.js";

export type SaveMode = "autosave" | "save" | "publish";
export type FormStatus = "draft" | "published";

export const MAX_REVISION_LENGTH = 10;

export interface RevisionChange {
  from: string;
  to: string;
  description: string;
}

export interface RevisionDecision {
  /** What built_forms.revision becomes. A published form keeps its live REV until the new one is approved. */
  revision: string;
  /** Set when a published form's structure changed and is going to approval under a new REV. */
  change: RevisionChange | null;
  /** True when this save or publish creates a revision that waits for approval. */
  submit: boolean;
  /** The REV the pending revision carries. */
  submitRevision: string | null;
  recordHistory: boolean;
  status: FormStatus;
  /** Structure that fillers open. It only moves when a revision is approved. */
  publishedStructure: unknown | null;
}

export function structuresEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A REV a person typed. Empty, too long, or not text is rejected with a plain message. */
function cleanRevision(value: unknown, message: string): string {
  const text = asText(value);
  if (!text) throw AppError.badRequest(message);
  if (text.length > MAX_REVISION_LENGTH) throw AppError.badRequest(`The revision can be at most ${MAX_REVISION_LENGTH} characters.`);
  return text;
}

/**
 * A, B, C ... Z, AA. Form Builder never calls this: a built form's REV only changes when a person types one.
 * Controlled lists still step their own revision with it.
 */
export function bumpRevision(current: string): string {
  const rev = current.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(rev)) return "B";
  const chars = rev.split("");
  let index = chars.length - 1;
  while (index >= 0) {
    if (chars[index] !== "Z") {
      chars[index] = String.fromCharCode(chars[index]!.charCodeAt(0) + 1);
      return chars.join("");
    }
    chars[index] = "A";
    index -= 1;
  }
  return `A${chars.join("")}`;
}

export function decideStructureSave(input: {
  mode: SaveMode;
  status: FormStatus;
  revision: string;
  publishedStructure: unknown | null;
  nextStructure: unknown;
  /** The REV a person entered. Optional on a draft, required to change a published structure. */
  newRevision?: unknown;
  changeDescription?: unknown;
}): RevisionDecision {
  const current = input.revision.trim() || "A";

  if (input.status !== "published") {
    // A draft has no live REV to protect, so the person can set it freely. Publishing it sends it for approval.
    const typed = input.newRevision === undefined || input.newRevision === null ? null : cleanRevision(input.newRevision, "Enter a revision, such as A.");
    const revision = typed ?? current;
    const publishing = input.mode === "publish";
    return {
      revision,
      change: null,
      submit: publishing,
      submitRevision: publishing ? revision : null,
      recordHistory: input.mode === "save",
      status: "draft",
      publishedStructure: input.publishedStructure,
    };
  }

  const live = { revision: current, change: null, submit: false, submitRevision: null, recordHistory: false, status: "published" as const, publishedStructure: input.publishedStructure };
  if (input.mode === "autosave") return live;

  const changed = input.publishedStructure != null && !structuresEqual(input.publishedStructure, input.nextStructure);
  if (!changed) return live;

  const message = `Enter the new revision. It must be different from REV ${current}.`;
  const revision = cleanRevision(input.newRevision, message);
  if (revision.toLowerCase() === current.toLowerCase()) throw AppError.badRequest(message);
  const description = asText(input.changeDescription);
  if (!description) throw AppError.badRequest("Describe what changed in this revision.");
  // The live REV and structure stay as they are until someone approves this one.
  return { ...live, change: { from: current, to: revision, description }, submit: true, submitRevision: revision };
}

/** The person's own words from a "<who> changed … on <when>: <description>" summary. Other summaries come back whole. */
export function descriptionOf(summary: string): string {
  const match = /\b[AP]M:\s+([\s\S]+)$/.exec(summary);
  return match?.[1]?.trim() || summary;
}
