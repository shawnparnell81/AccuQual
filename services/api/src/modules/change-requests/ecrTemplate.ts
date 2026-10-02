import { eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { company } from "../../drizzle/schema/company.js";
import { AppError } from "../../utils/appError.js";
import { bumpRevision, structureHash, type TemplateStamp } from "../forms/templateStructure.js";
import {
  CHANGE_REQUEST_LABEL_KEYS,
  ENGINEERING_CHANGE,
  ENGINEERING_LABEL_DEFAULTS,
  type ChangeRequestKindDef,
  type ChangeRequestLabelKey,
  type ChangeRequestLabels,
} from "./changeRequestKinds.js";

/**
 * Labels on FRM-ECR-001. The strings live with the shared change-request
 * kinds so drawing, process, and document requests can clone the sheet.
 * Rev B is this sheet: the workflow line and the links, training, and
 * impact section. A later label edit bumps again only when the hash changes.
 */
export const ECR_LABEL_DEFAULTS = ENGINEERING_LABEL_DEFAULTS;

export type EcrLabelKey = ChangeRequestLabelKey;

export const ECR_LABEL_KEYS = CHANGE_REQUEST_LABEL_KEYS;

export const ECR_STRUCTURE_CERTIFY = ENGINEERING_CHANGE.structureCertify;

export interface EcrLastChange {
  who: string;
  what: string;
  when: string;
  description: string;
}

export interface EcrMaster {
  companyId: number;
  version: number;
  revision: string;
  structureHash: string;
  labels: Record<EcrLabelKey, string>;
  lastChange: EcrLastChange | null;
}

export function ecrLabelsHash(labels: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(labels).sort()) sorted[key] = labels[key] ?? "";
  return structureHash(sorted);
}

export function kindCodeStamp(kind: ChangeRequestKindDef): TemplateStamp {
  return { version: kind.version, revision: kind.revision, structureHash: ecrLabelsHash(kind.labels) };
}

export function ecrCodeStamp(): TemplateStamp {
  return kindCodeStamp(ENGINEERING_CHANGE);
}

export function defaultKindLabels(kind: ChangeRequestKindDef): ChangeRequestLabels {
  return { ...kind.labels };
}

export function defaultEcrLabels(): Record<EcrLabelKey, string> {
  return defaultKindLabels(ENGINEERING_CHANGE);
}

export function parseKindLabels(kind: ChangeRequestKindDef, input: unknown): ChangeRequestLabels {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw AppError.badRequest("Enter a label for every line on the template.");
  const raw = input as Record<string, unknown>;
  const extra = Object.keys(raw).filter((key) => !(ECR_LABEL_KEYS as readonly string[]).includes(key));
  if (extra.length > 0) throw AppError.badRequest(`That template line isn't on the ${kind.noun}.`);
  const labels = defaultKindLabels(kind);
  for (const key of ECR_LABEL_KEYS) {
    const value = raw[key];
    if (typeof value !== "string" || !value.trim()) throw AppError.badRequest("Every template line needs a label.");
    if (value.trim().length > 200) throw AppError.badRequest("A template label must be 200 characters or fewer.");
    labels[key] = value.trim();
  }
  return labels;
}

export function parseEcrLabels(input: unknown): Record<EcrLabelKey, string> {
  return parseKindLabels(ENGINEERING_CHANGE, input);
}

function storedLabels(value: unknown): Record<EcrLabelKey, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const labels = defaultEcrLabels();
  for (const key of ECR_LABEL_KEYS) {
    const line = raw[key];
    if (typeof line !== "string" || !line.trim()) return null;
    labels[key] = line.trim();
  }
  return labels;
}

function readLastChange(value: unknown): EcrLastChange | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.who !== "string" || typeof row.what !== "string" || typeof row.when !== "string" || typeof row.description !== "string") return null;
  return { who: row.who, what: row.what, when: row.when, description: row.description };
}

export async function loadChangeRequestMaster(db: Db, kind: ChangeRequestKindDef = ENGINEERING_CHANGE): Promise<EcrMaster> {
  const [co] = await db.select({ id: company.id, profile: company.profile }).from(company).limit(1);
  const code = kindCodeStamp(kind);
  const stored = co?.profile?.[kind.profileKey];
  const labels = storedLabels(stored?.labels);
  const version = stored?.version;
  const revision = stored?.revision?.trim();
  const hash = stored?.structureHash;
  if (co && labels && typeof version === "number" && version >= 1 && revision && typeof hash === "string" && hash === ecrLabelsHash(labels)) {
    return { companyId: co.id, version, revision, structureHash: hash, labels, lastChange: readLastChange(stored?.lastChange) };
  }
  return {
    companyId: co?.id ?? 1,
    version: code.version,
    revision: code.revision,
    structureHash: code.structureHash,
    labels: defaultKindLabels(kind),
    lastChange: null,
  };
}

export async function loadEcrMaster(db: Db): Promise<EcrMaster> {
  return loadChangeRequestMaster(db, ENGINEERING_CHANGE);
}

export function nextEcrMaster(current: EcrMaster, labels: Record<EcrLabelKey, string>, lastChange: EcrLastChange | null): { master: EcrMaster; changed: boolean } {
  const structureHashValue = ecrLabelsHash(labels);
  const stamp = bumpRevision(
    { version: current.version, revision: current.revision, structureHash: current.structureHash },
    structureHashValue,
  );
  const changed = stamp.revision !== current.revision || stamp.version !== current.version;
  return {
    changed,
    master: {
      companyId: current.companyId,
      version: stamp.version,
      revision: stamp.revision,
      structureHash: stamp.structureHash,
      labels,
      lastChange: changed ? lastChange : current.lastChange,
    },
  };
}

export async function writeChangeRequestMaster(db: Db, kind: ChangeRequestKindDef, master: EcrMaster): Promise<void> {
  const [co] = await db.select({ id: company.id, profile: company.profile }).from(company).where(eq(company.id, master.companyId));
  if (!co) throw AppError.notFound("Company");
  const profile = {
    ...(co.profile ?? {}),
    [kind.profileKey]: {
      version: master.version,
      revision: master.revision,
      structureHash: master.structureHash,
      labels: master.labels,
      lastChange: master.lastChange,
    },
  };
  await db.update(company).set({ profile }).where(eq(company.id, co.id));
}

export async function writeEcrMaster(db: Db, master: EcrMaster): Promise<void> {
  await writeChangeRequestMaster(db, ENGINEERING_CHANGE, master);
}

export function labelSnapshot(data: unknown): Record<EcrLabelKey, string> | null {
  if (!data || typeof data !== "object") return null;
  return storedLabels((data as { templateLabels?: unknown }).templateLabels);
}
