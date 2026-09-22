// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Bulk actions pilot (crudFactory.ts's bulkUpdate, wired only on NCR in this PR): the hard constraint carried over
// from training's old bulk-complete-all removal is that every affected row still gets its own real audit-trail entry
// — never one summary row for the whole batch — and the whole batch is fail-closed (one bad id rolls everything back,
// via withTenantDb's existing one-transaction-per-request commit/rollback, not a new transaction of its own).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, and, inArray } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { formData } from "../../src/drizzle/schema/forms.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
const userIds: number[] = [];
let qualityToken: string;
let engineeringToken: string;

async function makeUser(department: string | null) {
  const [user] = await db.insert(users).values({ tenantId, email: `ncr-bulk-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName: "operator", department });
}

async function createNcr(token: string, title: string) {
  const res = await request(app).post("/ncr").set("Authorization", `Bearer ${token}`).send({ title, severity: "high" });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("NCR bulk actions (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `NCR Bulk Test Tenant ${suffix}`, code: `ncr-bulk-${suffix}` }).returning();
    tenantId = tenant!.id;
    await seedDefaultPermissions(tenantId);
    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering"); // ncr's default permissions are quality-only — engineering has zero access
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(formData).where(and(eq(formData.tenantId, tenantId)));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(ncr).where(eq(ncr.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("updates every selected NCR and writes one real audit-trail entry per row — never a single summary row", async () => {
    const a = await createNcr(qualityToken, "Bulk test A");
    const b = await createNcr(qualityToken, "Bulk test B");
    const c = await createNcr(qualityToken, "Bulk test C");

    const res = await request(app).patch("/ncr/bulk").set("Authorization", `Bearer ${qualityToken}`).send({ ids: [a, b, c], patch: { status: "contained" } });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.every((r: { status: string }) => r.status === "contained")).toBe(true);

    const rows = await db.select().from(ncr).where(inArray(ncr.id, [a, b, c]));
    expect(rows.every((r) => r.status === "contained")).toBe(true);

    const updateEntries = await db.select().from(auditTrail).where(and(eq(auditTrail.tenantId, tenantId), eq(auditTrail.entityType, "NCR"), eq(auditTrail.action, "update")));
    // One update-audit row per id, distinctly attributable to that id — not one row for the whole batch.
    for (const id of [a, b, c]) {
      expect(updateEntries.filter((r) => r.entityId === id)).toHaveLength(1);
    }
  });

  it("is fail-closed, not partial-apply: a nonexistent id in the batch rolls back every update in that same request", async () => {
    const a = await createNcr(qualityToken, "Fail-closed test A");
    const b = await createNcr(qualityToken, "Fail-closed test B");
    const madeUpId = 999999999;

    const res = await request(app).patch("/ncr/bulk").set("Authorization", `Bearer ${qualityToken}`).send({ ids: [a, madeUpId, b], patch: { status: "closed" } });
    expect(res.status).toBe(404);

    const rows = await db.select().from(ncr).where(inArray(ncr.id, [a, b]));
    // Neither real NCR was changed, even though `a` was processed before the batch hit the bad id.
    expect(rows.every((r) => r.status === "open")).toBe(true);

    const closedAudits = await db.select().from(auditTrail).where(and(eq(auditTrail.tenantId, tenantId), eq(auditTrail.entityType, "NCR"), eq(auditTrail.action, "update"), inArray(auditTrail.entityId, [a, b])));
    expect(closedAudits).toHaveLength(0);
  });

  it("engineering (zero access to ncr) is refused the whole batch", async () => {
    const a = await createNcr(qualityToken, "RBAC test A");
    const res = await request(app).patch("/ncr/bulk").set("Authorization", `Bearer ${engineeringToken}`).send({ ids: [a], patch: { status: "closed" } });
    expect(res.status).toBe(403);
  });

  it("rejects an empty id list and a batch larger than the cap", async () => {
    const empty = await request(app).patch("/ncr/bulk").set("Authorization", `Bearer ${qualityToken}`).send({ ids: [], patch: { status: "closed" } });
    expect(empty.status).toBe(400);

    const tooMany = await request(app)
      .patch("/ncr/bulk")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ ids: Array.from({ length: 101 }, (_, i) => i + 1), patch: { status: "closed" } });
    expect(tooMany.status).toBe(400);
  });
});
