import { describe, expect, it } from "vitest";
import { buildOpenWork, type OpenWorkInput } from "../src/modules/dashboard/dashboard.openWork.js";

const NOW = new Date("2026-09-24T15:00:00.000Z");
const DAY = 86_400_000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function input(overrides: Partial<OpenWorkInput> = {}): OpenWorkInput {
  return {
    now: NOW,
    allPlants: true,
    siteIds: [1, 2],
    sites: [
      { id: 1, name: "Dayton Machining" },
      { id: 2, name: "Greenville Stamping" },
    ],
    access: {
      ncr: true,
      capa: true,
      scar: true,
      documents: true,
      change: true,
      ppap: true,
      risk: true,
      workOrders: true,
      calibration: true,
      training: true,
    },
    names: { 7: "Dana Wells" },
    userSites: [
      { userId: 7, siteId: 1 },
      { userId: 8, siteId: 2 },
    ],
    ncrs: [],
    capas: [],
    scars: [],
    changes: [],
    ppaps: [],
    risks: [],
    workOrders: [],
    validation: [],
    forms: [],
    assignments: [],
    equipment: [],
    ...overrides,
  };
}

describe("open quality work", () => {
  it("counts open issues and leaves closed, deleted, and other-plant rows out", () => {
    const work = buildOpenWork(
      input({
        ncrs: [
          { id: 1, siteId: 1, title: "Burr", status: "open", severity: "high", assignedTo: 7, isDeleted: false, createdAt: daysAgo(3), updatedAt: daysAgo(1) },
          { id: 2, siteId: 1, title: "Scratch", status: "investigating", severity: "low", assignedTo: null, isDeleted: false, createdAt: daysAgo(10), updatedAt: null },
          { id: 3, siteId: 1, title: "Done", status: "closed", severity: "critical", assignedTo: 7, isDeleted: false, createdAt: daysAgo(4), updatedAt: null },
          { id: 4, siteId: 1, title: "Gone", status: "open", severity: "critical", assignedTo: null, isDeleted: true, createdAt: daysAgo(1), updatedAt: null },
          { id: 5, siteId: 9, title: "Elsewhere", status: "open", severity: "high", assignedTo: null, isDeleted: false, createdAt: daysAgo(2), updatedAt: null },
        ],
      }),
    );
    expect(work.cards.find((card) => card.key === "ncr")).toMatchObject({ value: 2, foot: "1 high / critical", href: "/iso-forms/frm-ncr-001", module: "NCR" });
    const rows = work.records.filter((row) => row.module === "NCR");
    expect(rows.map((row) => row.number)).toEqual(["NCR-2", "NCR-1"]);
    expect(rows[0]).toMatchObject({ title: "Scratch", status: "disposition", plant: "Dayton Machining", owner: "Unassigned", ageDays: 10 });
    expect(rows[1]).toMatchObject({ owner: "Dana Wells", ageDays: 3, href: "/ncr/1" });
  });

  it("counts open CAPAs and supplier CARs, and skips closed ones", () => {
    const work = buildOpenWork(
      input({
        capas: [
          { id: 4, siteId: 1, ncrId: 1, status: "in_progress", ownerId: 7, actionPlan: "Rework the fixture", rootCause: null, createdAt: daysAgo(2), updatedAt: null },
          { id: 5, siteId: 1, ncrId: null, status: "closed", ownerId: null, actionPlan: null, rootCause: null, createdAt: daysAgo(8), updatedAt: null },
        ],
        scars: [
          {
            id: 8,
            status: "open",
            scarNumber: "CAR-18",
            supplierName: "Sensen",
            partNumberDescription: "Valve body",
            defectDescription: null,
            correctiveActionOwner: "Glen",
            createdBy: 7,
            createdAt: daysAgo(1),
            updatedAt: null,
          },
          {
            id: 9,
            status: "closed",
            scarNumber: null,
            supplierName: "Jinbo",
            partNumberDescription: null,
            defectDescription: null,
            correctiveActionOwner: null,
            createdBy: null,
            createdAt: daysAgo(1),
            updatedAt: null,
          },
        ],
      }),
    );
    expect(work.cards.find((card) => card.key === "capa")).toMatchObject({
      label: "Open CAPAs / CARs",
      value: 2,
      foot: "1 CAPA · 1 supplier CAR",
      module: null,
      modules: ["CAPA", "CAR"],
    });
    expect(work.records.find((row) => row.module === "CAPA")).toMatchObject({ number: "CAPA-4", status: "in_progress", href: "/capa/4", owner: "Dana Wells" });
    expect(work.records.find((row) => row.module === "CAR")).toMatchObject({ number: "CAR-18", title: "Valve body", owner: "Glen", href: "/scar-forms/8", plant: null });
  });

  it("keeps unsigned validation and TRP forms, and drops ones that are already signed off", () => {
    const work = buildOpenWork(
      input({
        validation: [
          { id: 1, formType: "csa", data: { formType: "csa", cells: {} }, createdAt: daysAgo(2), updatedAt: null },
          { id: 2, formType: "air_strut", data: { formType: "air_strut", authorizedSignature: "Dana Wells" }, createdAt: daysAgo(2), updatedAt: null },
          { id: 3, formType: "air_strut", data: { formType: "air_strut" }, createdAt: daysAgo(6), updatedAt: null },
        ],
        forms: [
          { id: 10, formType: "first_article", data: { cells: { F3: "PN-10" } }, createdAt: daysAgo(1), updatedAt: null },
          { id: 11, formType: "salt_spray", data: { cells: { B6: "Lot 4" }, testedSignature: "Shawn" }, createdAt: daysAgo(4), updatedAt: null },
          { id: 12, formType: "salt_spray", data: { approvedSignature: "Shawn" }, createdAt: daysAgo(4), updatedAt: null },
          { id: 13, formType: "prototype_strut", data: { cells: { B8: "Strut A" }, engineeringSignoffSignature: "Shawn" }, createdAt: daysAgo(3), updatedAt: null },
          { id: 14, formType: "prototype_strut", data: { cells: { D8: "Strut B" } }, createdAt: daysAgo(9), updatedAt: null },
          { id: 15, formType: "engineering_change", data: { workflow: { status: "closed" }, cells: { B6: "Done" } }, createdAt: daysAgo(1), updatedAt: null },
          { id: 16, formType: "engineering_change", data: { cells: { B6: "Housing", B7: "Job 2" } }, createdAt: daysAgo(5), updatedAt: null },
        ],
        changes: [
          { id: 3, title: "Paint spec", status: "under_review", requestedBy: 7, createdAt: daysAgo(2), updatedAt: null },
          { id: 4, title: "Old", status: "implemented", requestedBy: null, createdAt: daysAgo(20), updatedAt: null },
          { id: 5, title: "No", status: "rejected", requestedBy: null, createdAt: daysAgo(2), updatedAt: null },
        ],
      }),
    );
    expect(work.cards.find((card) => card.key === "validation")).toMatchObject({
      value: 5,
      foot: "2 validation · 1 FAI · 2 TRP",
      href: null,
      module: null,
      modules: ["VAL", "FAI", "TRP"],
    });
    expect(work.cards.find((card) => card.key === "ecr")).toMatchObject({
      value: 2,
      foot: "1 ECR form · 1 change request",
      href: null,
      module: null,
      modules: ["ECR", "Change"],
    });
    expect(work.records.filter((row) => row.module === "VAL").map((row) => row.number)).toEqual(["VAL-3", "VAL-1"]);
    expect(work.records.find((row) => row.number === "VAL-3")).toMatchObject({ title: "Air strut validation", owner: null, status: "in_progress" });
    expect(work.records.find((row) => row.number === "FAI-10")).toMatchObject({ title: "PN-10", href: "/iso-forms/record/10" });
    expect(work.records.find((row) => row.number === "TRP-11")).toMatchObject({ status: "tested", title: "Lot 4" });
    expect(work.records.find((row) => row.number === "TRP-14")).toMatchObject({ title: "Strut B", status: "in_progress" });
    expect(work.records.find((row) => row.number === "ECR-16")).toMatchObject({ title: "Housing · Job 2", status: "request", href: "/iso-forms/record/16" });
    expect(work.records.find((row) => row.module === "Change")).toMatchObject({ number: "CHG-3", status: "under_review", owner: "Dana Wells", href: "/change/3" });
  });

  it("keeps a one-list ECR or change card on that single module", () => {
    const formsOnly = buildOpenWork(input({ access: { ...input().access, change: false } }));
    expect(formsOnly.cards.find((card) => card.key === "ecr")).toMatchObject({ href: "/iso-forms/frm-ecr-001", module: "ECR" });
    expect(formsOnly.cards.find((card) => card.key === "validation")?.modules).toEqual(["VAL", "FAI", "TRP"]);

    const changesOnly = buildOpenWork(input({ access: { ...input().access, documents: false } }));
    expect(changesOnly.cards.find((card) => card.key === "validation")).toBeUndefined();
    expect(changesOnly.cards.find((card) => card.key === "ecr")).toMatchObject({ label: "Open change requests", href: "/change", module: "Change" });
  });

  it("marks company-wide cards when the dashboard is on one plant", () => {
    const work = buildOpenWork(input({ allPlants: false, siteIds: [1], sites: [{ id: 1, name: "Dayton Machining" }] }));
    expect(work.cards.find((card) => card.key === "validation")?.foot).toContain("Company-wide");
    expect(work.cards.find((card) => card.key === "ecr")?.foot).toContain("Company-wide");
    expect(work.cards.find((card) => card.key === "calibration")?.foot).toContain("Company-wide");
    expect(work.cards.find((card) => card.key === "ncr")?.foot).not.toContain("Company-wide");
  });

  it("counts overdue gages and overdue training without treating due-soon as overdue", () => {
    const work = buildOpenWork(
      input({
        allPlants: false,
        siteIds: [1],
        sites: [{ id: 1, name: "Dayton Machining" }],
        equipment: [
          { dueStatus: "overdue" },
          { dueStatus: "failed" },
          { dueStatus: "due_soon" },
          { dueStatus: "current" },
        ],
        assignments: [
          { status: "completed", userId: 7, dueAt: daysAgo(3) },
          { status: "assigned", userId: 7, dueAt: daysAgo(1) },
          { status: "overdue", userId: 8, dueAt: daysAgo(4) },
          { status: "assigned", userId: 7, dueAt: new Date(NOW.getTime() + 4 * DAY) },
        ],
      }),
    );
    expect(work.cards.find((card) => card.key === "calibration")).toMatchObject({ value: 2, href: "/calibration" });
    expect(work.cards.find((card) => card.key === "training")).toMatchObject({ value: 1, foot: "3 assignments", href: "/training" });
  });

  it("lists open PPAP, risk, and work orders and leaves finished ones out", () => {
    const work = buildOpenWork(
      input({
        ppaps: [
          { id: 1, partNumber: "P-1", partName: "Bracket", status: "submitted", ownerId: 7, createdAt: daysAgo(2), updatedAt: null },
          { id: 2, partNumber: "P-2", partName: null, status: "approved", ownerId: null, createdAt: daysAgo(2), updatedAt: null },
        ],
        risks: [
          { id: 3, title: "Tool wear", status: "mitigation", ownerId: null, createdAt: daysAgo(12), updatedAt: null },
          { id: 4, title: "Done", status: "closed", ownerId: 7, createdAt: daysAgo(1), updatedAt: null },
        ],
        workOrders: [
          { id: 6, status: "in_progress", notes: null, createdBy: 7, sku: "SKU-6", description: "Housing", createdAt: daysAgo(1), updatedAt: null },
          { id: 7, status: "completed", notes: null, createdBy: null, sku: "SKU-7", description: null, createdAt: daysAgo(1), updatedAt: null },
          { id: 8, status: "cancelled", notes: "Stop", createdBy: null, sku: null, description: null, createdAt: daysAgo(1), updatedAt: null },
        ],
      }),
    );
    expect(work.records.find((row) => row.module === "PPAP")).toMatchObject({ number: "PPAP-1", title: "P-1 — Bracket", status: "submitted", href: "/ppap/1" });
    expect(work.records.find((row) => row.module === "Risk")).toMatchObject({ number: "RISK-3", status: "mitigation", owner: "Unassigned", href: "/risk/3" });
    expect(work.records.find((row) => row.module === "Work order")).toMatchObject({ number: "WO-6", title: "SKU-6 — Housing", status: "in_progress", href: "/work-orders/6" });
    expect(work.records.some((row) => row.number === "PPAP-2" || row.number === "RISK-4" || row.number === "WO-7" || row.number === "WO-8")).toBe(false);
  });

  it("omits modules this person cannot read, including a zero card for an empty table they can read", () => {
    const hidden = buildOpenWork(
      input({
        access: {
          ncr: false,
          capa: false,
          scar: false,
          documents: false,
          change: false,
          ppap: false,
          risk: false,
          workOrders: false,
          calibration: false,
          training: false,
        },
        ncrs: [{ id: 1, siteId: 1, title: "Burr", status: "open", severity: "high", assignedTo: 7, isDeleted: false, createdAt: daysAgo(1), updatedAt: null }],
      }),
    );
    expect(hidden.cards).toEqual([]);
    expect(hidden.records).toEqual([]);

    const empty = buildOpenWork(input({ access: { ...input().access, scar: false, documents: false, change: false, ppap: false, risk: false, workOrders: false, calibration: false, training: false } }));
    expect(empty.cards.map((card) => card.key)).toEqual(["ncr", "capa"]);
    expect(empty.cards.every((card) => card.value === 0)).toBe(true);
    expect(empty.modules.map((module) => module.key)).toEqual(["NCR", "CAPA"]);
  });

  it("keeps the oldest open rows when the table is long and still counts every row on the cards", () => {
    const ncrs = Array.from({ length: 301 }, (_, index) => ({
      id: index + 1,
      siteId: 1,
      title: `Issue ${index + 1}`,
      status: "open",
      severity: null,
      assignedTo: null,
      isDeleted: false,
      createdAt: daysAgo(index + 1),
      updatedAt: null,
    }));
    const work = buildOpenWork(input({ ncrs }));
    expect(work.truncated).toBe(true);
    expect(work.records).toHaveLength(300);
    expect(work.cards.find((card) => card.key === "ncr")?.value).toBe(301);
    expect(work.records[0]?.number).toBe("NCR-301");
  });

  it("keeps a deleted plant's name on the record and leaves it out of the filter", () => {
    const work = buildOpenWork(
      input({
        siteIds: [1, 2, 9],
        sites: [
          { id: 1, name: "Dayton Machining" },
          { id: 2, name: "Greenville Stamping" },
        ],
        plantNames: [
          { id: 1, name: "Dayton Machining" },
          { id: 2, name: "Greenville Stamping" },
          { id: 9, name: "Harbor" },
        ],
        ncrs: [{ id: 8, siteId: 9, title: "Issue at harbor", status: "open", severity: "low", assignedTo: null, isDeleted: false, createdAt: daysAgo(1), updatedAt: null }],
      }),
    );
    expect(work.plants.map((plant) => plant.name)).toEqual(["Dayton Machining", "Greenville Stamping"]);
    expect(work.records.find((row) => row.number === "NCR-8")).toMatchObject({ plant: "Harbor", title: "Issue at harbor" });
  });
});
