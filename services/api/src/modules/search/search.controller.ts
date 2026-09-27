import type { Request, Response } from "express";
import { and, eq, sql, ilike, or, type SQLWrapper } from "drizzle-orm";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { workOrders } from "../../drizzle/schema/workOrders.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { audits } from "../../drizzle/schema/audits.js";
import { trainingCourses } from "../../drizzle/schema/training.js";
import { equipment } from "../../drizzle/schema/calibration.js";
import { rma } from "../../drizzle/schema/rma.js";
import { eightD } from "../../drizzle/schema/eightD.js";
import { documents } from "../../drizzle/schema/documents.js";
import { changeRequests } from "../../drizzle/schema/change.js";
import { riskAssessments } from "../../drizzle/schema/risk.js";
import { ppapPackages } from "../../drizzle/schema/ppap.js";
import { getUserAccessLevel, type ResourceKey } from "../../middleware/departmentAccess.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import type { Db } from "../../lib/requestDb.js";

const RESULTS_PER_TYPE = 5;

export interface SearchResult {
  type: "NCR" | "CAPA" | "WO" | "Audit" | "Supplier" | "Training" | "Calibration" | "RMA" | "8D" | "Document" | "Change" | "Risk" | "PPAP";
  id: number;
  label: string;
  path: string;
}

/**
 * Same real per-department/role access already enforced on each module's
 * own routes (see departmentAccess.ts's getUserAccessLevel — this is a live
 * DB-driven check now, same as requireDepartmentAccess itself, not a
 * hardcoded-matrix lookup) — a category this user has no read access to on
 * the real module is simply never searched, not filtered out after the
 * fact. Training has no ResourceKey at all (see DEFAULT_PERMISSION_MATRIX's
 * own comment: read-by-everyone) — always searchable.
 */
async function canRead(
  db: Db,
  user: { id: number; roleName: string | null; department: string | null },
  resourceKey: ResourceKey
): Promise<boolean> {
  const level = await getUserAccessLevel(db, user, resourceKey);
  return level !== "none";
}

/** "12" matches ids 12, 120, 123, ... — a prefix match on the id cast to text, never on any title/description column, per "search ONLY by document number or ID". */
function idPrefix(column: SQLWrapper, digits: string) {
  return sql`CAST(${column} AS TEXT) LIKE ${digits + "%"}`;
}

/**
 * GET /search?q=... — read-only across every module's own real table, no
 * new table of its own. Numeric ids for records, plus document title /
 * revision and equipment name / serial. Complaint, inventory, and purchase
 * orders are not returned.
 */
