// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Full-System Audit finding H4: CAPA had no dedicated workflow test — its
// only existing coverage was tenant-isolation-modules.test.ts exercising a
// single field's cross-tenant isolation, never the real
// open -> in_progress -> verifying -> closed transition guard in
// capa.controller.ts's ALLOWED_NEXT map.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { capa } from "../../src/drizzle/schema/capa.js";
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
  const [user] = await db.insert(users).values({ tenantId, email: `capa-workflow-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName: "operator", department });
}

async function createCapa(token: string, rootCause: string) {
  const res = await request(app).post("/capa").set("Authorization", `Bearer ${token}`).send({ rootCause });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("CAPA workflow (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `CAPA Workflow Test Tenant ${suffix}`, code: `capa-workflow-${suffix}` }).returning();
    tenantId = tenant!.id;
    await seedDefaultPermissions(tenantId);

    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering"); // capa's default permissions are quality-only
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(capa).where(eq(capa.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("engineering (zero access to capa) cannot create a CAPA at all", async () => {
    const res = await request(app).post("/capa").set("Authorization", `Bearer ${engineeringToken}`).send({ rootCause: "Should be blocked" });
    expect(res.status).toBe(403);
  });

  it("a fresh CAPA starts in status open", async () => {
    const id = await createCapa(qualityToken, "Fresh CAPA");
    const res = await request(app).get(`/capa/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.body.status).toBe("open");
  });

  it("verify is rejected before start — open cannot jump straight to verifying", async () => {
    const id = await createCapa(qualityToken, "Out of order CAPA");
    const res = await request(app).post(`/capa/${id}/verify`).set("Authorization", `Bearer ${qualityToken}`).send({ verification: "Skipped the start step" });
    expect(res.status).toBe(400);
  });

  it("close is rejected before verify — in_progress cannot jump straight to closed", async () => {
    const id = await createCapa(qualityToken, "Premature close CAPA");
    const start = await request(app).post(`/capa/${id}/start`).set("Authorization", `Bearer ${qualityToken}`);
    expect(start.status).toBe(200);

    const close = await request(app).post(`/capa/${id}/close`).set("Authorization", `Bearer ${qualityToken}`);
    expect(close.status).toBe(400);
  });

  it("verification text under 10 characters is rejected as a placeholder", async () => {
    const id = await createCapa(qualityToken, "Short verification CAPA");
    await request(app).post(`/capa/${id}/start`).set("Authorization", `Bearer ${qualityToken}`);

    const res = await request(app).post(`/capa/${id}/verify`).set("Authorization", `Bearer ${qualityToken}`).send({ verification: "too short" });
    expect(res.status).toBe(400);
  });

  it("walks the real open -> in_progress -> verifying -> closed sequence, each step advancing status", async () => {
    const id = await createCapa(qualityToken, "Full lifecycle CAPA");

    const start = await request(app).post(`/capa/${id}/start`).set("Authorization", `Bearer ${qualityToken}`);
    expect(start.status).toBe(200);
    expect(start.body.status).toBe("in_progress");

    const verify = await request(app).post(`/capa/${id}/verify`).set("Authorization", `Bearer ${qualityToken}`).send({ verification: "No recurrence observed after 30 days of monitoring." });
    expect(verify.status).toBe(200);
    expect(verify.body.status).toBe("verifying");
    expect(verify.body.verifiedAt).toBeTruthy();

    const close = await request(app).post(`/capa/${id}/close`).set("Authorization", `Bearer ${qualityToken}`);
    expect(close.status).toBe(200);
    expect(close.body.status).toBe("closed");
    expect(close.body.closedAt).toBeTruthy();

    const trail = await db.select().from(auditTrail).where(eq(auditTrail.entityId, id));
    const actions = trail.filter((t) => t.entityType === "CAPA").map((t) => (t.changes as { action?: string })?.action);
    expect(actions).toEqual(expect.arrayContaining(["start", "verify", "close"]));
  });

  it("a raw PATCH cannot smuggle a status change past the transition endpoints", async () => {
    const id = await createCapa(qualityToken, "PATCH bypass attempt CAPA");
    const res = await request(app).patch(`/capa/${id}`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "closed" });
    // updateCapaSchema deliberately excludes `status` — an unknown/stripped
    // field, not a 400, is the same "silently ignored" behavior every other
    // Zod .partial() schema in this app already has for extra fields; the
    // real assertion is that the CAPA itself never actually changes status.
    expect(res.status).toBeLessThan(300);
    const row = await db.select().from(capa).where(eq(capa.id, id));
    expect(row[0]?.status).toBe("open");
  });
});
