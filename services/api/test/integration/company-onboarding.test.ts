import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see the other integration tests's header comment).
// First-run onboarding checklist: GET/PATCH /company/onboarding — merge-patch (mirrors /users/me/theme's own
// merge-patch shape), admin-only PATCH, and a sane default for a company whose onboardingProgress is still NULL
// (a company created before this shipped and not yet backfilled — see backfillOnboardingChecklist.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;
let adminId: number;
let operatorId: number;
let adminToken: string;
let operatorToken: string;

async function makeUser(label: string, roleName: string) {
  const [user] = await db.insert(users).values({ email: `onboarding-${label}-${suffix}@test.local`, passwordHash: "unused" }).returning();
  const token = await signAccessToken({ sub: String(user!.id), roleId: null, roleName, department: null });
  return { id: user!.id, token };
}

describe("First-run onboarding checklist (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    // No onboardingProgress passed — leaves it NULL, same as a company that existed before this shipped and hasn't
    // been through backfillOnboardingChecklist.ts yet.
    const co = await ensureTestCompany();
    companyId = co!.id;
    const admin = await makeUser("admin", "admin");
    const operator = await makeUser("operator", "operator");
    adminId = admin.id;
    operatorId = operator.id;
    adminToken = admin.token;
    operatorToken = operator.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("reads back a sane default (not null) when onboardingProgress itself is still NULL", async () => {
    const res = await request(app).get("/company/onboarding").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dismissed: false, completedItems: [] });
  });

  it("marking one item complete merge-patches — dismissed is untouched", async () => {
    const res = await request(app).patch("/company/onboarding").set("Authorization", `Bearer ${adminToken}`).send({ completedItems: ["invite_users"] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dismissed: false, completedItems: ["invite_users"] });

    const again = await request(app).patch("/company/onboarding").set("Authorization", `Bearer ${adminToken}`).send({ completedItems: ["invite_users", "review_departments"] });
    expect(again.body.completedItems).toEqual(["invite_users", "review_departments"]);
    expect(again.body.dismissed).toBe(false);
  });

  it("dismissing merge-patches too — completedItems already recorded is untouched", async () => {
    const res = await request(app).patch("/company/onboarding").set("Authorization", `Bearer ${adminToken}`).send({ dismissed: true });
    expect(res.status).toBe(200);
    expect(res.body.dismissed).toBe(true);
    expect(res.body.completedItems).toEqual(["invite_users", "review_departments"]);
  });

  it("a non-admin can read it but not change it", async () => {
    const read = await request(app).get("/company/onboarding").set("Authorization", `Bearer ${operatorToken}`);
    expect(read.status).toBe(200);

    const write = await request(app).patch("/company/onboarding").set("Authorization", `Bearer ${operatorToken}`).send({ dismissed: false });
    expect(write.status).toBe(403);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/company/onboarding")).status).toBe(401);
  });
});
