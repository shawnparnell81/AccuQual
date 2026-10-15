import { ensureTestCompany } from "../helpers/company.js";
import { readFileSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../src/db/index.js";
import { equipment, calibrations } from "../../src/drizzle/schema/calibration.js";
import { formData, formVersions } from "../../src/drizzle/schema/forms.js";
import { attachments } from "../../src/drizzle/schema/attachments.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";

const file = new URL("../../src/drizzle/migrations/0138_remove_placeholder_equipment.sql", import.meta.url);
const journal = JSON.parse(readFileSync(new URL("../../src/drizzle/migrations/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: { idx: number; tag: string; when: number }[];
};

async function runMigration() {
  for (const statement of readFileSync(file, "utf8").split("--> statement-breakpoint")) {
    if (statement.trim()) await pool.query(statement);
  }
}

describe("0138 removes only blank calibration placeholder equipment", () => {
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    await ensureTestCompany();
    const add = async (key: string, values: Partial<typeof equipment.$inferInsert>) => {
      const [row] = await db.insert(equipment).values({ name: "Calibration Record", ...values }).returning();
      ids[key] = row!.id;
    };
    await add("plain", {});
    await add("register", { name: "Calibration Equipment Register" });
    await add("blankName", { name: "  " });
    await add("emptyMeta", { metadata: { assetId: "", manufacturer: null } as Record<string, unknown> });
    await add("unsavedStub", {});
    await add("real", { name: "Caliper 6in" });
    await add("serial", { serialNumber: "SN-9" });
    await add("location", { location: "Lab" });
    await add("assetId", { metadata: { assetId: "G-12" } });
    await add("interval", { calibrationIntervalDays: 180 });
    await add("outOfService", { status: "out_of_service" });
    await add("calibrated", {});
    await add("savedForm", {});
    await add("versioned", {});
    await add("attached", {});
    await db.insert(formData).values({ formType: "calibration", entityType: "calibration", entityId: ids.unsavedStub!, data: {} });
    await db.insert(calibrations).values({ equipmentId: ids.calibrated!, status: "scheduled" });
    await db.insert(formData).values({ formType: "calibration", entityType: "calibration", entityId: ids.savedForm!, data: { notes: "x" }, updatedAt: new Date() });
    const [stub] = await db.insert(formData).values({ formType: "calibration", entityType: "calibration", entityId: ids.versioned!, data: {} }).returning();
    await db.insert(formVersions).values({ formId: stub!.id, version: 1, data: {} });
    await db.insert(attachments).values({ entityType: "calibration", entityId: ids.attached!, fileName: "cert.pdf", filePath: "/tmp/none.pdf" });
  });

  it("is journaled after 0137 with a later timestamp", () => {
    const entry = journal.entries.find((row) => row.tag === "0138_remove_placeholder_equipment");
    const previous = journal.entries.find((row) => row.tag === "0137_role_permission_keys");
    expect(entry?.idx).toBe((previous?.idx ?? 0) + 1);
    expect(entry!.when).toBeGreaterThan(Math.max(...journal.entries.filter((row) => row.idx < entry!.idx).map((row) => row.when)));
  });

  it("deletes the blank placeholders, keeps everything with data or links, and writes the audit trail", async () => {
    await runMigration();
    const left = new Set((await db.select({ id: equipment.id }).from(equipment).where(inArray(equipment.id, Object.values(ids)))).map((row) => row.id));
    for (const key of ["plain", "register", "blankName", "emptyMeta", "unsavedStub"]) expect(left.has(ids[key]!), key).toBe(false);
    for (const key of ["real", "serial", "location", "assetId", "interval", "outOfService", "calibrated", "savedForm", "versioned", "attached"]) expect(left.has(ids[key]!), key).toBe(true);
    const stubs = await db.select().from(formData).where(eq(formData.entityId, ids.unsavedStub!));
    expect(stubs).toHaveLength(0);
    const saved = await db.select().from(formData).where(eq(formData.entityId, ids.savedForm!));
    expect(saved).toHaveLength(1);
    const audit = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Equipment"), eq(auditTrail.entityId, ids.plain!), eq(auditTrail.action, "delete")));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.performedBy).toBeNull();
    expect(audit[0]!.createdAt).toBeTruthy();
    expect(audit[0]!.changes).toMatchObject({ who: "System migration 0138_remove_placeholder_equipment", what: `Equipment ${ids.plain} "Calibration Record"` });
    expect(String(audit[0]!.changes?.summary)).toContain("blank calibration placeholder");
  });

  it("changes nothing on a second run", async () => {
    const before = await db.select({ id: auditTrail.id }).from(auditTrail);
    await runMigration();
    const after = await db.select({ id: auditTrail.id }).from(auditTrail);
    expect(after.length).toBe(before.length);
  });
});
