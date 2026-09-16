// Real-DB integration test — deliberately different from every other file in
// test/ (those are pure-logic unit tests with no DB connection; see
// test/setup.ts's own comment). This is Inspection Report R08: the highest
// blast-radius category this app has is "did a query forget its own tenantId
// filter," and the RLS role-switch (see src/lib/tenantScope.ts) is now the
// real second layer that's supposed to catch it even then — this test
// exercises the actual HTTP path, not a mock, so it fails the moment either
// layer regresses.
//
// Needs a real, migrated Postgres reachable via DATABASE_URL (see
// vitest.integration.config.ts) — the same DB dev/CI already runs
// `npm run db:migrate` against, never a mock. Creates and tears down its own
// two throwaway tenants; never touches seeded/demo data.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { aiEmbeddings } from "../../src/drizzle/schema/ai.js";
import { signAccessToken } from "../../src/utils/jwt.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
const app = createApp();
const suffix = Date.now();

let tenantAId: number;
let tenantBId: number;
let userAId: number;
let userBId: number;
let tokenA: string;
let tokenB: string;
let ncrIdInTenantA: number;

describe("tenant isolation (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenantA] = await db.insert(tenants).values({ name: `RLS Test Tenant A ${suffix}`, code: `rls-test-a-${suffix}` }).returning();
    const [tenantB] = await db.insert(tenants).values({ name: `RLS Test Tenant B ${suffix}`, code: `rls-test-b-${suffix}` }).returning();
    tenantAId = tenantA!.id;

    await seedDefaultPermissions(tenantAId);
    tenantBId = tenantB!.id;
    await seedDefaultPermissions(tenantBId);

    const [userA] = await db.insert(users).values({ tenantId: tenantAId, email: `rls-test-a-${suffix}@test.local`, passwordHash: "unused" }).returning();
    const [userB] = await db.insert(users).values({ tenantId: tenantBId, email: `rls-test-b-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userAId = userA!.id;
    userBId = userB!.id;

    // roleName "admin" bypasses the department PERMISSION_MATRIX entirely —
    // deliberate, so this file tests ONLY tenant-scoping, not department
    // gating (that's permissions.test.ts's job).
    tokenA = signAccessToken({ sub: String(userAId), tenantId: tenantAId, roleId: null, roleName: "admin", department: null });
    tokenB = signAccessToken({ sub: String(userBId), tenantId: tenantBId, roleId: null, roleName: "admin", department: null });

    const createRes = await request(app).post("/ncr").set("Authorization", `Bearer ${tokenA}`).send({ title: "Tenant A only", description: "should never be visible to tenant B" });
    expect(createRes.status).toBe(201);
    ncrIdInTenantA = createRes.body.id;
  });

  afterAll(async () => {
    // Two independent async side effects can still be landing after this
    // test's own awaits already resolved: errorHandler.ts's
    // logFailedTransition (deliberately fire-and-forget — see its own
    // comment) for the 404s this file intentionally triggers, and the real
    // ai-worker consuming crudFactory's create-time "embed" event off Redis
    // Streams and inserting a real ai_embeddings row for the NCR this file
    // creates. A short grace period, then deleting both by tenantId (not
    // just the one row this test knows about), catches them instead of
    // failing this cleanup on a real FK.
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(inArray(auditTrail.tenantId, [tenantAId, tenantBId]));
    await db.delete(aiEmbeddings).where(inArray(aiEmbeddings.tenantId, [tenantAId, tenantBId]));
    await db.delete(ncr).where(eq(ncr.id, ncrIdInTenantA));
    await db.delete(users).where(eq(users.id, userAId));
    await db.delete(users).where(eq(users.id, userBId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantAId));

    await db.delete(tenants).where(eq(tenants.id, tenantAId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantBId));
    await db.delete(tenants).where(eq(tenants.id, tenantBId));
    await pool.end();
  });

  it("tenant A can see its own record", async () => {
    const res = await request(app).get(`/ncr/${ncrIdInTenantA}`).set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Tenant A only");
  });

  it("tenant B's list never includes tenant A's record", async () => {
    const res = await request(app).get("/ncr").set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.find((r: { id: number }) => r.id === ncrIdInTenantA)).toBeUndefined();
  });

  it("tenant B cannot fetch tenant A's record by id — 404, not a leak", async () => {
    const res = await request(app).get(`/ncr/${ncrIdInTenantA}`).set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it("tenant B cannot modify tenant A's record", async () => {
    const res = await request(app).patch(`/ncr/${ncrIdInTenantA}`).set("Authorization", `Bearer ${tokenB}`).send({ status: "closed" });
    expect(res.status).toBe(404);
    const stillOpen = await db.select().from(ncr).where(eq(ncr.id, ncrIdInTenantA));
    expect(stillOpen[0]?.status).toBe("open");
  });

  it("a request with no tenant context at all (a token missing tenantId) is rejected outright", async () => {
    const orphanToken = signAccessToken({ sub: "999999", tenantId: null, roleId: null, roleName: "admin", department: null });
    const res = await request(app).get("/ncr").set("Authorization", `Bearer ${orphanToken}`);
    expect(res.status).toBe(401);
  });
});
