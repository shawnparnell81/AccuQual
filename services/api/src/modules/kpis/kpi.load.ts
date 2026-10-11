import { eq, sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { audits, auditItems } from "../../drizzle/schema/audits.js";
import { laborClaims } from "../../drizzle/schema/laborClaims.js";
import { scarForms } from "../../drizzle/schema/scarForms.js";
import { trainingAssignments, trainingCourses } from "../../drizzle/schema/training.js";
import { userSites, sites } from "../../drizzle/schema/sites.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { listEquipmentWithSummary } from "../calibration/calibration.service.js";
import { faiOutcome } from "../executive/executive.data.js";
import { optionalRows } from "../sites/optionalSql.js";
import { asDate, isAuditFinding } from "./kpi.model.js";
import type { KpiEvent, KpiSource } from "./kpi.compute.js";

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function rowsOf<T extends Record<string, unknown>>(db: Db, statement: ReturnType<typeof sql>): Promise<T[]> {
  return (await optionalRows<T>(db, statement)) ?? [];
}

export async function loadPlants(db: Db): Promise<{ id: number; name: string }[]> {
  const rows = await db.select({ id: sites.id, name: sites.name, status: sites.status, deletedAt: sites.deletedAt }).from(sites);
  return rows.filter((row) => row.deletedAt == null && row.status === "active").map((row) => ({ id: row.id, name: row.name }));
}

export async function loadPeople(db: Db): Promise<{ id: number; name: string | null; roleName: string | null }[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, roleName: roles.name, isActive: users.isActive })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id));
  return rows.filter((row) => row.isActive).map((row) => ({ id: row.id, name: row.name, roleName: row.roleName }));
}

export async function loadKpiSource(db: Db, now: Date): Promise<KpiSource> {
  const [ncrRows, capaRows, auditRows, itemRows, laborRows, scarRows, assignmentRows, courseRows, memberships, gages] = await Promise.all([
    db
      .select({
        id: ncr.id,
        siteId: ncr.siteId,
        status: ncr.status,
        createdAt: ncr.createdAt,
        closedAt: ncr.closedAt,
        supplierId: ncr.supplierId,
        recordNumber: ncr.recordNumber,
        title: ncr.title,
      })
      .from(ncr)
      .where(eq(ncr.isDeleted, false)),
    db
      .select({
        id: capa.id,
        siteId: capa.siteId,
        status: capa.status,
        createdAt: capa.createdAt,
        closedAt: capa.closedAt,
        dueAt: capa.dueDate,
        recordNumber: capa.recordNumber,
        title: capa.actionPlan,
      })
      .from(capa),
    db.select({ id: audits.id, siteId: audits.siteId }).from(audits),
    db.select({ id: auditItems.id, auditId: auditItems.auditId, severity: auditItems.severity, finding: auditItems.finding, createdAt: auditItems.createdAt }).from(auditItems),
    db
      .select({
        id: laborClaims.id,
        siteId: laborClaims.siteId,
        status: laborClaims.status,
        claimNumber: laborClaims.claimNumber,
        partName: laborClaims.partName,
        cost: laborClaims.totalLaborCost,
        createdAt: laborClaims.createdAt,
      })
      .from(laborClaims),
    db.select({ id: scarForms.id, scarNumber: scarForms.scarNumber, supplierName: scarForms.supplierName, status: scarForms.status, createdAt: scarForms.createdAt }).from(scarForms),
    db
      .select({
        id: trainingAssignments.id,
        userId: trainingAssignments.userId,
        status: trainingAssignments.status,
        dueAt: trainingAssignments.dueAt,
        courseId: trainingAssignments.courseId,
      })
      .from(trainingAssignments),
    db.select({ id: trainingCourses.id, title: trainingCourses.title }).from(trainingCourses),
    db.select({ userId: userSites.userId, siteId: userSites.siteId }).from(userSites),
    listEquipmentWithSummary(db),
  ]);

  const courseTitle = new Map(courseRows.map((course) => [course.id, course.title]));
  const auditSite = new Map(auditRows.map((audit) => [audit.id, audit.siteId]));

  const complaints = await loadComplaints(db);
  const warranties = await loadWarranties(db);
  const fai = await loadFai(db);

  return {
    now,
    ncrs: ncrRows.map((row) => ({
      id: row.id,
      siteId: row.siteId,
      status: row.status,
      createdAt: asDate(row.createdAt),
      closedAt: asDate(row.closedAt),
      supplierId: row.supplierId,
      recordNumber: row.recordNumber,
      title: row.title,
    })),
    capas: capaRows.map((row) => ({
      id: row.id,
      siteId: row.siteId,
      status: row.status,
      createdAt: asDate(row.createdAt),
      closedAt: asDate(row.closedAt),
      dueAt: asDate(row.dueAt),
      recordNumber: row.recordNumber,
      title: row.title ?? "",
    })),
    complaints,
    warranties,
    labor: laborRows.map((row) => ({
      id: row.id,
      siteId: row.siteId,
      at: asDate(row.createdAt),
      recordNumber: row.claimNumber,
      title: row.partName?.trim() || "Labor claim",
      status: row.status,
      href: `/labor-claims/${row.id}`,
      module: "labor_claims",
      cost: num(row.cost),
    })),
    findings: itemRows.flatMap((item) => {
      if (!isAuditFinding(item.severity, item.finding)) return [];
      return [
        {
          id: item.id,
          siteId: auditSite.get(item.auditId) ?? null,
          at: asDate(item.createdAt),
          recordNumber: null,
          title: item.finding?.trim() || "Audit finding",
          status: item.severity?.trim() || "finding",
          href: `/audits/${item.auditId}`,
          module: "audit",
        },
      ];
    }),
    fai,
    scars: scarRows.map((row) => ({
      id: row.id,
      siteId: null,
      at: asDate(row.createdAt),
      recordNumber: row.scarNumber,
      title: row.supplierName?.trim() || "SCAR",
      status: row.status,
      href: `/scar-forms/${row.id}`,
      module: "scar",
    })),
    assignments: assignmentRows.map((row) => ({
      id: row.id,
      userId: row.userId,
      status: row.status,
      dueAt: asDate(row.dueAt),
      courseTitle: courseTitle.get(row.courseId) ?? null,
    })),
    userSites: memberships,
    gageStatuses: gages.map((gage) => gage.dueStatus),
  };
}

