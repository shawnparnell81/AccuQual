import type { Request, Response } from "express";
import { and, eq, desc } from "drizzle-orm";
import { feasibilityReviews } from "../../drizzle/schema/feasibility.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { requireSignatureStamp } from "../signatures/signaturePin.service.js";
import { assignSignatureRequired, normalizeRequiredMap, signatureBlocksFor } from "../signatures/signatureRequired.js";
import { deleteRecord } from "../records/recordDeletion.js";
import { notifyDepartment } from "../notifications/notification.service.js";
import { loadCompanyForSettings, getFeasibilitySettings, requiredDocumentDisplayNames } from "../settings/settings.service.js";
import { keptRevision, templateRevisionFor } from "../forms/templateRevision.js";
import { isFullAccessRole } from "../roles/roleAccess.js";

/** Full-record edit — engineering owns this document; same pattern as risk/workOrders/erp/rma.controller.ts's assertDepartment. */
function assertDepartment(req: Request, allowed: string[]) {
  const role = req.user?.roleName;
  if (isFullAccessRole(role)) return;
  const department = req.user?.department;
  if (!department || !allowed.includes(department)) {
    throw AppError.forbidden(`This action requires department: ${allowed.join(" or ")}`);
  }
}

/** Which department owns which sign-off row — mirrors the docx's 5-row Sign-off & Authorizations table exactly. */
const SIGNOFF_OWNER: Record<string, string> = {
  engineering: "engineering",
  quality: "quality",
  production: "manufacturing", // docx: "Manufacturing / Operations"
  purchasing: "purchasing", // docx: "Supply Chain / Purchasing"
};

/**
 * A non-engineering department may PATCH ONLY its own sign-off row's Name/
 * Signature fields — checked against the body's actual keys, not just the
 * route, so quality can't smuggle a manufacturing signature through the
 * same endpoint. Engineering/admin bypass entirely (they own the whole
 * document, sign-offs included).
 */
function assertSignoffFieldsAllowed(req: Request, body: Record<string, unknown>) {
  const role = req.user?.roleName;
  if (isFullAccessRole(role)) return;
  const department = req.user?.department;
  if (department === "engineering") return;

  const ownedPrefix = department ? SIGNOFF_OWNER[department] : undefined;
  if (!ownedPrefix) throw AppError.forbidden("Your department has no sign-off row on this form.");

  const fields = { ...body };
  const required = fields.signatureRequired;
  delete fields.signatureRequired;
  if (required !== undefined) {
    const own = `${ownedPrefix}SignoffSignature`;
    const extra = Object.keys(normalizeRequiredMap(required)).filter((key) => key !== own);
    if (extra.length > 0) throw AppError.forbidden(`Your department may only set Required on its own sign-off (${own}).`);
  }

  const disallowed = Object.keys(fields).filter((k) => !k.startsWith(ownedPrefix) && k !== "pin" && k !== "certified");
  if (disallowed.length > 0) {
    throw AppError.forbidden(`Your department may only edit its own sign-off row (${ownedPrefix}Signoff*) — not: ${disallowed.join(", ")}`);
  }
}

async function loadFeasibility(req: Request, id: number) {
  const [row] = await req.db!.select().from(feasibilityReviews).where(and(eq(feasibilityReviews.id, id)));
  if (!row) throw AppError.notFound("Feasibility review");
  return row;
}

/** The Sales / Commercial sign-off columns stay stored. Responses do not surface them. */
function hideSalesSignoff<T extends { salesSignoffName: string | null; salesSignoffSignature: string | null; salesSignoffDate: Date | null }>(row: T): T {
  return { ...row, salesSignoffName: null, salesSignoffSignature: null, salesSignoffDate: null };
}

export const listFeasibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status, customerId } = req.query as Record<string, string | undefined>;
  const conditions = [];
  if (status) conditions.push(eq(feasibilityReviews.status, status));
  if (customerId) conditions.push(eq(feasibilityReviews.customerId, Number(customerId)));

  const rows = await req.db!.select().from(feasibilityReviews).where(and(...conditions)).orderBy(desc(feasibilityReviews.createdAt));
  res.json(rows.map(hideSalesSignoff));
});

/** Create — engineering owns this document. */
export const createFeasibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["engineering"]);

  const co = await loadCompanyForSettings(req.db!);
  const settings = getFeasibilitySettings(co);
  const ownerId = req.body.ownerId ?? (settings.autoAssignOwner ? req.user?.id : undefined);

  // defaultRiskLevel seeds every one of the 7 fixed assessment rows — the
  // old model had one riskLevel field for the whole record; this one has 7,
  // so "apply the company default" now means "start every row at that level"
  // rather than skip the setting.
  const areaDefaults: Record<string, string> = {};
  if (settings.defaultRiskLevel) {
    for (const area of ["design", "equipment", "supplyChain", "quality", "capacity", "regulatory", "financial"]) {
      areaDefaults[`${area}RiskLevel`] = settings.defaultRiskLevel;
    }
  }

  const [created] = await req
    .db!.insert(feasibilityReviews)
    .values({ ...areaDefaults, ...req.body, ownerId, revision: templateRevisionFor("feasibility").revision, createdBy: req.user?.id })
    .returning();
  await recordAuditTrail(req.db!, { entityType: "FeasibilityReview", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(hideSalesSignoff(created!));
});

export const getFeasibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(hideSalesSignoff(await loadFeasibility(req, Number(req.params.id))));
});

