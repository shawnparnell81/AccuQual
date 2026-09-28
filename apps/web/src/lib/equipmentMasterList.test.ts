import assert from "node:assert/strict";
import test from "node:test";
import { addMonths, dueTone, equipmentListRow, type EquipmentSource } from "./equipmentMasterList";

const today = new Date("2026-09-28T12:00:00Z");

test("next due is last cal plus the interval in months", () => {
  assert.equal(addMonths("2026-01-15", 12), "2027-01-15");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
});

test("colors next due red, yellow within 60 days, and green when in calibration", () => {
  assert.equal(dueTone("2026-09-27", "Active", today), "red");
  assert.equal(dueTone("2026-09-28", "Active", today), "yellow");
  assert.equal(dueTone("2026-11-27", "Active", today), "yellow");
  assert.equal(dueTone("2026-11-28", "Active", today), "green");
  assert.equal(dueTone("2026-01-01", "CNR", today), "none");
  assert.equal(dueTone("2026-01-01", "Scrapped", today), "none");
});

test("a live equipment row keeps the gage identity and the list status", () => {
  const source: EquipmentSource = {
    id: 4,
    name: "Micrometer",
    serialNumber: "SN-4",
    location: "Lab",
    status: "active",
    calibrationIntervalDays: 365,
    lastCalibratedAt: "2026-08-01T00:00:00.000Z",
    metadata: { manufacturer: "Starrett", method: "External", assetId: "EQ-4", calIntervalMonths: 12, listStatus: "Active" },
  };
  const row = equipmentListRow(source, today);
  assert.equal(row.assetId, "EQ-4");
  assert.equal(row.manufacturer, "Starrett");
  assert.equal(row.nextDue, "2027-08-01");
  assert.equal(row.tone, "green");
  assert.equal(row.status, "Active");
});
