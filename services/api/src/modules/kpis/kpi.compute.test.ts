import { describe, expect, it } from "vitest";
import { monthWindow } from "./kpi.model.js";
import { valueFor, type KpiSource } from "./kpi.compute.js";

const now = new Date("2026-10-10T16:00:00.000Z");

function source(patch: Partial<KpiSource> = {}): KpiSource {
  return {
    now,
    ncrs: [],
    capas: [],
    complaints: [],
    warranties: [],
    labor: [],
    findings: [],
    fai: [],
    scars: [],
    assignments: [],
    userSites: [],
    gageStatuses: [],
    ...patch,
  };
}

describe("kpi values", () => {
  it("counts opened NCRs by plant and keeps unsited rows on All only", () => {
    const rows = source({
      ncrs: [
        { id: 1, siteId: 1, status: "open", createdAt: new Date("2026-10-02T15:00:00.000Z"), closedAt: null, supplierId: null, recordNumber: "NCR-1", title: "A" },
        { id: 2, siteId: null, status: "open", createdAt: new Date("2026-10-03T15:00:00.000Z"), closedAt: null, supplierId: 8, recordNumber: "NCR-2", title: "B" },
      ],
    });
    const window = monthWindow(2026, 10, now);
    expect(valueFor("ncrs_opened", rows, window, "all").value).toBe(2);
    expect(valueFor("ncrs_opened", rows, window, 1).value).toBe(1);
    expect(valueFor("ncrs_opened", rows, window, 1).notes.join(" ")).toMatch(/no plant/);
    expect(valueFor("supplier_ncrs", rows, window, "all").value).toBe(1);
  });

  it("leaves a closed CAPA with no due date out of the on-time rate", () => {
    const window = monthWindow(2026, 10, now);
    const rows = source({
      capas: [
        { id: 1, siteId: 1, status: "closed", createdAt: new Date("2026-10-01T12:00:00.000Z"), closedAt: new Date("2026-10-05T12:00:00.000Z"), dueAt: new Date("2026-10-06T12:00:00.000Z"), recordNumber: "C-1", title: "On time" },
        { id: 2, siteId: 1, status: "closed", createdAt: new Date("2026-10-01T12:00:00.000Z"), closedAt: new Date("2026-10-08T12:00:00.000Z"), dueAt: null, recordNumber: "C-2", title: "No due" },
      ],
    });
    const result = valueFor("capa_on_time", rows, window, "all");
    expect(result.value).toBe(100);
    expect(result.notes.join(" ")).toMatch(/no due date/);
  });

  it("counts an open NCR only after it is older than 30 days", () => {
    const window = monthWindow(2026, 10, now);
    const rows = source({
      ncrs: [
        { id: 1, siteId: 1, status: "open", createdAt: new Date(now.getTime() - 31 * 86_400_000), closedAt: null, supplierId: null, recordNumber: "N-1", title: "Old" },
        { id: 2, siteId: 1, status: "open", createdAt: new Date(now.getTime() - 10 * 86_400_000), closedAt: null, supplierId: null, recordNumber: "N-2", title: "New" },
      ],
    });
    expect(valueFor("ncr_open_over_30", rows, window, "all").value).toBe(1);
  });

  it("uses pass and fail only for the FAI rate", () => {
    const window = monthWindow(2026, 10, now);
    const rows = source({
      fai: [
        { id: 1, siteId: 1, at: new Date("2026-10-02T12:00:00.000Z"), recordNumber: "V-1", title: "Pass", status: "pass", href: "/validation-reports/1", module: "documents", outcome: "pass" },
        { id: 2, siteId: 1, at: new Date("2026-10-03T12:00:00.000Z"), recordNumber: "V-2", title: "Fail", status: "fail", href: "/validation-reports/2", module: "documents", outcome: "fail" },
        { id: 3, siteId: 1, at: new Date("2026-10-04T12:00:00.000Z"), recordNumber: "V-3", title: "Open", status: "open", href: "/validation-reports/3", module: "documents", outcome: "open" },
      ],
    });
    const result = valueFor("fai_pass_rate", rows, window, "all");
    expect(result.value).toBe(50);
    expect(result.notes.join(" ")).toMatch(/in progress/);
  });

  it("keeps training and calibration blank for earlier months", () => {
    const past = monthWindow(2026, 9, now);
    const live = monthWindow(2026, 10, now);
    const rows = source({
      assignments: [{ id: 1, userId: 3, status: "completed", dueAt: null, courseTitle: "ISO" }],
      gageStatuses: ["current", "overdue"],
    });
    expect(valueFor("training_completion", rows, past, "all").value).toBeNull();
    expect(valueFor("training_completion", rows, live, "all").value).toBe(100);
    expect(valueFor("calibration_on_time", rows, past, 1).value).toBeNull();
    expect(valueFor("calibration_on_time", rows, live, 1).value).toBe(50);
    expect(valueFor("calibration_on_time", rows, live, 1).notes.join(" ")).toMatch(/Company-wide/);
  });
});
