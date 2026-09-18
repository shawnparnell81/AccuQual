// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Full-System Audit finding H4: NCR — this app's highest-traffic module,
// and the one every other quality workflow (CAPA/8D/receiving automation)
// hangs off — had zero dedicated test coverage. Every existing reference to
// POST /ncr in the suite was incidental (a fixture for an unrelated RBAC or
// audit-trail test), never a test of the NCR workflow itself
// (open -> contained -> investigating -> corrective_action -> closed, each
// step gated by ncr.service.ts's own expectedFrom check).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
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
  const [user] = await db.insert(users).values({ tenantId, email: `ncr-workflow-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName: "operator", department });
}

async function createNcr(token: string, title: string) {
  const res = await request(app).post("/ncr").set("Authorization", `Bearer ${token}`).send({ title, severity: "high" });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("NCR workflow (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `NCR Workflow Test Tenant ${suffix}`, code: `ncr-workflow-${suffix}` }).returning();
    tenantId = tenant!.id;
    await seedDefaultPermissions(tenantId);

    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering"); // ncr's default permissions are quality-only — engineering has zero access
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(formData).where(eq(formData.tenantId, tenantId));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(ncr).where(eq(ncr.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("engineering (zero access to ncr) cannot create an NCR at all", async () => {
    const res = await request(app).post("/ncr").set("Authorization", `Bearer ${engineeringToken}`).send({ title: "Should be blocked" });
    expect(res.status).toBe(403);
  });

  it("a fresh NCR starts in status open", async () => {
    const id = await createNcr(qualityToken, "Fresh NCR");
    const res = await request(app).get(`/ncr/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.body.status).toBe("open");
  });

  it("root-cause cannot be recorded before containment — the workflow rejects out-of-order steps", async () => {
    const id = await createNcr(qualityToken, "Out of order NCR");
    const res = await request(app).post(`/ncr/${id}/root-cause`).set("Authorization", `Bearer ${qualityToken}`).send({ rootCause: "Skipped containment" });
    expect(res.status).toBe(400);
  });

  it("closing an NCR straight from open is rejected — must go through the full sequence", async () => {
    const id = await createNcr(qualityToken, "Premature close NCR");
    const res = await request(app).post(`/ncr/${id}/close`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(400);
  });

  it("walks the real containment -> root-cause -> corrective-action -> close sequence, each step advancing status", async () => {
    const id = await createNcr(qualityToken, "Full lifecycle NCR");

    const containment = await request(app).post(`/ncr/${id}/containment`).set("Authorization", `Bearer ${qualityToken}`).send({ containment: "Quarantined the affected lot" });
    expect(containment.status).toBe(200);
    expect(containment.body.status).toBe("contained");
    expect(containment.body.containment).toBe("Quarantined the affected lot");

    const rootCause = await request(app).post(`/ncr/${id}/root-cause`).set("Authorization", `Bearer ${qualityToken}`).send({ rootCause: "Fixture misalignment on line 2" });
    expect(rootCause.status).toBe(200);
    expect(rootCause.body.status).toBe("investigating");

    const correctiveAction = await request(app).post(`/ncr/${id}/corrective-action`).set("Authorization", `Bearer ${qualityToken}`).send({ correctiveAction: "Replaced and recalibrated fixture" });
    expect(correctiveAction.status).toBe(200);
    expect(correctiveAction.body.status).toBe("corrective_action");

    const closed = await request(app).post(`/ncr/${id}/close`).set("Authorization", `Bearer ${qualityToken}`);
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
    expect(closed.body.closedAt).toBeTruthy();

    // Real audit trail, not just the row's own status column — this is what
    // the record's History tab and workflow-engine triggers both read from.
    const trail = await db.select().from(auditTrail).where(eq(auditTrail.entityId, id));
    const actions = trail.filter((t) => t.entityType === "NCR").map((t) => (t.changes as { action?: string })?.action);
    expect(actions).toEqual(expect.arrayContaining(["containment", "root_cause", "corrective_action", "closed"]));
  });

  it("assign works from any status — it isn't a lifecycle step", async () => {
    const id = await createNcr(qualityToken, "Assignable NCR");
    const [target] = await db.insert(users).values({ tenantId, email: `ncr-assignee-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(target!.id);

    const res = await request(app).post(`/ncr/${id}/assign`).set("Authorization", `Bearer ${qualityToken}`).send({ assignedTo: target!.id });
    expect(res.status).toBe(200);
    expect(res.body.assignedTo).toBe(target!.id);
    expect(res.body.status).toBe("open"); // unchanged — assignment isn't a status transition
  });
});
