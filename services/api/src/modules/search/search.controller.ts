import type { Request, Response } from "express";
import { and, desc, eq, ilike, inArray, ne, or, sql, type SQLWrapper } from "drizzle-orm";
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
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { company } from "../../drizzle/schema/company.js";
import { changeRequests } from "../../drizzle/schema/change.js";
import { riskAssessments } from "../../drizzle/schema/risk.js";
import { ppapPackages } from "../../drizzle/schema/ppap.js";
import { sites } from "../../drizzle/schema/sites.js";
import { users } from "../../drizzle/schema/users.js";
import { getUserAccessLevel, type ResourceKey } from "../../middleware/departmentAccess.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import type { Db } from "../../lib/requestDb.js";
import { wantsRecordType, type SearchTypeName } from "./searchFilters.js";
import { showRecordNumber } from "../records/userRecordNumber.js";

const RESULTS_PER_TYPE = 5;

/** A Library Pool item that was taken off the shelf. The file and the record stay searchable. */
async function searchRemovedPoolFiles(db: Db, q: string): Promise<SearchResult[]> {
  const needle = q.trim();
  if (!needle) return [];
  const [row] = await db.select({ profile: company.profile }).from(company).limit(1);
  const ids = row?.profile?.libraryPoolRemovedIds ?? [];
  if (ids.length === 0) return [];
  const matches = await db
    .select({ id: documentFolders.id, name: documentFolders.name })
    .from(documentFolders)
    .where(and(inArray(documentFolders.id, ids), ilike(documentFolders.name, contains(needle))))
    .limit(RESULTS_PER_TYPE);
  return matches.map((match) => ({
    type: "Document" as const,
    id: match.id,
    label: match.name,
    path: `/documents/folders?folder=${match.id}`,
  }));
}

export interface SearchResult {
  type: SearchTypeName;
  id: number;
  label: string;
  path: string;
  status?: string | null;
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

function contains(value: string) {
  return `%${value}%`;
}

/**
 * GET /search?q=... — read-only across every module's own real table, no
 * new table of its own. Matches the number the user typed, plus document
 * title / revision and equipment name / serial. A blank number is not the
 * database id. Complaint, inventory, and purchase orders are not returned.
 *
 * Optional palette facets (`type`, `status`, `plant`, `assigned`) narrow
 * that same search. `assigned=me` is the signed-in user. A plant facet
 * only applies to records that belong to a plant, and still stays inside
 * the caller's current plant.
 */
export const searchHandler = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db! as Db;
  const user = { id: req.user!.id, roleName: req.user?.roleName ?? null, department: req.user?.department ?? null };
  const q = String(req.query.q ?? "").trim();
  const includeObsolete = ["1", "true", "yes"].includes(String(req.query.includeObsolete ?? "").toLowerCase());
  const typeFilter = String(req.query.type ?? "").trim();
  const statusFilter = String(req.query.status ?? "").trim();
  const plantFilter = String(req.query.plant ?? "").trim();
  const assignedFilter = String(req.query.assigned ?? "").trim();
  const hasFacet = Boolean(typeFilter || statusFilter || plantFilter || assignedFilter);

  if (!q && !hasFacet) return res.json({ results: [] });

  const digits = /^\d+$/.test(q) ? q : null;
  const siteId = req.siteId ?? -1;

  let plantIds: number[] | null = null;
  if (plantFilter) {
    const rows = await db
      .select({ id: sites.id })
      .from(sites)
      .where(or(ilike(sites.name, contains(plantFilter)), ilike(sites.code, contains(plantFilter)), ilike(sites.nameSnapshot, contains(plantFilter))))
      .limit(50);
    plantIds = rows.map((row) => row.id);
  }
  let assigneeIds: number[] | null = null;
  if (assignedFilter) {
    if (assignedFilter.toLowerCase() === "me") {
      assigneeIds = [user.id];
    } else {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(or(ilike(users.name, contains(assignedFilter)), ilike(users.email, contains(assignedFilter))))
        .limit(50);
      assigneeIds = rows.map((row) => row.id);
    }
  }
  const plantMiss = Boolean(plantFilter) && (plantIds?.length ?? 0) === 0;
  const assignMiss = Boolean(assignedFilter) && (assigneeIds?.length ?? 0) === 0;

  function includeModule(name: SearchTypeName, kind: "plant" | "company", assigned: boolean, textWithoutFacet: boolean, hasStatus = true): boolean {
    if (!wantsRecordType(name, typeFilter)) return false;
    if (statusFilter && !hasStatus) return false;
    if (plantFilter && (kind === "company" || plantMiss)) return false;
    if (assignedFilter && (!assigned || assignMiss)) return false;
    // Record numbers are text the user typed, so a word search has to reach these modules too.
    if (textWithoutFacet) return Boolean(q) || hasFacet;
    return Boolean(q) || hasFacet;
  }

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
  const statusLike = statusFilter ? contains(statusFilter) : null;

