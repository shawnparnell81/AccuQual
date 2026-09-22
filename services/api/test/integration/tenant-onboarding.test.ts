// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// First-run onboarding checklist: GET/PATCH /tenant/onboarding — merge-patch (mirrors /users/me/theme's own
// merge-patch shape), admin-only PATCH, and a sane default for a tenant whose onboardingProgress is still NULL
// (a tenant created before this shipped and not yet backfilled — see backfillOnboardingChecklist.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let adminId: number;
let operatorId: number;
let adminToken: string;
let operatorToken: string;

async function makeUser(label: string, roleName: string) {
  const [user] = await db.insert(users).values({ tenantId, email: `onboarding-${label}-${suffix}@test.local`, passwordHash: "unused" }).returning();
  const token = await signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName, department: null });
  return { id: user!.id, token };
}

describe("First-run onboarding checklist (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    // No onboardingProgress passed — leaves it NULL, same as a tenant that existed before this shipped and hasn't
    // been through backfillOnboardingChecklist.ts yet.
    const [tenant] = await db.insert(tenants).values({ name: `Onboarding Test ${suffix}`, code: `onboarding-test-${suffix}` }).returning();
    tenantId = tenant!.id;
    const admin = await makeUser("admin", "admin");
    const operator = await makeUser("operator", "operator");
    adminId = admin.id;
    operatorId = operator.id;
    adminToken = admin.token;
    operatorToken = operator.token;
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, adminId));
    await db.delete(users).where(eq(users.id, operatorId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("reads back a sane default (not null) when onboardingProgress itself is still NULL", async () => {
    const res = await request(app).get("/tenant/onboarding").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dismissed: false, completedItems: [] });
  });

  it("marking one item complete merge-patches — dismissed is untouched", async () => {
    const res = await request(app).patch("/tenant/onboarding").set("Authorization", `Bearer ${adminToken}`).send({ completedItems: ["invite_users"] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dismissed: false, completedItems: ["invite_users"] });

    const again = await request(app).patch("/tenant/onboarding").set("Authorization", `Bearer ${adminToken}`).send({ completedItems: ["invite_users", "review_departments"] });
    expect(again.body.completedItems).toEqual(["invite_users", "review_departments"]);
    expect(again.body.dismissed).toBe(false);
  });

  it("dismissing merge-patches too — completedItems already recorded is untouched", async () => {
    const res = await request(app).patch("/tenant/onboarding").set("Authorization", `Bearer ${adminToken}`).send({ dismissed: true });
    expect(res.status).toBe(200);
    expect(res.body.dismissed).toBe(true);
    expect(res.body.completedItems).toEqual(["invite_users", "review_departments"]);
  });

  it("a non-admin can read it but not change it", async () => {
    const read = await request(app).get("/tenant/onboarding").set("Authorization", `Bearer ${operatorToken}`);
    expect(read.status).toBe(200);

    const write = await request(app).patch("/tenant/onboarding").set("Authorization", `Bearer ${operatorToken}`).send({ dismissed: false });
    expect(write.status).toBe(403);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/tenant/onboarding")).status).toBe(401);
  });
});
