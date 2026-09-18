// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Full-System Audit finding L2: Discrepancy & Investigation (quality/DI) had
// zero dedicated test coverage — no RBAC and no coverage of closeHandler's
// real "must be disposed first" guard.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { discrepancyInvestigations } from "../../src/drizzle/schema/quality.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
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
  const [user] = await db.insert(users).values({ tenantId, email: `di-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName: "operator", department });
}

async function createDi(token: string) {
  const res = await request(app).post("/quality").set("Authorization", `Bearer ${token}`).send({ title: "Fixture discrepancy" });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("Discrepancy & Investigation / quality-DI (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `DI Test Tenant ${suffix}`, code: `di-test-${suffix}` }).returning();
    tenantId = tenant!.id;
    await seedDefaultPermissions(tenantId);

    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering"); // di's default permissions are quality-only
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(discrepancyInvestigations).where(eq(discrepancyInvestigations.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("engineering (zero access to di) cannot create a discrepancy investigation", async () => {
    const res = await request(app).post("/quality").set("Authorization", `Bearer ${engineeringToken}`).send({ title: "Should be blocked" });
    expect(res.status).toBe(403);
  });

  it("a fresh discrepancy investigation starts as open", async () => {
    const id = await createDi(qualityToken);
    const res = await request(app).get(`/quality/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.body.status).toBe("open");
  });

  it("cannot close a discrepancy investigation before it's disposed", async () => {
    const id = await createDi(qualityToken);
    const res = await request(app).post(`/quality/${id}/close`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(400);
  });

  it("walks open -> disposed (via PATCH) -> closed, and records real audit trail", async () => {
    const id = await createDi(qualityToken);

    const dispose = await request(app).patch(`/quality/${id}`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "disposed", disposition: "rework" });
    expect(dispose.status).toBe(200);
    expect(dispose.body.status).toBe("disposed");

    const close = await request(app).post(`/quality/${id}/close`).set("Authorization", `Bearer ${qualityToken}`);
    expect(close.status).toBe(200);
    expect(close.body.status).toBe("closed");

    const trail = await db.select().from(auditTrail).where(eq(auditTrail.entityId, id));
    expect(trail.some((t) => t.entityType === "Discrepancy investigation" && t.action === "status_change")).toBe(true);
  });

  it("engineering cannot close one either", async () => {
    const id = await createDi(qualityToken);
    await request(app).patch(`/quality/${id}`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "disposed" });
    const res = await request(app).post(`/quality/${id}/close`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(403);
  });
});
