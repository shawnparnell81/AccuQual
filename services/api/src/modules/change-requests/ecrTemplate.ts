import { eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { company } from "../../drizzle/schema/company.js";
import { AppError } from "../../utils/appError.js";
import { bumpRevision, structureHash, type TemplateStamp } from "../forms/templateStructure.js";

/**
 * Labels on FRM-ECR-001. Keep the strings aligned with
 * apps/web/src/lib/ecrTemplate.ts. Rev B is this sheet: the workflow line
 * and the links, training, and impact section. A later label edit bumps
 * again only when the hash changes.
 */
export const ECR_LABEL_DEFAULTS = {
  workflowStatus: "Workflow Status:",
  section1: "SECTION 1: IDENTIFICATION",
  dateOfRequest: "Date of Request:",
  requestedBy: "Requested By:",
  partNumbers: "Part Number(s) Affected:",
  currentRevision: "Current Revision:",
  job: "Job / Project:",
  newRevision: "New Revision (Proposed):",
  section2: "SECTION 2: CHANGE DETAILS",
  changeType: "Type of Change:",
  changeSupplier: "Supplier Request",
  changeCost: "Cost Reduction",
  changeQuality: "Quality Improvement",
  changeDimensional: "Dimensional Correction",
  description: "Description of Change (Current vs. Proposed):",
  reason: "Reason / Explanation:",
  drawingUpdate: "Drawing Update Required?",
  drawingNote: "If YES attach draft drawing.",
  section3: "SECTION 3: ENGINEERING REVIEW & RISK",
  fitFormFunction: "Does this affect Fit Form or Function?",
  validationRequired: "Is Validation Testing required?",
  testPlan: "If YES describe test plan:",
  qcProcedure: "QC Procedure to Prevent Mixing Parts:",
  implementationPlan: "Planned Implementation Batch/Date:",
  section4: "SECTION 4: STOCK DISPOSITION (What about old parts?)",
  useAsIs: "Use As-Is",
  scrap: "Scrap",
  rework: "Rework",
  notes: "Notes",
  rawMaterial: "Raw Material:",
  wip: "WIP (In Process):",
  finishedGoods: "Finished Goods:",
  section7: "SECTION 7: LINKS, TRAINING, AND IMPACT",
  affectedDrawing: "Affected Drawing:",
  affectedDocument: "Affected Document:",
  affectedProcess: "Affected Process:",
  trainingRequired: "Training Required?",
  trainingReference: "Training Reference:",
  customerNotice: "Customer Notification Required?",
  ppapImpact: "PPAP or Validation Impact?",
  section5: "SECTION 5: AUTHORIZATION",
  managerSign: "DMA Engineering/Quality Manager:",
  signDate: "Date:",
  supplierSign: "Supplier Representative (If Applicable):",
  section6: "SECTION 6: VERIFICATION OF IMPLEMENTATION",
  implemented: "Did the change occur successfully on the planned batch?",
  verifiedBy: "Verified By:",
} as const;

export type EcrLabelKey = keyof typeof ECR_LABEL_DEFAULTS;

export const ECR_LABEL_KEYS = Object.keys(ECR_LABEL_DEFAULTS) as EcrLabelKey[];

export const ECR_STRUCTURE_CERTIFY = "I certify that I am authorized to change the engineering change request template.";

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

export function ecrCodeStamp(): TemplateStamp {
  return { version: 2, revision: "B", structureHash: ecrLabelsHash(ECR_LABEL_DEFAULTS) };
}

export function defaultEcrLabels(): Record<EcrLabelKey, string> {
  return { ...ECR_LABEL_DEFAULTS };
}

export function parseEcrLabels(input: unknown): Record<EcrLabelKey, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw AppError.badRequest("Enter a label for every line on the template.");
  const raw = input as Record<string, unknown>;
  const extra = Object.keys(raw).filter((key) => !(ECR_LABEL_KEYS as readonly string[]).includes(key));
  if (extra.length > 0) throw AppError.badRequest("That template line isn't on the engineering change request.");
  const labels = defaultEcrLabels();
  for (const key of ECR_LABEL_KEYS) {
    const value = raw[key];
    if (typeof value !== "string" || !value.trim()) throw AppError.badRequest("Every template line needs a label.");
    if (value.trim().length > 200) throw AppError.badRequest("A template label must be 200 characters or fewer.");
    labels[key] = value.trim();
  }
  return labels;
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

export async function loadEcrMaster(db: Db): Promise<EcrMaster> {
  const [co] = await db.select({ id: company.id, profile: company.profile }).from(company).limit(1);
  const code = ecrCodeStamp();
  const stored = co?.profile?.ecrTemplate;
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
    labels: defaultEcrLabels(),
    lastChange: null,
  };
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

export async function writeEcrMaster(db: Db, master: EcrMaster): Promise<void> {
  const [co] = await db.select({ id: company.id, profile: company.profile }).from(company).where(eq(company.id, master.companyId));
  if (!co) throw AppError.notFound("Company");
  const profile = {
    ...(co.profile ?? {}),
    ecrTemplate: {
      version: master.version,
      revision: master.revision,
      structureHash: master.structureHash,
      labels: master.labels,
      lastChange: master.lastChange,
    },
  };
  await db.update(company).set({ profile }).where(eq(company.id, co.id));
}

export function labelSnapshot(data: unknown): Record<EcrLabelKey, string> | null {
  if (!data || typeof data !== "object") return null;
  return storedLabels((data as { templateLabels?: unknown }).templateLabels);
}
