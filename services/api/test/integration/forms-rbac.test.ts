// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Regression coverage for Full-System Audit finding B1: POST/PATCH
// /forms/:type/:id/* had no per-type RBAC at all — a stale comment on this
// router claimed "most [types] stay gated by their owning record's own
// permissions," which was false. Any authenticated tenant user could
// rewrite an NCR/CAPA/Audit Plan/etc.'s form content through this one
// generic endpoint, bypassing the department gate enforced on that
// record's own direct route (e.g. quality-only on POST /ncr).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
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
  const [user] = await db.insert(users).values({ tenantId, email: `forms-rbac-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName: "operator", department });
}

describe("Forms engine RBAC — POST /forms/:type/:id/save (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Forms RBAC Test Tenant ${suffix}`, code: `forms-rbac-${suffix}` }).returning();
    tenantId = tenant!.id;
    await seedDefaultPermissions(tenantId);

    // ncr's own default permission entry is quality-only ({ quality: "edit" }) —
    // engineering has zero rows for it, the real bypass this finding covers.
    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(formData).where(eq(formData.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("engineering (zero access to ncr) can no longer rewrite an NCR's form content — previously anyone could", async () => {
    const res = await request(app).post("/forms/ncr/999/save").set("Authorization", `Bearer ${engineeringToken}`).send({ data: { rootCause: "hacked via forms engine" } });
    expect(res.status).toBe(403);
  });

  it("quality (real edit access to ncr) can still save an NCR's form content, exactly as before", async () => {
    const res = await request(app).post("/forms/ncr/999/save").set("Authorization", `Bearer ${qualityToken}`).send({ data: { rootCause: "legitimate save" } });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(formData).where(and(eq(formData.tenantId, tenantId), eq(formData.formType, "ncr"), eq(formData.entityId, 999)));
    expect(row).toBeTruthy();
  });

  it("the same bypass is closed on a second mapped type (audit_plan -> the real 'audit' ResourceKey)", async () => {
    const res = await request(app).post("/forms/audit_plan/1/save").set("Authorization", `Bearer ${engineeringToken}`).send({ data: {} });
    expect(res.status).toBe(403);
  });

  it("a genuinely unowned form type (no corresponding module) stays open to any authenticated user, unchanged from before this fix", async () => {
    const res = await request(app).post("/forms/management_review/1/save").set("Authorization", `Bearer ${engineeringToken}`).send({ data: {} });
    expect(res.status).toBe(200);
  });
});