async function loadComplaints(db: Db): Promise<KpiEvent[]> {
  const events: KpiEvent[] = [];
  const complaints = await rowsOf<{ id: number; site_id: number | null; status: string; record_number: string | null; customer_name: string | null; description: string | null; created_at: Date | string | null }>(
    db,
    sql`SELECT id, site_id, status, record_number, customer_name, description, created_at FROM complaints`,
  );
  for (const row of complaints) {
    events.push({
      id: Number(row.id),
      siteId: num(row.site_id),
      at: asDate(row.created_at),
      recordNumber: text(row.record_number),
      title: text(row.customer_name) ?? text(row.description) ?? "Customer complaint",
      status: row.status,
      href: `/complaints/${row.id}`,
      module: "complaints",
    });
  }
  const iso = await rowsOf<{ id: number; site_id: number | null; record_number: string | null; created_at: Date | string | null }>(
    db,
    sql`SELECT id, site_id, record_number, created_at FROM iso_quality_forms WHERE form_type ILIKE '%complaint%'`,
  );
  for (const row of iso) {
    events.push({
      id: Number(row.id),
      siteId: num(row.site_id),
      at: asDate(row.created_at),
      recordNumber: text(row.record_number),
      title: "Customer complaint",
      status: "open",
      href: `/iso-forms/record/${row.id}`,
      module: "documents",
    });
  }
  const qms = await rowsOf<{ id: number; site_id: number | null; form_type: string; record_number: string | null; created_at: Date | string | null }>(
    db,
    sql`SELECT id, site_id, form_type, form_no AS record_number, created_at FROM qms_forms WHERE form_type ILIKE '%complaint%' AND status IS DISTINCT FROM 'obsolete'`,
  );
  for (const row of qms) {
    events.push({
      id: Number(row.id),
      siteId: num(row.site_id),
      at: asDate(row.created_at),
      recordNumber: text(row.record_number),
      title: "Customer complaint",
      status: "open",
      href: `/qms-forms/${encodeURIComponent(row.form_type)}/${row.id}`,
      module: "qms_forms",
    });
  }
  const filed = await rowsOf<{ id: number; entity_type: string | null; entity_id: number | null; site_id: number | null; record_number: string | null; title: string | null; created_at: Date | string | null }>(
    db,
    sql`
      SELECT f.id, f.entity_type, f.entity_id, n.site_id, n.record_number, n.title, f.created_at
      FROM form_data f
      LEFT JOIN ncr n ON f.entity_type = 'ncr' AND f.entity_id = n.id
      WHERE f.form_type = 'complaint'
    `,
  );
  for (const row of filed) {
    const ncrId = row.entity_type === "ncr" && row.entity_id != null ? Number(row.entity_id) : null;
    events.push({
      id: Number(row.id),
      siteId: num(row.site_id),
      at: asDate(row.created_at),
      recordNumber: text(row.record_number),
      title: text(row.title) ?? "Customer complaint",
      status: "open",
      href: ncrId == null ? null : `/ncr/${ncrId}`,
      module: ncrId == null ? null : "ncr",
    });
  }
  return events;
}

