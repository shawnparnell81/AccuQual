// Real-DB integration test (see tenant-isolation.test.ts's header comment
// for why this category exists). Covers the new GET /ai/suggestions
// history endpoint — previously ai_suggestions could only be read back one
// row at a time (the decision endpoint) or as a cross-tenant aggregate
// count (Platform Admin's AI Overview); nothing let a tenant browse its own
// AI suggestion history at all.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { aiSuggestions } from "../../src/drizzle/schema/ai.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let otherTenantId: number;
const userIds: number[] = [];
let adminToken: string;
let operatorToken: string;

async function makeUser(forTenantId: number, roleName: string) {
  const [user] = await db.insert(users).values({ tenantId: forTenantId, email: `ai-hist-${roleName}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId: forTenantId, roleId: null, roleName, department: null });
}

describe("GET /ai/suggestions — AI suggestion history (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `AI History Test Tenant ${suffix}`, code: `ai-hist-${suffix}` }).returning();
    tenantId = tenant!.id;
    const [other] = await db.insert(tenants).values({ name: `AI History Other Tenant ${suffix}`, code: `ai-hist-other-${suffix}` }).returning();
    otherTenantId = other!.id;

    adminToken = await makeUser(tenantId, "admin");
    operatorToken = await makeUser(tenantId, "operator");
  });

  afterAll(async () => {
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, otherTenantId));
    await db.delete(aiSuggestions).where(eq(aiSuggestions.tenantId, tenantId));
    await db.delete(aiSuggestions).where(eq(aiSuggestions.tenantId, otherTenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await pool.end();
  });

  it("lists real suggestion rows this tenant has generated, newest first, with the actor's real name", async () => {
    const rootCause = await request(app)
      .post("/ai/root-cause")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ncrData: { title: "Test NCR", description: "Bearing failure" } });
    expect(rootCause.status).toBe(200);

    const capa = await request(app)
      .post("/ai/capa")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ rootCause: { rootCause: "worn bearing" }, ncrData: { title: "Test NCR" } });
    expect(capa.status).toBe(200);

    const list = await request(app).get("/ai/suggestions").set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(2);
    expect(list.body.items[0].id).toBe(capa.body.id); // newest first
    expect(list.body.items.find((s: { id: number }) => s.id === rootCause.body.id)).toBeTruthy();
    expect(list.body.items[0].createdByName).toBeTruthy();
    expect(list.body.items[0].decision).toBeNull(); // no decision recorded yet
  });

  it("filters by module", async () => {
    const list = await request(app).get("/ai/suggestions").query({ module: "capa" }).set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(list.body.items.every((s: { module: string }) => s.module === "capa")).toBe(true);
  });

  it("shows a real accept/reject decision once recorded", async () => {
    const created = await request(app)
      .post("/ai/root-cause")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ncrData: { title: "Decision Test NCR" } });

    const decision = await request(app).post(`/ai/suggestions/${created.body.id}/decision`).set("Authorization", `Bearer ${adminToken}`).send({ decision: "accepted" });
    expect(decision.status).toBe(204);

    const list = await request(app).get("/ai/suggestions").set("Authorization", `Bearer ${adminToken}`);
    const row = list.body.items.find((s: { id: number }) => s.id === created.body.id);
    expect(row.decision).toBe("accepted");
  });

  it("a non-admin cannot browse the history", async () => {
    const res = await request(app).get("/ai/suggestions").set("Authorization", `Bearer ${operatorToken}`);
    expect(res.status).toBe(403);
  });

  it("never shows another tenant's suggestions", async () => {
    const otherAdminToken = await makeUser(otherTenantId, "admin");
    const otherSuggestion = await request(app)
      .post("/ai/root-cause")
      .set("Authorization", `Bearer ${otherAdminToken}`)
      .send({ ncrData: { title: "Other Tenant NCR" } });
    expect(otherSuggestion.status).toBe(200);

    const list = await request(app).get("/ai/suggestions").set("Authorization", `Bearer ${adminToken}`);
    expect(list.body.items.find((s: { id: number }) => s.id === otherSuggestion.body.id)).toBeUndefined();
  });
});
