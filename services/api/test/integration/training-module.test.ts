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
  });
});
