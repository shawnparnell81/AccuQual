import { FORM_TEMPLATE_CATALOG } from "./formTemplateCatalog.js";
import {
  FIXED_TEMPLATE_REVISIONS,
  TEMPLATE_STAMP_KEY,
  type TemplateStamp,
} from "./templateStructure.js";

export { TEMPLATE_STAMP_KEY, bumpRevision, nextRevision } from "./templateStructure.js";
export type { TemplateStamp } from "./templateStructure.js";

/** The master revision a new instance is filled against. */
export function templateRevisionFor(key: string): TemplateStamp {
  const fixed = FIXED_TEMPLATE_REVISIONS[key];
  if (fixed) return { version: fixed.version, revision: fixed.revision, structureHash: "" };
  return FORM_TEMPLATE_CATALOG[key] ?? { version: 1, revision: "A", structureHash: "" };
}

export function readTemplateStamp(data: unknown): TemplateStamp | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = (data as Record<string, unknown>)[TEMPLATE_STAMP_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const stamp = raw as Record<string, unknown>;
  const revision = typeof stamp.revision === "string" ? stamp.revision.trim() : "";
  if (!revision) return null;
  const version = stamp.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return null;
  return {
    version,
    revision,
    structureHash: typeof stamp.structureHash === "string" ? stamp.structureHash : "",
  };
}

export function stripTemplateStamp(data: Record<string, unknown>): Record<string, unknown> {
  if (!(TEMPLATE_STAMP_KEY in data)) return data;
  const next = { ...data };
  delete next[TEMPLATE_STAMP_KEY];
  return next;
}

/**
 * Puts the template revision on a filled payload.
 * A new instance gets the current master. A later answer save keeps the revision
 * already stored, including when the client sends a different one.
 */
export function answersWithTemplateStamp(
  key: string,
  previous: unknown,
  incoming: Record<string, unknown> | null | undefined,
  isNew: boolean,
): Record<string, unknown> {
  const answers = stripTemplateStamp({ ...(incoming ?? {}) });
  const kept = isNew ? null : readTemplateStamp(previous);
  const stamp = kept ?? templateRevisionFor(key);
  return {
    ...answers,
    [TEMPLATE_STAMP_KEY]: { version: stamp.version, revision: stamp.revision, structureHash: stamp.structureHash },
  };
}

/** Header revision column. Empty becomes the master. A value already stored is kept. */
export function keptRevision(stored: string | null | undefined, templateRevision: string): string {
  const current = (stored ?? "").trim();
  return current || templateRevision;
}
