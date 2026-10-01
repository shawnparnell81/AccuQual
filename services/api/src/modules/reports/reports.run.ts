import { eq, inArray } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import { getUserAccessLevel, type ResourceKey } from "../../middleware/departmentAccess.js";
import { users } from "../../drizzle/schema/users.js";
import { sites } from "../../drizzle/schema/sites.js";
import { formatUserLabel } from "../users/userDisplay.js";
import { ENTITY_TYPE_TO_RESOURCE } from "../audit-trail/auditTrailVisibility.js";
import { isFullAccessRole } from "../roles/roleAccess.js";
import {
  deliveryStubs,
  emptySection,
  REPORT_TEMPLATE_VERSION,
  reportTitle,
  resolvePlant,
  resolveRange,
  sectionAllows,
  tablesReady,
  templateFor,
  type QualityReport,
  type ReportKind,
} from "./reports.model.js";
import { loadPresentTables, loadReportSection, withReportGuard, type SectionContext } from "./reports.sections.js";

const ACCESS_KEYS = [
  "ncr",
  "capa",
  "suppliers",
  "inventory",
  "quality_inspection",
  "documents",
  "change",
  "training",
  "calibration",
  "ppap",
  "workflow",
  "audit",
] as const satisfies readonly ResourceKey[];

export interface RunReportInput {
  kind: ReportKind;
  from?: string;
  to?: string;
  plantId?: number | "all";
  now?: Date;
  user: { id: number; roleName: string | null; department: string | null };
  allowedSiteIds: number[];
  currentSiteId: number | null;
}

function readerOf(can: (resource: ResourceKey) => boolean): boolean {
  return can("audit") || ACCESS_KEYS.some((key) => can(key));
}

/** Same record types the audit log would show. Lookups stay on this request's one connection, in order. */
async function visibleAuditTypes(
  db: Db,
  user: RunReportInput["user"],
  known: Record<string, string>,
): Promise<Set<string> | "all"> {
  if (isFullAccessRole(user.roleName)) return "all";
  const allowed = new Set<ResourceKey>();
  for (const resource of new Set(Object.values(ENTITY_TYPE_TO_RESOURCE))) {
    const level = known[resource] ?? (await getUserAccessLevel(db, user, resource));
    if (level !== "none") allowed.add(resource);
  }
  const types = new Set<string>();
  for (const [entityType, resource] of Object.entries(ENTITY_TYPE_TO_RESOURCE)) {
    if (allowed.has(resource)) types.add(entityType);
  }
  return types;
}

/**
 * Builds one quality report from the live module tables. A section the person
 * cannot read is marked no_access. A section whose table is missing is skipped.
 * Nothing is written except the access log line.
 */
export async function runQualityReport(db: Db, input: RunReportInput): Promise<QualityReport> {
  const now = input.now ?? new Date();
  const levelOf = {} as Record<(typeof ACCESS_KEYS)[number], string>;
  for (const key of ACCESS_KEYS) levelOf[key] = await getUserAccessLevel(db, input.user, key);
  const can = (resource: ResourceKey) => (levelOf[resource as (typeof ACCESS_KEYS)[number]] ?? "none") !== "none";
  const reader = readerOf(can);

  if (!reader) {
    logger.info("report_access", { userId: input.user.id, kind: input.kind, outcome: "denied" });
    throw AppError.forbidden("You don't have access to the modules in this report.");
  }

  const range = resolveRange(input.kind, input.from, input.to, now);
  const present = await loadPresentTables(db);
  const siteRows = present.has("sites") && input.allowedSiteIds.length > 0
    ? await db.select({ id: sites.id, name: sites.name }).from(sites).where(inArray(sites.id, input.allowedSiteIds))
    : [];
  const plant = resolvePlant({
    plantId: input.plantId,
    allowedSiteIds: input.allowedSiteIds,
    currentSiteId: input.currentSiteId,
    sites: siteRows,
  });

  const [person] = await db
    .select({ name: users.name, email: users.email, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, input.user.id));

  const specs = templateFor(input.kind);
  const auditSpec = specs.find((spec) => spec.key === "audit_trail");
  const needsAudit = auditSpec != null && tablesReady(auditSpec, present);
  const visibleAudit = needsAudit ? await visibleAuditTypes(db, input.user, levelOf) : "none";

  const ctx: SectionContext = {
    db,
    from: range.from,
    to: range.to,
    now,
    siteIds: plant.siteIds,
    present,
    can,
    visibleAudit,
  };

  const sections = [];
  for (const spec of specs) {
    if (!sectionAllows(spec, can, reader)) {
      sections.push(emptySection(spec, "no_access", "You don't have access to this module."));
      continue;
    }
    if (!tablesReady(spec, present)) {
      sections.push(emptySection(spec, "skipped", "This section was skipped because a table it needs is not in the database."));
      continue;
    }
    const loaded = await withReportGuard(db, () => loadReportSection(spec, ctx));
    sections.push(loaded.ok ? loaded.value : emptySection(spec, "skipped", loaded.reason));
  }

  const report: QualityReport = {
    header: {
      templateVersion: REPORT_TEMPLATE_VERSION,
      templateKey: input.kind,
      type: input.kind,
      title: reportTitle(input.kind),
      dateRange: { from: range.from.toISOString(), to: range.to.toISOString() },
      plant: plant.plant,
      generatedAt: now.toISOString(),
      generatedBy: { id: input.user.id, name: formatUserLabel(person, input.user.id) },
    },
    sections,
    delivery: deliveryStubs(),
  };

  logger.info("report_access", {
    userId: input.user.id,
    kind: input.kind,
    outcome: "ok",
    plant: plant.plant.scope === "all" ? "all" : plant.plant.id,
    from: report.header.dateRange.from,
    to: report.header.dateRange.to,
    sections: sections.map((section) => `${section.key}:${section.status}`),
  });

  return report;
}