/** Every content field except the 5 sign-off rows — engineering or admin only. */
export const updateFeasibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["engineering"]);
  const record = await loadFeasibility(req, Number(req.params.id));
  if (record.status === "final") throw AppError.badRequest("This review is finalized — no further edits.");

  const body = { ...(req.body as Record<string, unknown>) };
  delete body.revision;
  await assignSignatureRequired(req.db!, {
    entityType: "FeasibilityReview",
    entityId: record.id,
    performedBy: req.user?.id,
    previous: record,
    body,
    blocks: signatureBlocksFor("feasibility"),
  });
  const revision = keptRevision(record.revision, templateRevisionFor("feasibility").revision);
  const [updated] = await req
    .db!.update(feasibilityReviews)
    .set({ ...body, revision, updatedAt: new Date() })
    .where(eq(feasibilityReviews.id, record.id))
    .returning();

  await recordAuditTrail(req.db!, { entityType: "FeasibilityReview", entityId: record.id, action: "update", changes: { fieldsChanged: Object.keys(req.body) }, performedBy: req.user?.id });
  res.json(hideSalesSignoff(updated!));
});

/**
 * PATCH /:id/signoff — the one endpoint every sign-off department (not just
 * engineering) can reach, restricted to their own row by
 * assertSignoffFieldsAllowed. Signature date is always server-stamped the
 * moment that row's own signature transitions unset -> set, never accepted
 * from the client — same convention as Work Order operator/inspector
 * sign-off.
 */
export const updateSignoffHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadFeasibility(req, Number(req.params.id));
  if (record.status === "final") throw AppError.badRequest("This review is finalized — sign-offs are locked.");
  assertSignoffFieldsAllowed(req, req.body);

  const { pin, certified, ...withoutPin } = req.body as { pin?: string; certified?: boolean } & Record<string, unknown>;
  const rest = { ...withoutPin };
  delete rest.revision;
  await assignSignatureRequired(req.db!, {
    entityType: "FeasibilityReview",
    entityId: record.id,
    performedBy: req.user?.id,
    previous: record,
    body: rest,
    blocks: signatureBlocksFor("feasibility"),
  });
  const patch: Record<string, unknown> = { ...rest, revision: keptRevision(record.revision, templateRevisionFor("feasibility").revision), updatedAt: new Date() };
  const signatureKeys = Object.keys(rest).filter((key) => key.endsWith("SignoffSignature") && rest[key]);
  const stamp = signatureKeys.length
    ? await requireSignatureStamp(req, {
        pin,
        certified,
        entityType: "FeasibilityReview",
        entityId: record.id,
        field: signatureKeys.join(", "),
        description: "I certify that this feasibility sign-off is mine and the assessment is accurate.",
      })
    : null;
  for (const prefix of ["engineering", "quality", "manufacturing", "purchasing", "sales"]) {
    const sigKey = `${prefix}SignoffSignature`;
    const dateKey = `${prefix}SignoffDate`;
    if (rest[sigKey] === undefined) continue;
    if (!rest[sigKey]) {
      delete patch[sigKey];
      continue;
    }
    patch[sigKey] = stamp!.stamp;
    const wasUnset = !record[sigKey as keyof typeof record];
    patch[dateKey] = wasUnset ? stamp!.signedAt : record[dateKey as keyof typeof record];
  }

  const [updated] = await req.db!.update(feasibilityReviews).set(patch).where(eq(feasibilityReviews.id, record.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "FeasibilityReview", entityId: record.id, action: "update", changes: { subAction: "signoff", fieldsChanged: Object.keys(rest).filter((key) => !key.endsWith("Signature")) }, performedBy: req.user?.id });
  res.json(hideSalesSignoff(updated!));
});

/**
 * POST /:id/finalize — engineering or admin only. "Required document
 * validation" (Settings → Feasibility integration) gates this the same way
 * it gated the old "submit" transition; "notification routing" fires here
 * too, the one real state change this document has.
 */
export const finalizeFeasibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["engineering"]);
  const record = await loadFeasibility(req, Number(req.params.id));
  if (record.status === "final") throw AppError.badRequest("Already finalized.");

  const co = await loadCompanyForSettings(req.db!);
  const settings = getFeasibilitySettings(co);
  const required = settings.requiredDocuments ?? [];
  const provided = new Set((record.providedDocuments ?? []).map((doc) => String(doc)));
  const missing = required.filter((doc) => !provided.has(doc));
  if (missing.length > 0) {
    const labels = await requiredDocumentDisplayNames(req.db!, missing);
    throw AppError.badRequest(`Cannot finalize — missing required document(s): ${labels.join(", ")}. Mark them provided first.`);
  }

  const [updated] = await req.db!.update(feasibilityReviews).set({ status: "final", finalizedAt: new Date(), updatedAt: new Date() }).where(eq(feasibilityReviews.id, record.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "FeasibilityReview", entityId: record.id, action: "status_change", changes: { oldStatus: record.status, newStatus: "final" }, performedBy: req.user?.id });

  if (settings.notificationsEnabled) {
    await notifyDepartment(req.db!, {
      department: "quality",
      subject: `Feasibility Review #${record.id} finalized`,
      body: `"${record.partProjectName ?? record.customerName ?? "Untitled"}" has been finalized.`,
      relatedEntityType: "FeasibilityReview",
      relatedEntityId: record.id,
    });
  }

  res.json(hideSalesSignoff(updated!));
});

/** Delete — an administrator, owner, quality manager, or the person who created the review. */
export const deleteFeasibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  await deleteRecord(req, "feasibility");
  res.status(204).send();
});
