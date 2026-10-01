import { asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { getUserAccessLevel, type ResourceKey } from "../../middleware/departmentAccess.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { documents } from "../../drizzle/schema/documents.js";
import { trainingAssignments, trainingCourses } from "../../drizzle/schema/training.js";
import { audits, auditItems } from "../../drizzle/schema/audits.js";
import { changeRequests } from "../../drizzle/schema/change.js";
import { ppapPackages } from "../../drizzle/schema/ppap.js";
import { scarForms } from "../../drizzle/schema/scarForms.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { sites, userSites } from "../../drizzle/schema/sites.js";
import { users } from "../../drizzle/schema/users.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { validationReports } from "../../drizzle/schema/validationReport.js";
import { isoQualityForms } from "../../drizzle/schema/isoQualityForms.js";
import { riskAssessments } from "../../drizzle/schema/risk.js";
import { workOrders } from "../../drizzle/schema/workOrders.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { listEquipmentWithSummary } from "../calibration/calibration.service.js";
import { canSeeCompanyAuditRow, visibleEntityTypes } from "../audit-trail/auditTrailVisibility.js";
import {
  buildDashboardOverview,
  type DashActivity,
  type DashAudit,
  type DashAuditItem,
  type DashboardOverview,
  type DashboardSource,
  type SiteRef,
} from "./dashboard.metrics.js";
import { buildOpenWork, type OpenWork } from "./dashboard.openWork.js";

const ROW_CAP = 5000;
const ACTIVITY_LIMIT = 40;
const ACTIVITY_SCAN = 200;

const READ_KEYS = ["ncr", "capa", "documents", "training", "audit", "calibration", "change", "ppap", "scar", "risk", "work_orders"] as const satisfies readonly ResourceKey[];

const OPEN_FORM_TYPES = ["first_article", "salt_spray", "prototype_strut", "engineering_change"] as const;

const SITE_SCOPED_ACTIVITY = new Set(["NCR", "CAPA", "Audit"]);

export interface DashboardLoadOptions {
  /** Plants the headline numbers cover. */
  kpiSiteIds: number[];
  allPlants: boolean;
  /** Every plant this person may open. */
  allowedSiteIds: number[];
}

function cap<T>(rows: T[], truncated: { value: boolean }): T[] {
  if (rows.length >= ROW_CAP) truncated.value = true;
  return rows.slice(0, ROW_CAP);
}

function titleFrom(changes: unknown): string | null {
  if (!changes || typeof changes !== "object") return null;
  const record = changes as Record<string, unknown>;
  for (const key of ["title", "name"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Read-only rollup for the signed-in dashboard. Each section is loaded only
 * when this person can already read that module. Nothing here writes.
 */
export async function loadDashboardOverview(
  db: Db,
  user: { id: number; roleName: string | null; department: string | null },
  opts: DashboardLoadOptions,
): Promise<DashboardOverview & { openWork: OpenWork }> {
  const levels = await Promise.all(READ_KEYS.map(async (key) => [key, await getUserAccessLevel(db, user, key)] as const));
  const levelOf = Object.fromEntries(levels) as Record<(typeof READ_KEYS)[number], string>;
  const can = (key: (typeof READ_KEYS)[number]) => levelOf[key] !== "none";

  const allowed = opts.allowedSiteIds;
  const kpiSiteIds = opts.kpiSiteIds.filter((id) => allowed.includes(id));
  const truncated = { value: false };
  const [siteRows, ncrRows, capaRows, docRows, assignmentRows, membershipRows, auditRows, changeRows, ppapRows, scarRows, people, equipmentRows, validationRows, isoRows, riskRows, workOrderRows] = await Promise.all([
    allowed.length === 0
      ? Promise.resolve([])
      : db.select({ id: sites.id, name: sites.name, code: sites.code, status: sites.status }).from(sites).where(inArray(sites.id, allowed)),
    can("ncr") && allowed.length > 0
      ? db
          .select({
            id: ncr.id,
            siteId: ncr.siteId,
            title: ncr.title,
            status: ncr.status,
            severity: ncr.severity,
            assignedTo: ncr.assignedTo,
            dueDate: ncr.dueDate,
            closedAt: ncr.closedAt,
            createdAt: ncr.createdAt,
            updatedAt: ncr.updatedAt,
            rootCause: ncr.rootCause,
            isDeleted: ncr.isDeleted,
          })
          .from(ncr)
          .where(inArray(ncr.siteId, allowed))
          .limit(ROW_CAP)
      : Promise.resolve([]),
    can("capa") && allowed.length > 0
      ? db
          .select({
            id: capa.id,
            siteId: capa.siteId,
            ncrId: capa.ncrId,
            status: capa.status,
            ownerId: capa.ownerId,
            dueDate: capa.dueDate,
            closedAt: capa.closedAt,
            createdAt: capa.createdAt,
            updatedAt: capa.updatedAt,
            actionPlan: capa.actionPlan,
            rootCause: capa.rootCause,
          })
          .from(capa)
          .where(inArray(capa.siteId, allowed))
          .limit(ROW_CAP)
      : Promise.resolve([]),
    can("documents")
      ? db
          .select({
            id: documents.id,
            title: documents.title,
            status: documents.status,
            ownerId: documents.ownerId,
            expirationDate: documents.expirationDate,
            expirationWarningDays: documents.expirationWarningDays,
            revisionCode: documents.revisionCode,
            isDeleted: documents.isDeleted,
          })
          .from(documents)
          .limit(ROW_CAP)
      : Promise.resolve([]),
    can("training")
      ? db
          .select({
            id: trainingAssignments.id,
            courseId: trainingAssignments.courseId,
            courseTitle: trainingCourses.title,
            userId: trainingAssignments.userId,
            status: trainingAssignments.status,
            dueAt: trainingAssignments.dueAt,
          })
          .from(trainingAssignments)
          .leftJoin(trainingCourses, eq(trainingCourses.id, trainingAssignments.courseId))
          .limit(ROW_CAP)
      : Promise.resolve([]),
    can("training") ? db.select({ userId: userSites.userId, siteId: userSites.siteId }).from(userSites) : Promise.resolve([]),
    can("audit") && allowed.length > 0
      ? db
          .select({
            id: audits.id,
            siteId: audits.siteId,
            name: audits.name,
            status: audits.status,
            auditorId: audits.auditorId,
            scheduledAt: audits.scheduledAt,
          })
          .from(audits)
          .where(inArray(audits.siteId, allowed))
          .limit(ROW_CAP)
      : Promise.resolve([]),
    can("change")
      ? db
          .select({
            id: changeRequests.id,
            title: changeRequests.title,
            status: changeRequests.status,
            requestedBy: changeRequests.requestedBy,
            createdAt: changeRequests.createdAt,
            updatedAt: changeRequests.updatedAt,
          })
          .from(changeRequests)
          .limit(ROW_CAP)
      : Promise.resolve([]),
    can("ppap")
      ? db
          .select({
            id: ppapPackages.id,
            partNumber: ppapPackages.partNumber,
            partName: ppapPackages.partName,
            status: ppapPackages.status,
            ownerId: ppapPackages.ownerId,
            createdAt: ppapPackages.createdAt,
          })
          .from(ppapPackages)
          .limit(ROW_CAP)
      : Promise.resolve([]),
    can("scar")
      ? db
          .select({
            id: scarForms.id,
            supplierName: scarForms.supplierName,
            linkedName: suppliers.name,
            status: scarForms.status,
            responseDueDate: scarForms.responseDueDate,
            containmentPlan: scarForms.containmentPlan,
            why1: scarForms.why1,
            supplierRepSignature: scarForms.supplierRepSignature,
            createdBy: scarForms.createdBy,
            scarNumber: scarForms.scarNumber,
            partNumberDescription: scarForms.partNumberDescription,
            defectDescription: scarForms.defectDescription,
            correctiveActionOwner: scarForms.correctiveActionOwner,
            createdAt: scarForms.createdAt,
            updatedAt: scarForms.updatedAt,
          })
          .from(scarForms)
          .leftJoin(suppliers, eq(suppliers.id, scarForms.supplierId))
          .limit(ROW_CAP)
      : Promise.resolve([]),
    db.select({ id: users.id, name: users.name }).from(users),
    can("calibration") ? listEquipmentWithSummary(db) : Promise.resolve([]),
    can("documents")
      ? db
          .select({
            id: validationReports.id,
            data: validationReports.data,
            createdAt: validationReports.createdAt,
            updatedAt: validationReports.updatedAt,
          })
          .from(validationReports)
          .orderBy(asc(validationReports.createdAt))
          .limit(ROW_CAP)
      : Promise.resolve([]),
    can("documents")
      ? db
          .select({
            id: isoQualityForms.id,
            formType: isoQualityForms.formType,
            data: isoQualityForms.data,
            createdAt: isoQualityForms.createdAt,
            updatedAt: isoQualityForms.updatedAt,
          })
          .from(isoQualityForms)
          .where(inArray(isoQualityForms.formType, [...OPEN_FORM_TYPES]))
          .orderBy(asc(isoQualityForms.createdAt))
          .limit(ROW_CAP)
      : Promise.resolve([]),
    can("risk")
      ? db
          .select({
            id: riskAssessments.id,
            title: riskAssessments.title,
            status: riskAssessments.status,
            ownerId: riskAssessments.ownerId,
            createdAt: riskAssessments.createdAt,
            updatedAt: riskAssessments.updatedAt,
          })
          .from(riskAssessments)
          .where(ne(riskAssessments.status, "closed"))
          .orderBy(asc(riskAssessments.createdAt))
          .limit(ROW_CAP)
      : Promise.resolve([]),
    can("work_orders")
      ? db
          .select({
            id: workOrders.id,
            status: workOrders.status,
            notes: workOrders.notes,
            createdBy: workOrders.createdBy,
            createdAt: workOrders.createdAt,
            updatedAt: workOrders.updatedAt,
            sku: inventoryItems.sku,
            description: inventoryItems.description,
          })
          .from(workOrders)
          .leftJoin(inventoryItems, eq(inventoryItems.id, workOrders.itemId))
          .where(inArray(workOrders.status, ["planned", "in_progress"]))
          .orderBy(asc(workOrders.createdAt))
          .limit(ROW_CAP)
      : Promise.resolve([]),
  ]);

  for (const rows of [ncrRows, capaRows, docRows, assignmentRows, auditRows, changeRows, ppapRows, scarRows, validationRows, isoRows, riskRows, workOrderRows]) {
    if (rows.length >= ROW_CAP) truncated.value = true;
  }

  const auditList = cap(auditRows, truncated) as DashAudit[];
  const itemRows =
    can("audit") && auditList.length > 0
      ? await db
          .select({ id: auditItems.id, auditId: auditItems.auditId, severity: auditItems.severity, finding: auditItems.finding })
          .from(auditItems)
          .where(inArray(auditItems.auditId, auditList.map((row) => row.id)))
          .limit(ROW_CAP)
      : [];
  if (itemRows.length >= ROW_CAP) truncated.value = true;

  const visibleActivity = await visibleEntityTypes(db, user);
  const activityRows = await db
    .select({
      id: auditTrail.id,
      entityType: auditTrail.entityType,
      entityId: auditTrail.entityId,
      action: auditTrail.action,
      changes: auditTrail.changes,
      performedBy: auditTrail.performedBy,
      createdAt: auditTrail.createdAt,
    })
    .from(auditTrail)
    .orderBy(desc(auditTrail.createdAt))
    .limit(ACTIVITY_SCAN);

  const ncrSite = new Map(ncrRows.map((row) => [row.id, row.siteId]));
  const capaSite = new Map(capaRows.map((row) => [row.id, row.siteId]));
  const auditSite = new Map(auditList.map((row) => [row.id, row.siteId]));
  const activity: DashActivity[] = [];
  for (const row of activityRows) {
    let siteId: number | null = null;
    if (SITE_SCOPED_ACTIVITY.has(row.entityType)) {
      const found = row.entityType === "NCR" ? ncrSite.get(row.entityId) : row.entityType === "CAPA" ? capaSite.get(row.entityId) : auditSite.get(row.entityId);
      if (found == null) continue;
      siteId = found;
    }
    if (!canSeeCompanyAuditRow(visibleActivity, row, user.id)) continue;
    activity.push({
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      title: titleFrom(row.changes),
      performedBy: row.performedBy,
      createdAt: row.createdAt,
      siteId,
    });
    if (activity.length >= ACTIVITY_LIMIT) break;
  }

  const siteRefs: SiteRef[] = siteRows.map((row) => ({ id: row.id, name: row.name, code: row.code }));
  const kpiSites = siteRefs.filter((row) => kpiSiteIds.includes(row.id));
  const names: Record<number, string | null> = {};
  for (const person of people) names[person.id] = person.name;
  const now = new Date();

  const source: DashboardSource = {
    now,
    userId: user.id,
    scope: { allPlants: opts.allPlants, siteIds: kpiSiteIds, sites: kpiSites },
    comparisonSites: siteRefs,
    access: {
      ncr: can("ncr"),
      capa: can("capa"),
      documents: can("documents"),
      training: can("training"),
      audit: can("audit"),
      calibration: can("calibration"),
      change: can("change"),
      ppap: can("ppap"),
      scar: can("scar"),
      approveDocuments: levelOf.documents === "edit",
      recordCalibration: levelOf.calibration === "edit",
    },
    ncrs: cap(ncrRows, truncated),
    capas: cap(capaRows, truncated),
    documents: cap(docRows, truncated),
    assignments: cap(assignmentRows, truncated),
    userSites: membershipRows,
    equipment: equipmentRows.map((row) => ({ id: row.id, name: row.name, dueStatus: row.dueStatus, nextDueAt: row.nextDueAt })),
    audits: auditList,
    auditItems: itemRows as DashAuditItem[],
    changes: cap(changeRows, truncated),
    ppaps: cap(ppapRows, truncated),
    scars: cap(scarRows, truncated).map((row) => ({
      id: row.id,
      supplierName: row.supplierName?.trim() || row.linkedName?.trim() || "Supplier",
      status: row.status,
      responseDueDate: row.responseDueDate,
      containmentPlan: row.containmentPlan,
      why1: row.why1,
      supplierRepSignature: row.supplierRepSignature,
      createdBy: row.createdBy,
    })),
    activity,
    names,
    partial: truncated.value,
  };

  const overview = buildDashboardOverview(source);
  const openWork = buildOpenWork({
    now,
    allPlants: opts.allPlants,
    siteIds: kpiSiteIds,
    sites: kpiSites.map((site) => ({ id: site.id, name: site.name })),
    access: {
      ncr: can("ncr"),
      capa: can("capa"),
      scar: can("scar"),
      documents: can("documents"),
      change: can("change"),
      ppap: can("ppap"),
      risk: can("risk"),
      workOrders: can("work_orders"),
      calibration: can("calibration"),
      training: can("training"),
    },
    names,
    userSites: membershipRows,
    ncrs: cap(ncrRows, truncated),
    capas: cap(capaRows, truncated),
    scars: cap(scarRows, truncated).map((row) => ({
      id: row.id,
      status: row.status,
      scarNumber: row.scarNumber,
      supplierName: row.supplierName?.trim() || row.linkedName?.trim() || null,
      partNumberDescription: row.partNumberDescription,
      defectDescription: row.defectDescription,
      correctiveActionOwner: row.correctiveActionOwner,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    changes: cap(changeRows, truncated),
    ppaps: cap(ppapRows, truncated),
    risks: cap(riskRows, truncated),
    workOrders: cap(workOrderRows, truncated),
    validation: cap(validationRows, truncated).map((row) => ({ ...row, formType: "validation" })),
    forms: cap(isoRows, truncated),
    assignments: cap(assignmentRows, truncated),
    equipment: equipmentRows.map((row) => ({ dueStatus: row.dueStatus })),
  });

  return { ...overview, openWork };
}
