/** Revision rules for a built form. Filling a copy never calls this. */

export type SaveMode = "autosave" | "save" | "publish";
export type FormStatus = "draft" | "published";

export interface RevisionDecision {
  revision: string;
  bumped: boolean;
  recordHistory: boolean;
  status: FormStatus;
  /** Structure that fillers should open. Null while the form is still a draft. */
  publishedStructure: unknown | null;
}

export function structuresEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** A, B, C … Z, AA. A revision that is not letters restarts at B on the next bump. */
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

/**
 * Autosave keeps the draft and the current revision.
 * The revision moves forward only when a published form's structure changes
 * and someone saves or publishes that change. The first publish stays on the
 * current letter (A, until a later edit).
 */
export function decideStructureSave(input: {
  mode: SaveMode;
  status: FormStatus;
  revision: string;
  publishedStructure: unknown | null;
  nextStructure: unknown;
}): RevisionDecision {
  const revision = input.revision.trim() || "A";
  if (input.mode === "autosave") {
    return {
      revision,
      bumped: false,
      recordHistory: false,
      status: input.status,
      publishedStructure: input.publishedStructure,
    };
  }

  const firstPublish = input.mode === "publish" && (input.status !== "published" || input.publishedStructure == null);
  const changed = input.publishedStructure != null && !structuresEqual(input.publishedStructure, input.nextStructure);

  if (input.mode === "publish") {
    const bumped = !firstPublish && changed;
    return {
      revision: bumped ? bumpRevision(revision) : revision,
      bumped,
      recordHistory: firstPublish || bumped,
      status: "published",
      publishedStructure: input.nextStructure,
    };
  }

  if (input.status === "published" && changed) {
    return {
      revision: bumpRevision(revision),
      bumped: true,
      recordHistory: true,
      status: "published",
      publishedStructure: input.nextStructure,
    };
  }

  if (input.status !== "published") {
    return {
      revision,
      bumped: false,
      recordHistory: true,
      status: "draft",
      publishedStructure: input.publishedStructure,
    };
  }

  return {
    revision,
    bumped: false,
    recordHistory: false,
    status: "published",
    publishedStructure: input.publishedStructure,
  };
}
