import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Full-System Audit finding H4: 8D had zero test references anywhere in the
// suite — no RBAC check (this is also the module Phase 3's own audit found
// had NO requireDepartmentAccess gate at all until it was added, see
// eight-d.routes.ts's comment), and no coverage of completeStepHandler's
// step-progression/audit-trail behavior.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { eightD } from "../../src/drizzle/schema/eightD.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;
const userIds: number[] = [];
let qualityToken: string;
let engineeringToken: string;

async function makeUser(department: string | null) {
  const [user] = await db.insert(users).values({ email: `eight-d-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

async function create8D(token: string) {
  const res = await request(app).post("/8d").set("Authorization", `Bearer ${token}`).send({});
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("8D report module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    await seedDefaultPermissions(companyId);

    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering"); // eight_d's default permissions are quality-only
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("engineering (zero access to eight_d) cannot create or read an 8D report", async () => {
    const create = await request(app).post("/8d").set("Authorization", `Bearer ${engineeringToken}`).send({});
    expect(create.status).toBe(403);

    const id = await create8D(qualityToken);
    const read = await request(app).get(`/8d/${id}`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(read.status).toBe(403);
  });

  it("a fresh 8D report starts at step 1 with empty data", async () => {
    const id = await create8D(qualityToken);
    const res = await request(app).get(`/8d/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.body.currentStep).toBe(1);
    expect(res.body.data).toEqual({});
  });

  it("completing a step stores its data under the right D-key and advances currentStep", async () => {
    const id = await create8D(qualityToken);

    const d1 = await request(app).post(`/8d/${id}/complete-step/1`).set("Authorization", `Bearer ${qualityToken}`).send({ data: { members: ["Alice", "Bob"] } });
    expect(d1.status).toBe(200);
    expect(d1.body.currentStep).toBe(2);
    expect(d1.body.data.d1_team).toEqual({ members: ["Alice", "Bob"] });

    const d2 = await request(app).post(`/8d/${id}/complete-step/2`).set("Authorization", `Bearer ${qualityToken}`).send({ data: { statement: "Widget fails under load" } });
    expect(d2.status).toBe(200);
    expect(d2.body.currentStep).toBe(3);
    // Completing D2 must not clobber D1's already-stored data.
    expect(d2.body.data.d1_team).toEqual({ members: ["Alice", "Bob"] });
    expect(d2.body.data.d2_problem).toEqual({ statement: "Widget fails under load" });
  });

  it("completing D8 records a closure audit-trail entry, not just an ordinary update", async () => {
    const id = await create8D(qualityToken);
    const res = await request(app).post(`/8d/${id}/complete-step/8`).set("Authorization", `Bearer ${qualityToken}`).send({ data: { closureNotes: "Verified effective" } });
    expect(res.status).toBe(200);
    expect(res.body.currentStep).toBe(8); // clamped — there's no step 9

    const trail = await db.select().from(auditTrail).where(eq(auditTrail.entityId, id));
    const closureEntry = trail.find((t) => t.entityType === "8D Report" && (t.changes as { closed?: boolean })?.closed === true);
    expect(closureEntry).toBeTruthy();
    expect(closureEntry?.action).toBe("status_change");
  });

  it("a step outside 1-8 is rejected", async () => {
    const id = await create8D(qualityToken);
    const res = await request(app).post(`/8d/${id}/complete-step/9`).set("Authorization", `Bearer ${qualityToken}`).send({ data: {} });
    expect(res.status).toBe(400);
  });
});
