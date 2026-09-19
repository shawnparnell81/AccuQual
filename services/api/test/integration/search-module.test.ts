// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Security-audit finding (low): search had zero test coverage — search.
// controller.ts's canRead() department gate and its per-tenant WHERE
// clauses were both entirely unexercised. This is exactly the kind of
// cross-module aggregation endpoint most likely to regress into a
// cross-tenant leak during a refactor.
//
// Real behavior verified directly against search.controller.ts before
// writing this (NOT assumed): NCR/CAPA/etc. only ever match a numeric
// ID-prefix query ("search ONLY by document number or ID" — no title/
// description text search at all), and the response is `{ results: [...] }`,
// not a bare array.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();
let tenantId: number;
let otherTenantId: number;
let ncrId: number;
const userIds: number[] = [];
let qualityToken: string;
let engineeringToken: string;
let otherTenantToken: string;

describe("Search (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Search Test Tenant ${suffix}`, code: `search-test-${suffix}` }).returning();
    tenantId = tenant!.id;
    const [other] = await db.insert(tenants).values({ name: `Search Other Tenant ${suffix}`, code: `search-other-${suffix}` }).returning();
    otherTenantId = other!.id;
    await seedDefaultPermissions(tenantId);
    await seedDefaultPermissions(otherTenantId);

    const [qualityUser] = await db.insert(users).values({ tenantId, email: `search-quality-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(qualityUser!.id);
    qualityToken = signAccessToken({ sub: String(qualityUser!.id), tenantId, roleId: null, roleName: "operator", department: "quality" });

    // ncr's own default permission entry is quality-only — engineering has zero rows for it.
    const [engineeringUser] = await db.insert(users).values({ tenantId, email: `search-engineering-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(engineeringUser!.id);
    engineeringToken = signAccessToken({ sub: String(engineeringUser!.id), tenantId, roleId: null, roleName: "operator", department: "engineering" });

    const [otherUser] = await db.insert(users).values({ tenantId: otherTenantId, email: `search-other-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(otherUser!.id);
    otherTenantToken = signAccessToken({ sub: String(otherUser!.id), tenantId: otherTenantId, roleId: null, roleName: "operator", department: "quality" });

    const [created] = await db.insert(ncr).values({ tenantId, title: `Search test NCR ${suffix}` }).returning();
    ncrId = created!.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(ncr).where(eq(ncr.id, ncrId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, otherTenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await pool.end();
  });

  it("quality (real ncr access) finds the NCR by its numeric id prefix", async () => {
    const res = await request(app).get(`/search?q=${ncrId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.results.some((r: { type: string; id: number }) => r.type === "NCR" && r.id === ncrId)).toBe(true);
  });

  it("engineering (zero access to ncr) never sees the NCR in results — the category is skipped, not filtered after the fact", async () => {
    const res = await request(app).get(`/search?q=${ncrId}`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(200);
    expect(res.body.results.some((r: { type: string }) => r.type === "NCR")).toBe(false);
  });

  it("tenant B searching the same id prefix finds nothing — real tenant scoping, not just a shared id space coincidence", async () => {
    const res = await request(app).get(`/search?q=${ncrId}`).set("Authorization", `Bearer ${otherTenantToken}`);
    expect(res.status).toBe(200);
    expect(res.body.results.some((r: { type: string }) => r.type === "NCR")).toBe(false);
  });

  it("an empty query returns an empty result set instead of erroring", async () => {
    const res = await request(app).get("/search?q=").set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });
});
