// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Regression coverage for Full-System Audit finding C2: the training
// router had NO RBAC gate at all, and no ResourceKey existed in the
// permission system to add one — structurally excluded, not just
// mis-wired. Any authenticated tenant user could create courses, assign
// training, mark any employee's assignment complete, and upload a
// "certificate" for anyone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { trainingCourses, trainingAssignments } from "../../src/drizzle/schema/training.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { notificationLog } from "../../src/drizzle/schema/notifications.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let courseId: number;
let traineeUserId: number;
const userIds: number[] = [];
let qualityToken: string;
let engineeringToken: string;

async function makeUser(department: string | null) {
  const [user] = await db.insert(users).values({ tenantId, email: `training-test-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return { id: user!.id, token: signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName: "operator", department }) };
}

describe("Training module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Training Test Tenant ${suffix}`, code: `training-test-${suffix}` }).returning();
    tenantId = tenant!.id;
    await seedDefaultPermissions(tenantId);

    const quality = await makeUser("quality");
    qualityToken = quality.token;
    const engineering = await makeUser("engineering");
    engineeringToken = engineering.token;
    const trainee = await makeUser("production");
    traineeUserId = trainee.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    // Assigning training now tells the person, which leaves a notice behind.
    await db.delete(notificationLog).where(eq(notificationLog.tenantId, tenantId));
    if (courseId) {
      await db.delete(trainingAssignments).where(eq(trainingAssignments.courseId, courseId));
      await db.delete(trainingCourses).where(eq(trainingCourses.id, courseId));
    }
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("engineering (read-only per the new matrix) cannot create a course", async () => {
    const res = await request(app).post("/training").set("Authorization", `Bearer ${engineeringToken}`).send({ title: "Should be blocked" });
    expect(res.status).toBe(403);
  });

  it("quality (edit) can create a real course", async () => {
    const res = await request(app).post("/training").set("Authorization", `Bearer ${qualityToken}`).send({ title: "ISO 9001 Awareness" });
    expect(res.status).toBe(201);
    courseId = res.body.id;
  });

  it("engineering can read the course list (real read access)", async () => {
    const res = await request(app).get("/training").set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((c: { id: number }) => c.id === courseId)).toBe(true);
  });

  it("engineering cannot assign training — previously anyone could assign to anyone", async () => {
    const res = await request(app).post(`/training/${courseId}/assign`).set("Authorization", `Bearer ${engineeringToken}`).send({ userIds: [traineeUserId] });
    expect(res.status).toBe(403);
  });

  it("quality can assign training to a real employee", async () => {
    const res = await request(app).post(`/training/${courseId}/assign`).set("Authorization", `Bearer ${qualityToken}`).send({ userIds: [traineeUserId] });
    expect(res.status).toBe(201);
  });

  it("engineering cannot mark someone else's assignment complete — previously anyone could complete anyone's training", async () => {
    const [assignment] = await db.select().from(trainingAssignments).where(eq(trainingAssignments.courseId, courseId));
    const res = await request(app).post(`/training/assignment/${assignment!.id}/complete`).set("Authorization", `Bearer ${engineeringToken}`).send({});
    expect(res.status).toBe(403);
  });

  it("quality can mark the assignment complete", async () => {
    const [assignment] = await db.select().from(trainingAssignments).where(eq(trainingAssignments.courseId, courseId));
    const res = await request(app).post(`/training/assignment/${assignment!.id}/complete`).set("Authorization", `Bearer ${qualityToken}`).send({ trainerName: "J. Smith" });
    expect(res.status).toBe(200);
    expect(res.body.completedAt).toBeTruthy();
    // status is the actual field the "overdue" vs "completed" distinction
    // reads from (dueAt/completedAt alone don't say which side of that line
    // an assignment is on) — completeTrainingAssignment must flip it, not
    // just stamp completedAt.
    expect(res.body.status).toBe("completed");
  });

  // Full-System Audit finding H7 — everything above was already covered by
  // the C2 RBAC fix; the real remaining gap was course update and the
  // employee-history read path, neither of which had any coverage at all.
  it("quality can update a course's title/description; engineering (read-only) cannot", async () => {
    const blocked = await request(app).patch(`/training/${courseId}`).set("Authorization", `Bearer ${engineeringToken}`).send({ title: "Should be blocked" });
    expect(blocked.status).toBe(403);

    const res = await request(app).patch(`/training/${courseId}`).set("Authorization", `Bearer ${qualityToken}`).send({ title: "ISO 9001 Awareness (Rev B)", description: "Updated content" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("ISO 9001 Awareness (Rev B)");
    expect(res.body.description).toBe("Updated content");
  });

  it("a due date set at assignment time round-trips correctly through the employee history endpoint", async () => {
    const [course] = await db.insert(trainingCourses).values({ tenantId, title: "Due-date fixture course" }).returning();
    const dueAt = new Date(Date.UTC(2027, 0, 15));
    const assign = await request(app).post(`/training/${course!.id}/assign`).set("Authorization", `Bearer ${qualityToken}`).send({ userIds: [traineeUserId], dueAt: dueAt.toISOString() });
    expect(assign.status).toBe(201);
    expect(new Date(assign.body[0].dueAt).getTime()).toBe(dueAt.getTime());

    const history = await request(app).get(`/training/employee/${traineeUserId}/history`).set("Authorization", `Bearer ${qualityToken}`);
    expect(history.status).toBe(200);
    const entry = history.body.find((h: { courseId: number }) => h.courseId === course!.id);
    expect(entry).toBeTruthy();
    expect(new Date(entry.dueAt).getTime()).toBe(dueAt.getTime());
    expect(entry.status).toBe("assigned"); // not yet completed

    await db.delete(trainingAssignments).where(eq(trainingAssignments.courseId, course!.id));
    await db.delete(trainingCourses).where(eq(trainingCourses.id, course!.id));
  });
});
