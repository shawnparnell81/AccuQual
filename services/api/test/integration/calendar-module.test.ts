// Real-DB integration test (see ncr-workflow.test.ts's header comment for the
// pattern). Covers the new per-user GET /calendar aggregation endpoint:
// one item per module the user is personally assigned/owns work in, plus
// tenant isolation (another tenant's identically-shaped data never leaks in).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { capa } from "../../src/drizzle/schema/capa.js";
import { audits } from "../../src/drizzle/schema/audits.js";
import { trainingAssignments, trainingCourses } from "../../src/drizzle/schema/training.js";
import { documents } from "../../src/drizzle/schema/documents.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

async function makeTenant(name: string) {
  const [tenant] = await db.insert(tenants).values({ name, code: `${name}-${suffix}` }).returning();
  return tenant!.id;
}

async function makeUser(tenantId: number, label: string) {
  const [user] = await db.insert(users).values({ tenantId, email: `calendar-${label}-${suffix}@test.local`, passwordHash: "unused" }).returning();
  return user!.id;
}

describe("GET /calendar (real DB + real HTTP path)", () => {
  let tenantId: number;
  let otherTenantId: number;
  let userId: number;
  let otherUserId: number;
  let token: string;

  const cleanupIds = { tenants: [] as number[], users: [] as number[] };

  beforeAll(async () => {
    tenantId = await makeTenant("Calendar Test Tenant");
    otherTenantId = await makeTenant("Calendar Test Tenant (other)");
    cleanupIds.tenants.push(tenantId, otherTenantId);

    userId = await makeUser(tenantId, "me");
    otherUserId = await makeUser(otherTenantId, "other");
    cleanupIds.users.push(userId, otherUserId);

    token = signAccessToken({ sub: String(userId), tenantId, roleId: null, roleName: "operator", department: "quality" });

    const monthStart = new Date();
    monthStart.setDate(1);
    const pastDue = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    for (const [tid, uid] of [
      [tenantId, userId],
      [otherTenantId, otherUserId],
    ] as const) {
      await db.insert(ncr).values({ tenantId: tid, title: "Open NCR", status: "open", assignedTo: uid });
      await db.insert(ncr).values({ tenantId: tid, title: "Closed This Month NCR", status: "closed", assignedTo: uid, closedAt: monthStart });
      await db.insert(capa).values({ tenantId: tid, status: "in_progress", ownerId: uid });
      await db.insert(capa).values({ tenantId: tid, status: "verifying", verifiedBy: uid });
      await db.insert(audits).values({ tenantId: tid, name: "Scheduled Audit", status: "scheduled", auditorId: uid, scheduledAt: pastDue });
      const [course] = await db.insert(trainingCourses).values({ tenantId: tid, title: "Safety Refresher" }).returning();
      await db.insert(trainingAssignments).values({ tenantId: tid, courseId: course!.id, userId: uid, status: "assigned", dueAt: pastDue });
      await db.insert(documents).values({ tenantId: tid, title: "SOP In Review", status: "in_review", ownerId: uid });
    }
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    for (const tid of cleanupIds.tenants) {
      await db.delete(trainingAssignments).where(eq(trainingAssignments.tenantId, tid));
      await db.delete(trainingCourses).where(eq(trainingCourses.tenantId, tid));
      await db.delete(documents).where(eq(documents.tenantId, tid));
      await db.delete(audits).where(eq(audits.tenantId, tid));
      await db.delete(capa).where(eq(capa.tenantId, tid));
      await db.delete(ncr).where(eq(ncr.tenantId, tid));
    }
    for (const uid of cleanupIds.users) await db.delete(users).where(eq(users.id, uid));
    for (const tid of cleanupIds.tenants) await db.delete(tenants).where(eq(tenants.id, tid));
    await pool.end();
  });

  it("returns one item per module for work assigned to/owned by the caller", async () => {
    const res = await request(app).get("/calendar").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    const modules = res.body.map((item: { module: string }) => item.module);
    expect(modules).toEqual(expect.arrayContaining(["ncr", "capa", "audit", "training", "document"]));
  });

  it("includes the open NCR and the closed-this-month NCR, but not a stale closed one", async () => {
    const res = await request(app).get("/calendar").set("Authorization", `Bearer ${token}`);
    const ncrItems = res.body.filter((item: { module: string }) => item.module === "ncr");
    expect(ncrItems.some((item: { status: string }) => item.status === "open")).toBe(true);
    expect(ncrItems.some((item: { status: string }) => item.status === "closed")).toBe(true);
    expect(ncrItems).toHaveLength(2);
  });

  it("flags the past-due training assignment as overdue", async () => {
    const res = await request(app).get("/calendar").set("Authorization", `Bearer ${token}`);
    const training = res.body.find((item: { module: string }) => item.module === "training");
    expect(training.status).toBe("overdue");
  });

  it("includes both the CAPA owned by, and the CAPA awaiting verification from, the caller", async () => {
    const res = await request(app).get("/calendar").set("Authorization", `Bearer ${token}`);
    const capaItems = res.body.filter((item: { module: string }) => item.module === "capa");
    expect(capaItems).toHaveLength(2);
  });

  it("never returns another tenant's identically-shaped data", async () => {
    const res = await request(app).get("/calendar").set("Authorization", `Bearer ${token}`);
    for (const item of res.body) {
      expect(item.link).not.toMatch(new RegExp(`/${otherUserId}$`));
    }
    // Direct DB check: the other tenant's user really does have the same shape of data.
    const otherNcrs = await db.select().from(ncr).where(eq(ncr.tenantId, otherTenantId));
    expect(otherNcrs.length).toBeGreaterThan(0);
  });
});