export const searchHandler = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db! as Db;
  const user = { id: req.user!.id, roleName: req.user?.roleName ?? null, department: req.user?.department ?? null };
  const q = String(req.query.q ?? "").trim();

  if (!q) return res.json({ results: [] });

  const digits = /^\d+$/.test(q) ? q : null;
  const siteId = req.siteId ?? -1;

  // One permission lookup per module for this request, started together.
  const accessCache = new Map<ResourceKey, Promise<boolean>>();
  const allowed = (key: ResourceKey) => {
    let pending = accessCache.get(key);
    if (!pending) {
      pending = canRead(db, user, key);
      accessCache.set(key, pending);
    }
    return pending;
  };
  const keys: ResourceKey[] = ["ncr", "capa", "work_orders", "audit", "rma", "eight_d", "change", "risk", "ppap", "suppliers", "documents", "calibration"];
  await Promise.all(keys.map((key) => allowed(key)));

  const jobs: Promise<SearchResult[]>[] = [];

  if (digits && (await allowed("ncr"))) {
    jobs.push(
      db
        .select()
        .from(ncr)
        .where(and(eq(ncr.siteId, siteId), idPrefix(ncr.id, digits)))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "NCR" as const, id: r.id, label: `NCR #${r.id} — ${r.title}`, path: `/ncr/${r.id}` }))),
    );
  }

  if (digits && (await allowed("capa"))) {
    jobs.push(
      db
        .select()
        .from(capa)
        .where(and(eq(capa.siteId, siteId), idPrefix(capa.id, digits)))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "CAPA" as const, id: r.id, label: `CAPA #${r.id}${r.ncrId ? ` (NCR #${r.ncrId})` : ""}`, path: `/capa/${r.id}` }))),
    );
  }

  if (digits && (await allowed("work_orders"))) {
    jobs.push(
      db
        .select()
        .from(workOrders)
        .where(and(idPrefix(workOrders.id, digits)))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "WO" as const, id: r.id, label: `WO #${r.id} (${r.status})`, path: `/work-orders/${r.id}` }))),
    );
  }

  if (digits && (await allowed("audit"))) {
    jobs.push(
      db
        .select()
        .from(audits)
        .where(and(eq(audits.siteId, siteId), idPrefix(audits.id, digits)))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "Audit" as const, id: r.id, label: `Audit #${r.id} — ${r.name}`, path: `/audits/${r.id}` }))),
    );
  }

  if (digits && (await allowed("rma"))) {
    jobs.push(
      db
        .select()
        .from(rma)
        .where(and(idPrefix(rma.id, digits)))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "RMA" as const, id: r.id, label: `RMA ${r.rmaNumber} (${r.status})`, path: `/rma/${r.id}` }))),
    );
  }

  if (digits && (await allowed("eight_d"))) {
    jobs.push(
      db
        .select()
        .from(eightD)
        .where(and(idPrefix(eightD.id, digits)))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "8D" as const, id: r.id, label: `8D #${r.id}${r.ncrId ? ` (NCR #${r.ncrId})` : ""}`, path: `/8d/${r.id}` }))),
    );
  }

  if (digits && (await allowed("change"))) {
    jobs.push(
      db
        .select()
        .from(changeRequests)
        .where(and(idPrefix(changeRequests.id, digits)))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "Change" as const, id: r.id, label: `Change #${r.id} — ${r.title}`, path: `/change/${r.id}` }))),
    );
  }

  if (digits && (await allowed("risk"))) {
    jobs.push(
      db
        .select()
        .from(riskAssessments)
        .where(and(idPrefix(riskAssessments.id, digits)))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "Risk" as const, id: r.id, label: `Risk #${r.id} — ${r.title}`, path: `/risk/${r.id}` }))),
    );
  }

  if (digits && (await allowed("ppap"))) {
    jobs.push(
      db
        .select()
        .from(ppapPackages)
        .where(and(idPrefix(ppapPackages.id, digits)))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "PPAP" as const, id: r.id, label: `PPAP #${r.id} — ${r.partNumber}`, path: `/ppap/${r.id}` }))),
    );
  }

  if (await allowed("suppliers")) {
    const conditions = digits ? idPrefix(suppliers.id, digits) : ilike(suppliers.name, `${q}%`);
    jobs.push(
      db
        .select()
        .from(suppliers)
        .where(and(conditions))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "Supplier" as const, id: r.id, label: `Supplier #${r.id} — ${r.name}`, path: `/suppliers/${r.id}` }))),
    );
  }

  if (await allowed("documents")) {
    const textMatch = or(ilike(documents.title, `%${q}%`), ilike(documents.revisionCode, `%${q}%`));
    const conditions = digits ? or(idPrefix(documents.id, digits), textMatch) : textMatch;
    jobs.push(
      db
        .select()
        .from(documents)
        .where(and(eq(documents.isDeleted, false), conditions))
        .limit(RESULTS_PER_TYPE)
        .then((rows) =>
          rows.map((r) => {
            const revision = r.revisionCode ? ` ${r.revisionCode}` : "";
            return { type: "Document" as const, id: r.id, label: `Document #${r.id}${revision} — ${r.title}`, path: `/documents/${r.id}` };
          }),
        ),
    );
  }

  if (digits) {
    // Training: no ResourceKey in PERMISSION_MATRIX at all — read-by-everyone, same as the real /training routes (no department gate there either).
    jobs.push(
      db
        .select()
        .from(trainingCourses)
        .where(and(idPrefix(trainingCourses.id, digits)))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "Training" as const, id: r.id, label: `Course #${r.id} — ${r.title}`, path: `/training/${r.id}` }))),
    );
  }

  if (await allowed("calibration")) {
    const textMatch = or(ilike(equipment.name, `%${q}%`), ilike(equipment.serialNumber, `%${q}%`));
    const conditions = digits ? or(idPrefix(equipment.id, digits), textMatch) : textMatch;
    jobs.push(
      db
        .select()
        .from(equipment)
        .where(and(conditions))
        .limit(RESULTS_PER_TYPE)
        .then((rows) =>
          rows.map((r) => {
            const serial = r.serialNumber ? ` · ${r.serialNumber}` : "";
            return { type: "Calibration" as const, id: r.id, label: `${r.name}${serial} (#${r.id})`, path: `/calibration/${r.id}` };
          }),
        ),
    );
  }

  const groups = await Promise.all(jobs);
  res.json({ results: groups.flat() });
});
