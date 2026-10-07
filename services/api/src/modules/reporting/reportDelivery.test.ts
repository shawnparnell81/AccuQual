import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const audits: { changes?: { kind?: string; to?: string; report?: string; status?: string; when?: string }; performedBy?: number; entityType?: string }[] = [];
  return {
    audits,
    sendEmail: vi.fn(),
    recordAuditTrail: vi.fn(async (_db: unknown, input: (typeof audits)[number]) => {
      audits.push(input);
    }),
  };
});

vi.mock("../notifications/notification.service.js", () => ({ sendEmail: harness.sendEmail }));
vi.mock("../audit-trail/audit-trail.service.js", () => ({ recordAuditTrail: harness.recordAuditTrail }));

import type { Db } from "../../lib/requestDb.js";
import { deliverReportToEach, overallDeliveryStatus } from "./reportDelivery.js";

function fakeDb() {
  const rows: { recipient?: string; status?: string }[] = [];
  const db = {
    insert: () => ({
      values: async (row: { recipient?: string; status?: string }) => {
        rows.push(row);
      },
    }),
  } as unknown as Db;
  return { db, rows };
}

describe("deliverReportToEach", () => {
  beforeEach(() => {
    harness.audits.length = 0;
    harness.sendEmail.mockReset();
    harness.recordAuditTrail.mockClear();
  });

  it("sends every address and still audits a failure", async () => {
    harness.sendEmail.mockImplementation(async ({ to }: { to: string }) => {
      if (to === "bad@plant.com") return "failed";
      if (to === "boom@plant.com") throw new Error("smtp down");
      return "sent";
    });
    const { db, rows } = fakeDb();
    const results = await deliverReportToEach(db, {
      recipients: ["ada@plant.com", "bad@plant.com", "boom@plant.com"],
      subject: "NCR Summary",
      body: "Open: 3",
      entityType: "ReportSchedule",
      entityId: 12,
      reportName: "NCR Summary",
      performedBy: 7,
    });

    expect(results.map((row) => row.status)).toEqual(["sent", "failed", "failed"]);
    expect(harness.sendEmail).toHaveBeenCalledTimes(3);
    expect(rows.map((row) => row.recipient)).toEqual(["ada@plant.com", "bad@plant.com", "boom@plant.com"]);
    expect(harness.audits).toHaveLength(3);
    expect(harness.audits[0]).toMatchObject({
      entityType: "ReportSchedule",
      performedBy: 7,
      changes: { kind: "report_email", report: "NCR Summary", to: "ada@plant.com", status: "sent" },
    });
    expect(harness.audits[2]?.changes?.to).toBe("boom@plant.com");
    expect(harness.audits[2]?.changes?.status).toBe("failed");
    expect(harness.audits[2]?.changes?.when).toEqual(harness.audits[0]?.changes?.when);
    expect(overallDeliveryStatus(results)).toBe("failed");
  });

  it("calls a fully delivered run sent", () => {
    expect(overallDeliveryStatus([{ to: "a@plant.com", status: "sent" }])).toBe("sent");
    expect(overallDeliveryStatus([{ to: "a@plant.com", status: "logged_only" }])).toBe("logged_only");
    expect(overallDeliveryStatus([])).toBe("failed");
  });
});
