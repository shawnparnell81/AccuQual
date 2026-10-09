import { describe, expect, it } from "vitest";
import { buildDashboardOverview, type DashboardSource, type SiteRef } from "../src/modules/dashboard/dashboard.metrics.js";

const NOW = new Date("2026-09-24T15:00:00.000Z");
const DAY = 86_400_000;

const plants: SiteRef[] = [
  { id: 1, name: "Dayton Machining", code: "DAY" },
  { id: 2, name: "Greenville Stamping", code: "GVL" },
];

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function source(overrides: Partial<DashboardSource> = {}): DashboardSource {
  return {
    now: NOW,
    userId: 7,
    scope: { allPlants: true, siteIds: [1, 2], sites: plants },
    comparisonSites: plants,
    access: {
      ncr: true,
      capa: true,
      documents: true,
      training: true,
      audit: true,
      calibration: true,
      change: true,
      ppap: true,
      scar: true,
      approveDocuments: true,
      recordCalibration: true,
    },
    ncrs: [],
    capas: [],
    documents: [],
    assignments: [],
    userSites: [],
    equipment: [],
    audits: [],
    auditItems: [],
    changes: [],
    ppaps: [],
    scars: [],
    activity: [],
    names: { 7: "Dana Wells" },
    partial: false,
    ...overrides,
  };
}

