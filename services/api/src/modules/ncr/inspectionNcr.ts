import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Request, Response } from "express";
import type { Db } from "../../lib/requestDb.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { formData } from "../../drizzle/schema/forms.js";
import { isoQualityForms } from "../../drizzle/schema/isoQualityForms.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { readRecordSite, stampRecordSite } from "../sites/recordSite.js";

export const inspectionNcrRowSchema = z.object({
  measurement: z.string().trim().min(1).max(300),
  spec: z.string().trim().max(300).default(""),
  actual: z.string().trim().max(300).default(""),
  addr: z.string().trim().max(40).optional(),
});

export type InspectionNcrRow = z.infer<typeof inspectionNcrRowSchema>;

/** Picture-form inspections. A failure here never opens an NCR by itself. */
export const INSPECTION_FORM_TYPES = new Set(["final_inspection_release_checklist", "dimensional_report", "first_article"]);

export const fromInspectionSchema = z.object({
  sourceKind: z.enum(["form", "iso"]),
  formType: z.string().trim().min(1).max(80),
  sourceId: z.number().int().positive(),
  formTitle: z.string().trim().min(1).max(200),
  path: z.string().trim().min(1).max(300),
  part: z.string().trim().max(200).default(""),
  rows: z.array(inspectionNcrRowSchema).min(1).max(40),
});

export async function requireNcrEdit(db: Db, actor: { id: number; roleName: string | null; department: string | null }): Promise<void> {
  const level = await getUserAccessLevel(db, actor, "ncr");
  if (level !== "edit") throw AppError.forbidden("You can view this record, but you can't create an NCR.");
}

export interface OpenInspectionNcrInput {
  formTitle: string;
  part: string;
  path: string;
  formType?: string;
  sourceId: number;
  kind?: string;
  siteId?: number | null;
  fallbackSiteId?: number | null;
  supplierId?: number | null;
  severity?: string | null;
  receivingLineItemId?: number | null;
  rows: InspectionNcrRow[];
  sourceAudit: { entityType: string; entityId: number };
}

/** Opens one NCR with a blank number. Callers write the link back onto the source record. */
export async function openInspectionNcr(db: Db, input: OpenInspectionNcrInput, performedBy?: number) {
  if (input.rows.length < 1) throw AppError.badRequest("There is no failed measurement to put on an NCR.");
  const title = (input.part ? `${input.formTitle} failed — ${input.part}` : `${input.formTitle} failed`).slice(0, 200);
  const description = input.rows.map((row) => `${row.measurement}: spec ${row.spec || "(blank)"}, actual ${row.actual || "(blank)"}`).join("\n");
  const source = {
    kind: input.kind ?? "inspection",
    reportId: input.sourceId,
    formType: input.formType,
    formTitle: input.formTitle,
    path: input.path,
    part: input.part,
    rows: input.rows,
  };
  const siteId = input.siteId ?? null;
  const [created] = await db
    .insert(ncr)
    .values({
      title,
      description,
      recordNumber: null,
      siteId: siteId ?? undefined,
      supplierId: input.supplierId ?? undefined,
      severity: input.severity ?? undefined,
      receivingLineItemId: input.receivingLineItemId ?? undefined,
      status: "ncr_created",
      processData: { validationSource: source },
      createdBy: performedBy,
    })
    .returning();
  if (!created) throw AppError.badRequest("Couldn't create the NCR.");
  if (siteId == null) await stampRecordSite(db, "ncr", created.id, input.fallbackSiteId);
  await recordAuditTrail(db, {
    entityType: "NCR",
    entityId: created.id,
    action: "create",
    changes: { event: "inspection_source", sourceId: input.sourceId, path: input.path, summary: `Opened from ${input.formTitle}.` },
    performedBy,
  });
  await recordAuditTrail(db, {
    entityType: input.sourceAudit.entityType,
    entityId: input.sourceAudit.entityId,
    action: "update",
    changes: { event: "ncr_created", ncrId: created.id, summary: `Created NCR ${created.id} from this record.` },
    performedBy,
  });
  return created;
}