  if (includeModule("NCR", "plant", true, true) && (await allowed("ncr"))) {
    jobs.push(
      db
        .select()
        .from(ncr)
        .where(
          and(
            eq(ncr.siteId, siteId),
            q ? or(ilike(ncr.title, contains(q)), ilike(ncr.recordNumber, contains(q))) : undefined,
            statusLike ? ilike(ncr.status, statusLike) : undefined,
            plantIds ? inArray(ncr.siteId, plantIds) : undefined,
            assigneeIds ? inArray(ncr.assignedTo, assigneeIds) : undefined,
          ),
        )
        .orderBy(desc(ncr.recordNumber))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "NCR" as const, id: r.id, label: `${showRecordNumber(r.recordNumber) ? `NCR ${showRecordNumber(r.recordNumber)} — ` : "NCR — "}${r.title}`, path: `/ncr/${r.id}`, status: r.status }))),
    );
  }

  if (includeModule("CAPA", "plant", true, true) && (await allowed("capa"))) {
    jobs.push(
      db
        .select()
        .from(capa)
        .where(
          and(
            eq(capa.siteId, siteId),
            q ? or(ilike(capa.rootCause, contains(q)), ilike(capa.recordNumber, contains(q))) : undefined,
            statusLike ? ilike(capa.status, statusLike) : undefined,
            plantIds ? inArray(capa.siteId, plantIds) : undefined,
            assigneeIds ? inArray(capa.ownerId, assigneeIds) : undefined,
          ),
        )
        .orderBy(desc(capa.recordNumber))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "CAPA" as const, id: r.id, label: showRecordNumber(r.recordNumber) ? `CAPA ${showRecordNumber(r.recordNumber)}` : "CAPA", path: `/capa/${r.id}`, status: r.status }))),
    );
  }

  if (includeModule("WO", "company", false, true) && (await allowed("work_orders"))) {
    jobs.push(
      db
        .select()
        .from(workOrders)
        .where(and(q ? ilike(workOrders.recordNumber, contains(q)) : undefined, statusLike ? ilike(workOrders.status, statusLike) : undefined))
        .orderBy(desc(workOrders.recordNumber))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "WO" as const, id: r.id, label: showRecordNumber(r.recordNumber) ? `WO ${showRecordNumber(r.recordNumber)} (${r.status})` : `Work order (${r.status})`, path: `/work-orders/${r.id}`, status: r.status }))),
    );
  }

  if (includeModule("Audit", "plant", true, true) && (await allowed("audit"))) {
    jobs.push(
      db
        .select()
        .from(audits)
        .where(
          and(
            eq(audits.siteId, siteId),
            q ? or(ilike(audits.name, contains(q)), ilike(audits.recordNumber, contains(q))) : undefined,
            statusLike ? ilike(audits.status, statusLike) : undefined,
            plantIds ? inArray(audits.siteId, plantIds) : undefined,
            assigneeIds ? inArray(audits.auditorId, assigneeIds) : undefined,
          ),
        )
        .orderBy(desc(audits.recordNumber))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "Audit" as const, id: r.id, label: showRecordNumber(r.recordNumber) ? `Audit ${showRecordNumber(r.recordNumber)} — ${r.name}` : `Audit — ${r.name}`, path: `/audits/${r.id}`, status: r.status }))),
    );
  }

  if (includeModule("RMA", "company", false, true) && (await allowed("rma"))) {
    jobs.push(
      db
        .select()
        .from(rma)
        .where(and(q ? ilike(rma.rmaNumber, contains(q)) : undefined, statusLike ? ilike(rma.status, statusLike) : undefined))
        .orderBy(desc(rma.rmaNumber))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "RMA" as const, id: r.id, label: showRecordNumber(r.rmaNumber) ? `RMA ${showRecordNumber(r.rmaNumber)} (${r.status})` : `RMA (${r.status})`, path: `/rma/${r.id}`, status: r.status }))),
    );
  }

  if (includeModule("8D", "company", false, true, false) && (await allowed("eight_d"))) {
    jobs.push(
      db
        .select()
        .from(eightD)
        .where(q ? ilike(eightD.recordNumber, contains(q)) : undefined)
        .orderBy(desc(eightD.recordNumber))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "8D" as const, id: r.id, label: showRecordNumber(r.recordNumber) ? `8D ${showRecordNumber(r.recordNumber)}` : "8D", path: `/8d/${r.id}` }))),
    );
  }

  if (includeModule("Change", "company", true, true) && (await allowed("change"))) {
    jobs.push(
      db
        .select()
        .from(changeRequests)
        .where(
          and(
            q ? or(ilike(changeRequests.title, contains(q)), ilike(changeRequests.recordNumber, contains(q))) : undefined,
            statusLike ? ilike(changeRequests.status, statusLike) : undefined,
            assigneeIds ? inArray(changeRequests.requestedBy, assigneeIds) : undefined,
          ),
        )
        .orderBy(desc(changeRequests.recordNumber))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "Change" as const, id: r.id, label: showRecordNumber(r.recordNumber) ? `Change ${showRecordNumber(r.recordNumber)} — ${r.title}` : `Change — ${r.title}`, path: `/change/${r.id}`, status: r.status }))),
    );
  }

  if (includeModule("Risk", "company", true, true) && (await allowed("risk"))) {
    jobs.push(
      db
        .select()
        .from(riskAssessments)
        .where(and(q ? or(ilike(riskAssessments.title, contains(q)), ilike(riskAssessments.recordNumber, contains(q))) : undefined, statusLike ? ilike(riskAssessments.status, statusLike) : undefined, assigneeIds ? inArray(riskAssessments.ownerId, assigneeIds) : undefined))
        .orderBy(desc(riskAssessments.id))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "Risk" as const, id: r.id, label: showRecordNumber(r.recordNumber) ? `Risk ${showRecordNumber(r.recordNumber)} — ${r.title}` : `Risk — ${r.title}`, path: `/risk/${r.id}`, status: r.status }))),
    );
  }

  if (includeModule("PPAP", "company", false, true) && (await allowed("ppap"))) {
    jobs.push(
      db
        .select()
        .from(ppapPackages)
        .where(and(q ? or(ilike(ppapPackages.partNumber, contains(q)), ilike(ppapPackages.recordNumber, contains(q))) : undefined, statusLike ? ilike(ppapPackages.status, statusLike) : undefined))
        .orderBy(desc(ppapPackages.id))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "PPAP" as const, id: r.id, label: showRecordNumber(r.recordNumber) ? `PPAP ${showRecordNumber(r.recordNumber)} — ${r.partNumber}` : `PPAP — ${r.partNumber}`, path: `/ppap/${r.id}`, status: r.status }))),
    );
  }

  if (includeModule("Supplier", "company", false, false) && (await allowed("suppliers"))) {
    const textMatch = q ? ilike(suppliers.name, `${q}%`) : undefined;
    jobs.push(
      db
        .select()
        .from(suppliers)
        .where(and(digits ? idPrefix(suppliers.id, digits) : textMatch, statusLike ? ilike(suppliers.status, statusLike) : undefined))
        .orderBy(desc(suppliers.id))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "Supplier" as const, id: r.id, label: `Supplier #${r.id} — ${r.name}`, path: `/suppliers/${r.id}`, status: r.status }))),
    );
  }

  if (includeModule("Document", "company", true, false) && (await allowed("documents"))) {
    const textMatch = q ? or(ilike(documents.title, contains(q)), ilike(documents.revisionCode, contains(q))) : undefined;
    const idMatch = digits ? or(idPrefix(documents.id, digits), textMatch) : textMatch;
    jobs.push(
      db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.isDeleted, false),
            includeObsolete ? undefined : ne(documents.status, "obsolete"),
            idMatch,
            statusLike ? ilike(documents.status, statusLike) : undefined,
            assigneeIds ? inArray(documents.ownerId, assigneeIds) : undefined,
          ),
        )
        .orderBy(desc(documents.id))
        .limit(RESULTS_PER_TYPE)
        .then((rows) =>
          rows.map((r) => {
            const revision = r.revisionCode ? ` ${r.revisionCode}` : "";
            const obsolete = r.status === "obsolete" ? " (Obsolete)" : "";
            return { type: "Document" as const, id: r.id, label: `Document #${r.id}${revision} — ${r.title}${obsolete}`, path: `/documents/${r.id}`, status: r.status };
          }),
        ),
    );
    jobs.push(searchRemovedPoolFiles(db, q));
  }

  if (includeModule("Training", "company", false, true, false)) {
    jobs.push(
      db
        .select()
        .from(trainingCourses)
        .where(and(digits ? idPrefix(trainingCourses.id, digits) : undefined, !digits && q ? ilike(trainingCourses.title, contains(q)) : undefined))
        .orderBy(desc(trainingCourses.id))
        .limit(RESULTS_PER_TYPE)
        .then((rows) => rows.map((r) => ({ type: "Training" as const, id: r.id, label: `Course #${r.id} — ${r.title}`, path: `/training/${r.id}` }))),
    );
  }

  if (includeModule("Calibration", "company", false, false) && (await allowed("calibration"))) {
    const textMatch = q ? or(ilike(equipment.name, contains(q)), ilike(equipment.serialNumber, contains(q))) : undefined;
    const idMatch = digits ? or(idPrefix(equipment.id, digits), textMatch) : textMatch;
    jobs.push(
      db
        .select()
        .from(equipment)
        .where(and(idMatch, statusLike ? ilike(equipment.status, statusLike) : undefined))
        .orderBy(desc(equipment.id))
        .limit(RESULTS_PER_TYPE)
        .then((rows) =>
          rows.map((r) => {
            const serial = r.serialNumber ? ` · ${r.serialNumber}` : "";
            return { type: "Calibration" as const, id: r.id, label: `${r.name}${serial} (#${r.id})`, path: `/calibration/${r.id}`, status: r.status };
          }),
        ),
    );
  }

  const groups = await Promise.all(jobs);
  res.json({ results: groups.flat() });
});
