import { describe, expect, it } from "vitest";
import { buildWaitingItems, presentWaitingList, sanitizeWaitingPrefs, type WaitingInput } from "../src/modules/dashboard/waitingOnMe.js";

const now = new Date("2026-10-04T12:00:00.000Z");

function input(patch: Partial<WaitingInput> = {}): WaitingInput {
  return {
    now,
    userId: 7,
    access: { ncr: true, capa: true, fai: true, calibration: true, documents: true, training: true, audit: true },
    names: { 7: "Shawn" },
    siteIds: [1],
    ncrs: [],
    capas: [],
    faiRecords: [],
    pulls: [],
    sources: [],
    gages: [],
    approvals: [],
    documents: [],
    training: [],
    audits: [],
    ...patch,
  };
}

describe("waiting on me", () => {
  it("keeps only this person's open NCR in a plant they can see", () => {
    const items = buildWaitingItems(input({
      ncrs: [
        { id: 4, title: "Seal leak", status: "contain", assignedTo: 7, dueDate: "2026-10-01T12:00:00.000Z", siteId: 1, isDeleted: false },
        { id: 5, title: "Someone else", status: "contain", assignedTo: 9, dueDate: "2026-10-01T12:00:00.000Z", siteId: 1, isDeleted: false },
        { id: 6, title: "Other plant", status: "contain", assignedTo: 7, dueDate: "2026-10-01T12:00:00.000Z", siteId: 2, isDeleted: false },
        { id: 8, title: "Closed", status: "closed", assignedTo: 7, dueDate: null, siteId: 1, isDeleted: false },
      ],
    }));
    expect(items.map((row) => row.number)).toEqual([""]);
    expect(items[0]?.number).not.toBe("NCR-4");
    expect(items[0]?.number).not.toBe("4");
    expect(items[0]?.timing).toBe("3 days late");
    expect(items[0]?.href).toBe("/ncr/4");
    expect(items[0]?.assignedTo).toBe("Shawn");
  });

  it("omits NCR rows when this person cannot read NCR", () => {
    const items = buildWaitingItems(input({
      access: { ncr: false, capa: false, fai: false, calibration: true, documents: false, training: false, audit: false },
      ncrs: [{ id: 4, title: "Seal leak", status: "contain", assignedTo: 7, dueDate: null, siteId: 1, isDeleted: false }],
      gages: [{ id: 3, name: "Caliper", serialNumber: "G-3", dueStatus: "overdue", nextDueAt: "2026-10-01T12:00:00.000Z" }],
    }));
    expect(items.map((row) => row.module)).toEqual(["Calibration"]);
    expect(items[0]?.assignedTo).toBe("Unassigned");
  });

  it("counts days remaining and groups by module", () => {
    const items = buildWaitingItems(input({
      training: [{ id: 2, title: "Gauge class", status: "assigned", userId: 7, dueAt: "2026-10-06T12:00:00.000Z" }],
    }));
    expect(items[0]?.timing).toBe("2 days remaining");
    const view = presentWaitingList(items, sanitizeWaitingPrefs({ sort: "module", group: "module", module: "all", timing: "all" }));
    expect(view.groups[0]?.key).toBe("Training");
  });

  it("does not invent a validation due row", () => {
    const items = buildWaitingItems(input());
    expect(items.some((row) => row.module === "Validation")).toBe(false);
  });
});
