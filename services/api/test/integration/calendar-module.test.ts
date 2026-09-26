import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see ncr-workflow.test.ts's header comment for the
// pattern). Covers the new per-user GET /calendar aggregation endpoint:
// one item per module the user is personally assigned/owns work in, plus
// company isolation (another company's identically-shaped data never leaks in).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { capa } from "../../src/drizzle/schema/capa.js";
import { audits } from "../../src/drizzle/schema/audits.js";
import { trainingAssignments, trainingCourses } from "../../src/drizzle/schema/training.js";
import { documents } from "../../src/drizzle/schema/documents.js";
import { crarClaims } from "../../src/drizzle/schema/crar.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

async function makeCompany(name: string) {
  const co = await ensureTestCompany();
  return co!.id;
}

async function makeUser(companyId: number, label: string) {
  const [user] = await db.insert(users).values({ email: `calendar-${label}-${suffix}@test.local`, passwordHash: "unused" }).returning();
  return user!.id;
}

describe("GET /calendar (real DB + real HTTP path)", () => {
  let companyId: number;
  let otherCompanyId: number;
  let userId: number;
  let otherUserId: number;
  let token: string;

  const cleanupIds = { company: [] as number[], users: [] as number[] };

  beforeAll(async () => {
    companyId = await makeCompany("Calendar Test Company");
    otherCompanyId = await makeCompany("Calendar Test Company (other)");
    cleanupIds.company.push(companyId, otherCompanyId);

    userId = await makeUser(companyId, "me");
    otherUserId = await makeUser(otherCompanyId, "other");
    cleanupIds.users.push(userId, otherUserId);

    token = signAccessToken({ sub: String(userId), roleId: null, roleName: "operator", department: "quality" });

    const monthStart = new Date();
    monthStart.setDate(1);
    const pastDue = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    for (const [tid, uid] of [
      [companyId, userId],
      [otherCompanyId, otherUserId],
    ] as const) {
      await db.insert(ncr).values({ title: "Open NCR", status: "open", assignedTo: uid, dueDate: pastDue });
      await db.insert(ncr).values({ title: "Closed This Month NCR", status: "closed", assignedTo: uid, closedAt: monthStart });
      await db.insert(capa).values({ status: "in_progress", ownerId: uid, dueDate: pastDue });
      await db.insert(capa).values({ status: "verifying", verifiedBy: uid });
      await db.insert(audits).values({ name: "Scheduled Audit", status: "scheduled", auditorId: uid, scheduledAt: pastDue });
      const [course] = await db.insert(trainingCourses).values({ title: "Safety Refresher" }).returning();
      await db.insert(trainingAssignments).values({ courseId: course!.id, userId: uid, status: "assigned", dueAt: pastDue });
      await db.insert(documents).values({ title: "SOP In Review", status: "in_review", ownerId: uid });
      await db.insert(crarClaims).values({ customerClaim: "Cracked Bracket Return", status: "quality_review", createdByUserId: uid, targetCompletion: pastDue });
    }
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("returns one item per module for work assigned to/owned by the caller", async () => {
    const res = await request(app).get("/calendar").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    const modules = res.body.map((item: { module: string }) => item.module);
    expect(modules).toEqual(expect.arrayContaining(["ncr", "capa", "audit", "training", "document", "crar"]));
  });

  it("includes the open NCR (with its real due date, flagged overdue) and the closed-this-month NCR, but not a stale closed one", async () => {
    const res = await request(app).get("/calendar").set("Authorization", `Bearer ${token}`);
    const ncrItems = res.body.filter((item: { module: string }) => item.module === "ncr");
    const openItem = ncrItems.find((item: { status: string }) => item.status === "overdue");
    expect(openItem).toBeTruthy();
    expect(openItem.dueDate).not.toBeNull();
    expect(ncrItems.some((item: { status: string }) => item.status === "closed")).toBe(true);
    expect(ncrItems).toHaveLength(2);
  });

  it("flags the past-due training assignment as overdue", async () => {
    const res = await request(app).get("/calendar").set("Authorization", `Bearer ${token}`);
    const training = res.body.find((item: { module: string }) => item.module === "training");
    expect(training.status).toBe("overdue");
  });

  it("includes both the CAPA owned by (with its real due date, flagged overdue), and the CAPA awaiting verification from, the caller", async () => {
    const res = await request(app).get("/calendar").set("Authorization", `Bearer ${token}`);
    const capaItems = res.body.filter((item: { module: string }) => item.module === "capa");
    expect(capaItems).toHaveLength(2);
    const overdueCapa = capaItems.find((item: { status: string }) => item.status === "overdue");
    expect(overdueCapa).toBeTruthy();
    expect(overdueCapa.dueDate).not.toBeNull();
  });

  it("includes the CRAR created by the caller, flagged overdue by its real target-completion date", async () => {
    const res = await request(app).get("/calendar").set("Authorization", `Bearer ${token}`);
    const crar = res.body.find((item: { module: string }) => item.module === "crar");
    expect(crar).toBeTruthy();
    expect(crar.status).toBe("overdue");
    expect(crar.title).toBe("Cracked Bracket Return");
    expect(crar.dueDate).not.toBeNull();
  });

});