describe("dashboard overview", () => {
  it("counts open issues and leaves closed or deleted ones out", () => {
    const overview = buildDashboardOverview(
      source({
        ncrs: [
          { id: 1, siteId: 1, title: "Burr", status: "open", severity: "high", assignedTo: 7, dueDate: null, closedAt: null, createdAt: daysAgo(1), rootCause: null, isDeleted: false },
          { id: 2, siteId: 1, title: "Scratch", status: "investigating", severity: "critical", assignedTo: null, dueDate: null, closedAt: null, createdAt: daysAgo(2), rootCause: null, isDeleted: false },
          { id: 3, siteId: 1, title: "Done", status: "closed", severity: "high", assignedTo: null, dueDate: null, closedAt: daysAgo(1), createdAt: daysAgo(10), rootCause: null, isDeleted: false },
          { id: 4, siteId: 1, title: "Gone", status: "open", severity: "critical", assignedTo: null, dueDate: null, closedAt: null, createdAt: daysAgo(1), rootCause: null, isDeleted: true },
          { id: 5, siteId: 2, title: "Low", status: "open", severity: "low", assignedTo: null, dueDate: null, closedAt: null, createdAt: daysAgo(3), rootCause: null, isDeleted: false },
        ],
      }),
    );
    expect(overview.kpis.openIssues).toMatchObject({ access: true, value: 3, highCritical: 2 });
    expect(overview.kpis.openIssues.spark).toHaveLength(8);
    expect(overview.kpis.openIssues.spark.at(-1)).toBe(3);
    expect(overview.scope.label).toBe("All plants");
  });

  it("counts only fixes that are still open and past their due date", () => {
    const overview = buildDashboardOverview(
      source({
        capas: [
          { id: 1, siteId: 1, ncrId: 1, status: "open", ownerId: 7, dueDate: daysAgo(3), closedAt: null, createdAt: daysAgo(20), actionPlan: "Rework the fixture", rootCause: null },
          { id: 2, siteId: 1, ncrId: null, status: "in_progress", ownerId: null, dueDate: new Date(NOW.getTime() + 5 * DAY), closedAt: null, createdAt: daysAgo(2), actionPlan: null, rootCause: null },
          { id: 3, siteId: 1, ncrId: null, status: "closed", ownerId: null, dueDate: daysAgo(1), closedAt: daysAgo(1), createdAt: daysAgo(30), actionPlan: null, rootCause: null },
          { id: 4, siteId: 1, ncrId: null, status: "open", ownerId: null, dueDate: null, closedAt: null, createdAt: daysAgo(1), actionPlan: null, rootCause: null },
        ],
      }),
    );
    expect(overview.kpis.overdueFixes).toMatchObject({ access: true, value: 1, openTotal: 3 });
  });

  it("counts documents waiting for approval and ones inside their review window", () => {
    const overview = buildDashboardOverview(
      source({
        documents: [
          { id: 1, title: "SOP-1", status: "in_review", ownerId: 7, expirationDate: null, expirationWarningDays: 30, revisionCode: "Rev B", isDeleted: false },
          { id: 2, title: "SOP-2", status: "approved", ownerId: null, expirationDate: new Date(NOW.getTime() + 10 * DAY), expirationWarningDays: 30, revisionCode: "Rev A", isDeleted: false },
          { id: 3, title: "Old", status: "approved", ownerId: null, expirationDate: new Date(NOW.getTime() + 90 * DAY), expirationWarningDays: 30, revisionCode: null, isDeleted: false },
          { id: 4, title: "Retired", status: "obsolete", ownerId: null, expirationDate: daysAgo(1), expirationWarningDays: 30, revisionCode: null, isDeleted: false },
          { id: 5, title: "Removed", status: "in_review", ownerId: null, expirationDate: null, expirationWarningDays: 30, revisionCode: null, isDeleted: true },
        ],
      }),
    );
    expect(overview.kpis.docsDue).toMatchObject({ access: true, value: 2, waitingApproval: 1, companyWide: true });
  });

  it("reports training as a percent of real assignments, and leaves it blank when there are none", () => {
    const withRows = buildDashboardOverview(
      source({
        assignments: [
          { id: 1, courseId: 4, courseTitle: "Torque", userId: 7, status: "completed", dueAt: daysAgo(1) },
          { id: 2, courseId: 5, courseTitle: "Gages", userId: 8, status: "assigned", dueAt: daysAgo(2) },
        ],
        userSites: [
          { userId: 7, siteId: 1 },
          { userId: 8, siteId: 1 },
        ],
      }),
    );
    expect(withRows.kpis.training).toMatchObject({ access: true, percent: 50, overdue: 1, assigned: 2 });

    const empty = buildDashboardOverview(source());
    expect(empty.kpis.training).toMatchObject({ access: true, percent: null, overdue: 0, assigned: 0 });
  });

  it("limits a single plant's training to people who work there", () => {
    const overview = buildDashboardOverview(
      source({
        scope: { allPlants: false, siteIds: [1], sites: [plants[0]!] },
        assignments: [
          { id: 1, courseId: 4, courseTitle: "Torque", userId: 7, status: "completed", dueAt: null },
          { id: 2, courseId: 5, courseTitle: "Press", userId: 9, status: "assigned", dueAt: daysAgo(1) },
        ],
        userSites: [
          { userId: 7, siteId: 1 },
          { userId: 9, siteId: 2 },
        ],
      }),
    );
    expect(overview.scope.label).toBe("Dayton Machining");
    expect(overview.kpis.training).toMatchObject({ percent: 100, overdue: 0, assigned: 1 });
    expect(overview.plants.find((plant) => plant.id === 2)).toMatchObject({ trainingPercent: 0, trainingOverdue: 1, openIssues: 0 });
  });

  it("counts gages that are overdue, failed, or due within 30 days", () => {
    const overview = buildDashboardOverview(
      source({
        equipment: [
          { id: 1, name: "Caliper", dueStatus: "overdue", nextDueAt: daysAgo(4) },
          { id: 2, name: "CMM", dueStatus: "failed", nextDueAt: null },
          { id: 3, name: "Mic", dueStatus: "due_soon", nextDueAt: new Date(NOW.getTime() + 10 * DAY) },
          { id: 4, name: "Height", dueStatus: "current", nextDueAt: new Date(NOW.getTime() + 100 * DAY) },
        ],
      }),
    );
    expect(overview.kpis.calibration).toMatchObject({ access: true, value: 3, overdue: 1, failed: 1, dueSoon: 1, companyWide: true });
    expect(overview.gagesByPlant).toBe(false);
  });

  it("counts audit findings from real checklist rows and ignores blank ones", () => {
    const overview = buildDashboardOverview(
      source({
        audits: [
          { id: 10, siteId: 1, name: "Internal", status: "in_progress", auditorId: 7, scheduledAt: daysAgo(1) },
          { id: 11, siteId: 2, name: "Other plant", status: "scheduled", auditorId: null, scheduledAt: null },
        ],
        auditItems: [
          { id: 1, auditId: 10, severity: "major", finding: "Missing record" },
          { id: 2, auditId: 10, severity: "observation", finding: "Label faded" },
          { id: 3, auditId: 10, severity: null, finding: "No torque spec" },
          { id: 4, auditId: 10, severity: null, finding: "   " },
          { id: 5, auditId: 99, severity: "critical", finding: "Not in scope" },
        ],
      }),
    );
    expect(overview.kpis.auditFindings).toMatchObject({ access: true, value: 2, total: 3 });
  });

  it("places issues opened and closed into the last 12 weeks", () => {
    const overview = buildDashboardOverview(
      source({
        ncrs: [
          { id: 1, siteId: 1, title: "New", status: "open", severity: "low", assignedTo: null, dueDate: null, closedAt: null, createdAt: daysAgo(1), rootCause: null, isDeleted: false },
          { id: 2, siteId: 1, title: "Older", status: "closed", severity: "low", assignedTo: null, dueDate: null, closedAt: daysAgo(8), createdAt: daysAgo(8), rootCause: null, isDeleted: false },
          { id: 3, siteId: 1, title: "Ancient", status: "closed", severity: "low", assignedTo: null, dueDate: null, closedAt: daysAgo(200), createdAt: daysAgo(200), rootCause: "worn tool", isDeleted: false },
        ],
      }),
    );
    expect(overview.trend.labels).toHaveLength(12);
    expect(overview.trend.opened.at(-1)).toBe(1);
    expect(overview.trend.opened.at(-2)).toBe(1);
    expect(overview.trend.closed.at(-2)).toBe(1);
    expect(overview.trend.opened.reduce((sum, n) => sum + n, 0)).toBe(2);
  });

  it("ages open work and groups recorded root causes without inventing a blank bucket", () => {
    const overview = buildDashboardOverview(
      source({
        ncrs: [
          { id: 1, siteId: 1, title: "A", status: "open", severity: "low", assignedTo: null, dueDate: null, closedAt: null, createdAt: daysAgo(3), rootCause: "Burr", isDeleted: false },
          { id: 2, siteId: 1, title: "B", status: "open", severity: "low", assignedTo: null, dueDate: null, closedAt: null, createdAt: daysAgo(40), rootCause: "Burr", isDeleted: false },
          { id: 3, siteId: 1, title: "C", status: "open", severity: "low", assignedTo: null, dueDate: null, closedAt: null, createdAt: daysAgo(10), rootCause: "   ", isDeleted: false },
          { id: 4, siteId: 1, title: "D", status: "closed", severity: "low", assignedTo: null, dueDate: null, closedAt: daysAgo(1), createdAt: daysAgo(90), rootCause: "Handling", isDeleted: false },
        ],
        capas: [{ id: 1, siteId: 1, ncrId: null, status: "open", ownerId: null, dueDate: null, closedAt: null, createdAt: daysAgo(70), actionPlan: null, rootCause: null }],
      }),
    );
    expect(overview.aging.categories).toEqual(["0–7d", "8–30d", "31–60d", "60d+"]);
    expect(overview.aging.issues).toEqual([1, 1, 1, 0]);
    expect(overview.aging.fixes).toEqual([0, 0, 0, 1]);
    expect(overview.pareto.items).toEqual([
      { label: "Burr", value: 2 },
      { label: "Handling", value: 1 },
    ]);
    expect(overview.pareto.basis).toBe("root-cause");
  });

  it("lists this person's work and what is stuck, and hides modules they cannot read", () => {
    const overview = buildDashboardOverview(
      source({
        ncrs: [
          { id: 1, siteId: 1, title: "Mine", status: "open", severity: "high", assignedTo: 7, dueDate: daysAgo(1), closedAt: null, createdAt: daysAgo(40), rootCause: null, isDeleted: false },
          { id: 2, siteId: 1, title: "Theirs", status: "open", severity: "low", assignedTo: 8, dueDate: daysAgo(2), closedAt: null, createdAt: daysAgo(2), rootCause: null, isDeleted: false },
        ],
        names: { 7: "Dana Wells", 8: "Tom Becker" },
        access: {
          ncr: true,
          capa: false,
          documents: false,
          training: false,
          audit: false,
          calibration: false,
          change: false,
          ppap: false,
          scar: false,
          approveDocuments: false,
          recordCalibration: false,
        },
        capas: [{ id: 9, siteId: 1, ncrId: null, status: "open", ownerId: 7, dueDate: daysAgo(4), closedAt: null, createdAt: daysAgo(4), actionPlan: "Secret", rootCause: null }],
      }),
    );
    expect(overview.tasks.map((task) => task.ref)).toEqual([""]);
    expect(overview.tasks[0]?.href).toBe("/ncr/1");
    expect(overview.tasks[0]?.ref).not.toBe("NCR-1");
    expect(overview.stuck).toEqual([
      expect.objectContaining({ ref: "", href: "/ncr/1", tone: "warn", who: "Dana Wells", why: "open for 40 days" }),
    ]);
    expect(overview.kpis.overdueFixes.access).toBe(false);
    expect(overview.kpis.overdueFixes.value).toBeNull();
    expect(overview.kpis.calibration.value).toBeNull();
    expect(overview.engineering.changes.open).toBeNull();
    expect(overview.engineering.deviations).toEqual({ available: false, reason: "Deviations aren't tracked yet." });
    expect(overview.engineering.apqp.available).toBe(false);
  });

  it("counts open change requests and PPAPs that are still with the customer", () => {
    const overview = buildDashboardOverview(
      source({
        changes: [
          { id: 1, title: "Fixture", status: "under_review" },
          { id: 2, title: "Print", status: "approved" },
          { id: 3, title: "Done", status: "implemented" },
          { id: 4, title: "No", status: "rejected" },
        ],
        ppaps: [
          { id: 1, partNumber: "P-1", partName: "Bracket", status: "submitted" },
          { id: 2, partNumber: "P-2", partName: null, status: "open" },
          { id: 3, partNumber: "P-3", partName: null, status: "approved" },
        ],
      }),
    );
    expect(overview.engineering.changes).toMatchObject({ access: true, open: 2, inReview: 1, approved: 1 });
    expect(overview.engineering.ppap).toMatchObject({ access: true, pending: 2, awaitingCustomer: 1 });
  });

  it("keeps recent activity inside the plants and modules this person can see", () => {
    const overview = buildDashboardOverview(
      source({
        scope: { allPlants: false, siteIds: [1], sites: [plants[0]!] },
        ncrs: [{ id: 4, siteId: 1, title: "Burr", status: "open", severity: "high", assignedTo: 7, dueDate: null, closedAt: null, createdAt: daysAgo(1), rootCause: null, isDeleted: false }],
        documents: [{ id: 3, title: "SOP", status: "approved", ownerId: null, expirationDate: null, expirationWarningDays: 30, revisionCode: null, isDeleted: false }],
        activity: [
          { id: 1, entityType: "NCR", entityId: 4, action: "create", title: "Burr", performedBy: 7, createdAt: daysAgo(1), siteId: 1 },
          { id: 2, entityType: "NCR", entityId: 5, action: "create", title: "Other plant", performedBy: 8, createdAt: daysAgo(1), siteId: 2 },
          { id: 3, entityType: "WorkflowDefinition", entityId: 1, action: "update", title: "Hidden", performedBy: 7, createdAt: daysAgo(1), siteId: null },
          { id: 4, entityType: "Document", entityId: 3, action: "status_change", title: "SOP", performedBy: null, createdAt: daysAgo(2), siteId: null },
        ],
      }),
    );
    expect(overview.activity.map((row) => row.id)).toEqual([1, 4]);
    expect(overview.activity[0]).toMatchObject({ text: "Issue added: Burr", href: "/ncr/4", by: "Dana Wells" });
    expect(overview.activity[1]?.by).toBe("Unassigned");
  });

  it("does not link recent activity to a record that has been deleted", () => {
    const overview = buildDashboardOverview(
      source({
        equipment: [{ id: 1, name: "Caliper", dueStatus: "current", nextDueAt: null }],
        activity: [
          { id: 1, entityType: "Equipment", entityId: 2, action: "delete", title: "Bench", performedBy: 7, createdAt: daysAgo(1), siteId: null },
          { id: 2, entityType: "Equipment", entityId: 1, action: "update", title: "Caliper", performedBy: 7, createdAt: daysAgo(1), siteId: null },
        ],
      }),
    );
    expect(overview.activity[0]?.href).toBeNull();
    expect(overview.activity[1]?.href).toBe("/calibration/1");
  });

  it("does not compare gages by plant", () => {
    const overview = buildDashboardOverview(source({ equipment: [{ id: 1, name: "Caliper", dueStatus: "overdue", nextDueAt: daysAgo(1) }] }));
    expect(overview.plants.every((plant) => !("gagesOverdue" in plant))).toBe(true);
    expect(overview.gagesByPlant).toBe(false);
  });
});
