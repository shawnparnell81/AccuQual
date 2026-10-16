import { ensureTestCompany } from "../helpers/company.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { FORM_TEMPLATES } from "../../src/modules/document-folders/formFiling.js";
import { getUserAccessLevel, type ResourceKey } from "../../src/middleware/departmentAccess.js";

const app = createApp();
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
let adminToken: string;
let readerToken: string;
let supplierId: number;
let readerId: number;
const MODULES: Record<string, ResourceKey> = { "/risk": "risk", "/capa": "capa", "/ncr": "ncr", "/change": "change", "/complaints": "complaints", "/audits": "audit", "/8d": "eight_d" };

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function history(entityType: string, id: number) {
  const rows = await db.execute(sql`SELECT changes FROM audit_trail WHERE entity_type = ${entityType} AND entity_id = ${id} ORDER BY id`);
  return (rows.rows as { changes: { event?: string; summary?: string } }[]).map((row) => row.changes);
}

describe("record pages open read-only; Edit, Save and Cancel are audited and gated", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [admin] = await db.insert(users).values({ email: `lock-admin-${suffix}@test.local`, passwordHash: "unused", name: "Lock Admin" }).returning();
    const [reader] = await db.insert(users).values({ email: `lock-reader-${suffix}@test.local`, passwordHash: "unused", name: "Lock Reader" }).returning();
    readerId = reader!.id;
    adminToken = signAccessToken({ sub: String(admin!.id), roleId: null, roleName: "admin", department: null });
    readerToken = signAccessToken({ sub: String(reader!.id), roleId: null, roleName: "operator", department: "production" });
    const [supplier] = await db.insert(suppliers).values({ name: `Lock Supplier ${suffix}` } as typeof suppliers.$inferInsert).returning();
    supplierId = supplier!.id;
  });

  it("writes who / what / when lines for start, save and cancel", async () => {
    for (const action of ["start", "save", "start", "cancel"]) {
      const res = await request(app).post(`/record-edits/suppliers/${supplierId}`).set(auth(adminToken)).send({ action });
      expect(res.status, action).toBe(200);
      expect(res.body.editing).toBe(action === "start");
    }
    const lines = await history("Supplier", supplierId);
    expect(lines.map((line) => line.event)).toEqual(["edit_started", "edit_saved", "edit_started", "edit_canceled"]);
    expect(lines[0]!.summary).toMatch(/^Lock Admin started editing Supplier \d+ on .+\d{4}, .+\.$/);
    expect(lines[1]!.summary).toContain("saved and locked Supplier");
    expect(lines[3]!.summary).toContain("Unsaved changes were discarded and the record is locked.");
  });

  it("refuses Edit and record updates from a user without the area's edit access", async () => {
    const edit = await request(app).post(`/record-edits/suppliers/${supplierId}`).set(auth(readerToken)).send({ action: "start" });
    expect(edit.status).toBe(403);
    const update = await request(app).put(`/suppliers/${supplierId}`).set(auth(readerToken)).send({ name: "Changed by reader" });
    expect([403, 404]).toContain(update.status);
    const [row] = await db.select().from(suppliers).where(sql`id = ${supplierId}`);
    expect(row!.name).not.toBe("Changed by reader");
  });

  it("refuses begin-edit on module records unless the user's area access is edit", async () => {
    const reader = { id: readerId, roleId: null, roleName: "operator", department: "production" } as Parameters<typeof getUserAccessLevel>[1];
    const starts = FORM_TEMPLATES.filter((seed) => seed.start != null && MODULES[seed.start.createPath]);
    const seen = new Set<string>();
    for (const seed of starts) {
      const start = seed.start!;
      if (seen.has(start.createPath)) continue;
      seen.add(start.createPath);
      const created = await request(app).post(start.createPath).set(auth(adminToken)).send(start.body);
      expect(created.status, `${start.createPath} create ${JSON.stringify(created.body)}`).toBe(201);
      const id = Number(created.body.id);
      const level = await getUserAccessLevel(db, reader, MODULES[start.createPath]!);
      const res = await request(app).post(`${start.createPath}/${id}/begin-edit`).set(auth(readerToken)).send({ action: "start" });
      expect(res.status, `${start.createPath} as ${level}`).toBe(level === "edit" ? 200 : 403);
      await request(app).delete(`${start.createPath}/${id}`).set(auth(adminToken));
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it("rejects an unknown action and an unknown record type", async () => {
    expect((await request(app).post(`/record-edits/suppliers/${supplierId}`).set(auth(adminToken)).send({ action: "delete" })).status).toBe(400);
    expect((await request(app).post(`/record-edits/nope/1`).set(auth(adminToken)).send({})).status).toBe(404);
    expect((await request(app).post(`/record-edits/suppliers/999999999`).set(auth(adminToken)).send({})).status).toBe(404);
  });
});