async function loadWarranties(db: Db): Promise<KpiEvent[]> {
  const events: KpiEvent[] = [];
  const claims = await rowsOf<{ id: number; site_id: number | null; claim_number: string | null; failure_description: string | null; status: string; created_at: Date | string | null; warranty_actual_cost: string | number | null }>(
    db,
    sql`SELECT id, site_id, claim_number, failure_description, status, created_at, warranty_actual_cost FROM warranty_claims`,
  );
  for (const row of claims) {
    events.push({
      id: Number(row.id),
      siteId: num(row.site_id),
      at: asDate(row.created_at),
      recordNumber: text(row.claim_number),
      title: text(row.failure_description) ?? "Warranty claim",
      status: row.status,
      href: `/warranty/${row.id}`,
      module: "warranty",
      cost: num(row.warranty_actual_cost) ?? 0,
    });
  }
  const iso = await rowsOf<{ id: number; site_id: number | null; record_number: string | null; created_at: Date | string | null }>(
    db,
    sql`SELECT id, site_id, record_number, created_at FROM iso_quality_forms WHERE form_type ILIKE '%warranty%'`,
  );
  for (const row of iso) {
    events.push({
      id: Number(row.id),
      siteId: num(row.site_id),
      at: asDate(row.created_at),
      recordNumber: text(row.record_number),
      title: "Warranty claim",
      status: "open",
      href: `/iso-forms/record/${row.id}`,
      module: "documents",
    });
  }
  const qms = await rowsOf<{ id: number; site_id: number | null; form_type: string; record_number: string | null; created_at: Date | string | null }>(
    db,
    sql`SELECT id, site_id, form_type, form_no AS record_number, created_at FROM qms_forms WHERE form_type ILIKE '%warranty%' AND status IS DISTINCT FROM 'obsolete'`,
  );
  for (const row of qms) {
    events.push({
      id: Number(row.id),
      siteId: num(row.site_id),
      at: asDate(row.created_at),
      recordNumber: text(row.record_number),
      title: "Warranty claim",
      status: "open",
      href: `/qms-forms/${encodeURIComponent(row.form_type)}/${row.id}`,
      module: "qms_forms",
    });
  }
  return events;
}

async function loadFai(db: Db): Promise<KpiEvent[]> {
  const events: KpiEvent[] = [];
  const validations = await rowsOf<{ id: number; site_id: number | null; record_number: string | null; created_at: Date | string | null; data: unknown }>(
    db,
    sql`SELECT id, site_id, record_number, created_at, data FROM validation_reports`,
  );
  for (const row of validations) {
    const outcome = faiOutcome("", null, false, JSON.stringify(row.data ?? {}));
    events.push({
      id: Number(row.id),
      siteId: num(row.site_id),
      at: asDate(row.created_at),
      recordNumber: text(row.record_number),
      title: "Validation report",
      status: outcome,
      href: `/validation-reports/${row.id}`,
      module: "documents",
      outcome,
    });
  }
  const firstArticles = await rowsOf<{ id: number; site_id: number | null; record_number: string | null; created_at: Date | string | null; data: unknown }>(
    db,
    sql`SELECT id, site_id, record_number, created_at, data FROM iso_quality_forms WHERE form_type = 'first_article'`,
  );
  for (const row of firstArticles) {
    const outcome = faiOutcome("", null, false, JSON.stringify(row.data ?? {}));
    events.push({
      id: Number(row.id),
      siteId: num(row.site_id),
      at: asDate(row.created_at),
      recordNumber: text(row.record_number),
      title: "First Article Inspection",
      status: outcome,
      href: `/iso-forms/record/${row.id}`,
      module: "documents",
      outcome,
    });
  }
  return events;
}