export async function ncrsForPath(db: Db, path: string): Promise<{ id: number; recordNumber: string | null }[]> {
  const found = await db.execute<{ id: number; record_number: string | null }>(sql`
    SELECT id, record_number FROM ncr
    WHERE is_deleted = false AND process_data->'validationSource'->>'path' = ${path}
    ORDER BY id DESC
    LIMIT 5
  `);
  return (found.rows ?? []).map((row) => ({ id: Number(row.id), recordNumber: row.record_number }));
}

function rememberLink(data: Record<string, unknown> | null | undefined, ncrId: number): Record<string, unknown> {
  const current = data ?? {};
  const linked = Array.isArray(current.linkedNcrs) ? (current.linkedNcrs as { id: number }[]) : [];
  return { ...current, linkedNcrs: [...linked.filter((item) => item.id !== ncrId), { id: ncrId }] };
}

/** POST /ncr/from-inspection — optional create from a picture inspection or an ISO first article. */
export const createFromInspectionHandler = asyncHandler(async (req: Request, res: Response) => {
  const actor = { id: req.user?.id ?? 0, roleName: req.user?.roleName ?? null, department: req.user?.department ?? null };
  await requireNcrEdit(req.db!, actor);
  const body = fromInspectionSchema.parse(req.body);
  if (!INSPECTION_FORM_TYPES.has(body.formType)) throw AppError.badRequest("Create NCR is only on an inspection form.");
  // Idempotent: a second click (or a double-POST) returns the already-linked
  // NCR instead of opening a duplicate.
  const alreadyOpen = await ncrsForPath(req.db!, body.path);
  if (alreadyOpen[0]) {
    res.status(200).json({ id: alreadyOpen[0].id, recordNumber: alreadyOpen[0].recordNumber, existing: true });
    return;
  }

  let siteId: number | null = null;
  if (body.sourceKind === "iso") {
    const [form] = await req.db!.select().from(isoQualityForms).where(eq(isoQualityForms.id, body.sourceId));
    if (!form || form.formType !== body.formType) throw AppError.notFound("ISO form");
    siteId = (await readRecordSite(req.db!, "iso_form", form.id)).siteId;
    const created = await openInspectionNcr(
      req.db!,
      {
        formTitle: body.formTitle,
        part: body.part,
        path: body.path,
        formType: body.formType,
        sourceId: form.id,
        kind: "iso",
        siteId,
        fallbackSiteId: req.siteId,
        rows: body.rows,
        sourceAudit: { entityType: "ISO Quality Form", entityId: form.id },
      },
      req.user?.id,
    );
    await req.db!.update(isoQualityForms).set({ data: rememberLink(form.data as Record<string, unknown>, created.id) as typeof form.data, updatedAt: new Date() }).where(eq(isoQualityForms.id, form.id));
    res.status(201).json({ id: created.id, recordNumber: created.recordNumber, title: created.title });
    return;
  }

  const [fill] = await req.db!
    .select()
    .from(formData)
    .where(and(eq(formData.formType, body.formType), eq(formData.entityId, body.sourceId)))
    .orderBy(desc(formData.id))
    .limit(1);
  if (!fill) throw AppError.badRequest("Save the inspection before creating an NCR.");
  const created = await openInspectionNcr(
    req.db!,
    {
      formTitle: body.formTitle,
      part: body.part,
      path: body.path,
      formType: body.formType,
      sourceId: fill.id,
      kind: "form",
      siteId: null,
      fallbackSiteId: req.siteId,
      rows: body.rows,
      sourceAudit: { entityType: "Form", entityId: fill.id },
    },
    req.user?.id,
  );
  await req.db!.update(formData).set({ data: rememberLink(fill.data, created.id), updatedAt: new Date() }).where(eq(formData.id, fill.id));
  res.status(201).json({ id: created.id, recordNumber: created.recordNumber, title: created.title });
});
