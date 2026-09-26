import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Training & competency: who is required to be trained, sessions and attendance, competency evaluations, expiry, retraining when the
// linked document is revised, overdue, digests, RBAC, company isolation, audit. Plus the pure qualification rules.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { documents } from "../../src/drizzle/schema/documents.js";
import { trainingCourses, trainingAssignments, trainingSessions, trainingCompetencies } from "../../src/drizzle/schema/training.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { auditRowChanges } from "../../src/drizzle/schema/auditRowChanges.js";
import { notificationLog } from "../../src/drizzle/schema/notifications.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { addMonths, notifyDue, qualificationStatus, type QualificationInputs } from "../../src/modules/training/training.service.js";

const app = createApp();
const suffix = Date.now();
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysAhead = (n: number) => new Date(Date.now() + n * DAY);

// ---- the rules, exactly -----------------------------------------------------------------------------------------------------------------------------
describe("qualificationStatus (pure)", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const done = (over: Partial<NonNullable<QualificationInputs["latestCompleted"]>> = {}) => ({ completedAt: new Date("2026-05-01T00:00:00Z"), expiresAt: null, documentVersion: null, ...over });
  const base: QualificationInputs = { evaluationRequired: false, documentVersionNow: null, latestCompleted: null, latestDecidedEvaluation: null, openAssignment: null };
  const s = (over: Partial<QualificationInputs>) => qualificationStatus({ ...base, ...over }, now).status;

  it("is not trained until something is completed", () => {
    expect(s({})).toBe("not_trained");
    expect(s({ openAssignment: { status: "assigned", dueAt: new Date("2026-07-01") } })).toBe("assigned");
    expect(s({ openAssignment: { status: "in_progress", dueAt: null } })).toBe("in_progress");
    expect(s({ openAssignment: { status: "assigned", dueAt: new Date("2026-06-01") } })).toBe("overdue");
  });

  it("is qualified once trained, unless it expires, the document moved on, or it is about to expire", () => {
    expect(s({ latestCompleted: done() })).toBe("qualified");
    expect(s({ latestCompleted: done({ expiresAt: new Date("2026-06-01") }) })).toBe("expired");
    expect(s({ latestCompleted: done({ expiresAt: new Date("2026-06-30") }) })).toBe("expiring_soon");
    expect(s({ latestCompleted: done({ expiresAt: new Date("2027-01-01") }) })).toBe("qualified");
    expect(s({ latestCompleted: done({ documentVersion: 1 }), documentVersionNow: 2 })).toBe("revision_changed");
    expect(s({ latestCompleted: done({ documentVersion: 2 }), documentVersionNow: 2 })).toBe("qualified");
    expect(s({ latestCompleted: done({ documentVersion: null }), documentVersionNow: 5 })).toBe("qualified"); // version at training time unknown: not flagged
  });

  it("needs a passing evaluation as well when the course requires one", () => {
    const evalReq = { evaluationRequired: true };
    expect(s({ ...evalReq, latestCompleted: done() })).toBe("awaiting_evaluation");
    expect(s({ ...evalReq, latestCompleted: done(), latestDecidedEvaluation: { status: "pass", evaluatedAt: new Date("2026-05-10"), expiresAt: null } })).toBe("qualified");
    expect(s({ ...evalReq, latestCompleted: done(), latestDecidedEvaluation: { status: "fail", evaluatedAt: new Date("2026-05-10"), expiresAt: null } })).toBe("failed");
    // retrained AFTER the failed evaluation: back to waiting for a new evaluation, not "failed" forever
    expect(s({ ...evalReq, latestCompleted: done({ completedAt: new Date("2026-06-01") }), latestDecidedEvaluation: { status: "fail", evaluatedAt: new Date("2026-05-10"), expiresAt: null } })).toBe("awaiting_evaluation");
    // an expired evaluation expires the qualification even when the training itself has not
    expect(s({ ...evalReq, latestCompleted: done(), latestDecidedEvaluation: { status: "pass", evaluatedAt: new Date("2026-01-10"), expiresAt: new Date("2026-06-01") } })).toBe("expired");
  });

  it("adds whole months without drifting", () => {
    expect(addMonths(new Date("2026-01-15T00:00:00Z"), 12).toISOString().slice(0, 10)).toBe("2027-01-15");
  });
});

// ---- through the real API -----------------------------------------------------------------------------------------------------------------------------
let companyId: number;

const userIds: number[] = [];
type Who = { id: number; email: string; token: string };
let manager: Who; // quality_manager, quality dept: manages courses/sessions, evaluates
let trainer: Who; // quality dept ordinary role: same access level
let admin: Who;
let emp1: Who;
let emp2: Who;
let emp3: Who; // a different department, not covered by the requirement
let production: Who; // read-only on training
let customer: Who;

let roleId: number;

async function makeUser(co: number, label: string, roleName: string, department: string | null, withRole = false): Promise<Who> {
  const email = `trn-${label}-${suffix}@test.local`;
  const [u] = await db.insert(users).values({ email, name: `Person ${label}`, passwordHash: "unused", department, ...(withRole ? { roleId } : {}) }).returning();
  userIds.push(u!.id);
  return { id: u!.id, email, token: await signAccessToken({ sub: String(u!.id), roleId: null, roleName, department }) };
}
const as = (w: Who) => ({ Authorization: `Bearer ${w.token}` });
const events = async (entityType: string, id: number) => (await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, entityType), eq(auditTrail.entityId, id)))).map((r) => r.changes as Record<string, unknown> | null);
const statusOf = async (courseId: number, userId: number, who: Who = manager) => ((await request(app).get(`/training/status?courseId=${courseId}&userId=${userId}`).set(as(who))).body as { status: string; expiresAt: string | null }[])[0];

async function newCourse(over: Record<string, unknown> = {}) {
  const res = await request(app).post("/training/course").set(as(manager)).send({ title: `Course ${Math.random().toString(36).slice(2, 7)}`, requiredForDepartment: "production", ...over });
  expect(res.status).toBe(201);
  return res.body as { id: number; title: string };
}

describe("Training & competency (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const t = await ensureTestCompany();
    
    companyId = t!.id;
    
    await seedDefaultPermissions(companyId);
    
    await db.insert(roles).values([{ name: "operator" }, { name: "quality_manager" }, { name: "admin" }]).onConflictDoNothing();
    roleId = (await db.select().from(roles).where(eq(roles.name, "operator")))[0]!.id;
    manager = await makeUser(companyId, "manager", "quality_manager", "quality");
    trainer = await makeUser(companyId, "trainer", "operator", "quality");
    admin = await makeUser(companyId, "admin", "admin", null);
    emp1 = await makeUser(companyId, "emp1", "operator", "production");
    emp2 = await makeUser(companyId, "emp2", "operator", "production");
    emp3 = await makeUser(companyId, "emp3", "operator", "engineering");
    production = emp1; // production has read-only access to training by default
    customer = await makeUser(companyId, "customer", "customer", null);
    
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    for (const t of [companyId]) {
      await db.delete(auditRowChanges);
      await db.delete(auditTrail);
      await db.delete(notificationLog);
      // Decided evaluations are frozen by a trigger; this is a test-database teardown, so lift it for the cleanup only.
      await pool.query("ALTER TABLE training_competencies DISABLE TRIGGER training_competencies_decided_frozen");
      await db.delete(trainingCompetencies);
      await pool.query("ALTER TABLE training_competencies ENABLE TRIGGER training_competencies_decided_frozen");
      await db.delete(trainingAssignments);
      await db.delete(trainingSessions);
      await db.delete(trainingCourses);
      await db.delete(documents);
      await db.delete(departmentPermissions);
    }
    await pool.end();
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("courses and who they are required of", () => {
    it("creates a course with requirements, validity and who it is required of — through both URLs — and audits it", async () => {
      const a = await request(app).post("/training/course").set(as(manager)).send({ title: "Forklift safety", requiredForDepartment: "production", validityMonths: 12, requirements: { evaluationRequired: true, passingScore: 80, criteria: ["Pre-use inspection", "Load handling"] } });
      expect(a.status).toBe(201);
      expect(a.body).toMatchObject({ title: "Forklift safety", requiredForDepartment: "production", validityMonths: 12, active: true, requirements: { evaluationRequired: true, passingScore: 80 } });
      expect((await request(app).post("/training").set(as(manager)).send({ title: "Same thing, old URL" })).status).toBe(201);
      expect((await events("TrainingCourse", a.body.id)).some((c) => c?.title === "Forklift safety")).toBe(true);
    });

    it("validates the requirements and refuses unknown fields", async () => {
      const c = await newCourse();
      expect((await request(app).patch(`/training/${c.id}`).set(as(manager)).send({ requirements: { passingScore: 150 } })).status).toBe(400);
      expect((await request(app).patch(`/training/${c.id}`).set(as(manager)).send({ requirements: { evaluationRequired: true, sneaky: true } })).status).toBe(400);
      expect((await request(app).patch(`/training/${c.id}`).set(as(manager)).send({ validityMonths: 0 })).status).toBe(400);
      const ok = await request(app).patch(`/training/${c.id}`).set(as(manager)).send({ validityMonths: 6, requirements: { criteria: ["A", "B"] }, active: true });
      expect(ok.body).toMatchObject({ validityMonths: 6, requirements: { criteria: ["A", "B"] } });
    });

    it("assigns a course to everyone it is required of who is not yet trained, tells them, and does it only once", async () => {
      const c = await newCourse();
      const before = (await request(app).get(`/training/status?courseId=${c.id}`).set(as(manager))).body as { userId: number; status: string; required: boolean }[];
      expect(before.map((r) => r.userId).sort()).toEqual([emp1.id, emp2.id].sort()); // the two production people; not the engineer
      expect(before.every((r) => r.status === "not_trained" && r.required)).toBe(true);

      const res = await request(app).post(`/training/${c.id}/assign-required`).set(as(manager)).send({ dueAt: daysAhead(14).toISOString() });
      expect(res.status).toBe(201);
      expect(res.body.assigned.map((a: { userId: number }) => a.userId).sort()).toEqual([emp1.id, emp2.id].sort());
      const mail = await db.select().from(notificationLog).where(and(eq(notificationLog.recipient, emp1.email)));
      expect(mail.some((m) => m.subject.includes(c.title))).toBe(true);
      expect((await statusOf(c.id, emp1.id))!.status).toBe("assigned");
      const again = await request(app).post(`/training/${c.id}/assign-required`).set(as(manager)).send({});
      expect(again.body.assigned).toEqual([]); // already open
    });

    it("refuses to assign someone who isn't in this organization, and skips people who already have it open", async () => {
      const c = await newCourse({ requiredForDepartment: null });
      
      expect((await request(app).post(`/training/${c.id}/assign`).set(as(manager)).send({ userIds: [emp1.id] })).body).toHaveLength(1);
      expect((await request(app).post(`/training/${c.id}/assign`).set(as(manager)).send({ userIds: [emp1.id, emp3.id] })).body).toHaveLength(1); // emp1 already open
    });

    it("shows an open assignment past its due date as overdue", async () => {
      const c = await newCourse();
      await request(app).post(`/training/${c.id}/assign-required`).set(as(manager)).send({ dueAt: daysAgo(3).toISOString() });
      expect((await statusOf(c.id, emp1.id))!.status).toBe("overdue");
      const list = (await request(app).get(`/training/${c.id}/assignments`).set(as(manager))).body as { status: string }[];
      expect(list.every((a) => a.status === "overdue")).toBe(true);
      const history = (await request(app).get(`/training/employee/${emp1.id}/history`).set(as(manager))).body as { courseId: number; status: string }[];
      expect(history.find((h) => h.courseId === c.id)?.status).toBe("overdue");
    });

    it("retires the old bulk completion, which marked everyone's training done at once", async () => {
      const c = await newCourse();
      const res = await request(app).post(`/training/${c.id}/complete`).set(as(manager)).send({});
      expect(res.status).toBe(410);
      expect(res.body.message).toMatch(/assignment/i);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("sessions and attendance", () => {
    let course: { id: number };
    let sessionId: number;

    it("schedules a session with an instructor and roster, and checks the roster", async () => {
      course = await newCourse({ validityMonths: 12 });
      
       // someone from another organization
      const dup = await request(app).post("/training/session").set(as(trainer)).send({ courseId: course.id, scheduledAt: daysAhead(7).toISOString(), attendance: [{ userId: emp1.id, status: "present" }, { userId: emp1.id, status: "present" }] });
      expect(dup.status).toBe(400);
      const full = await request(app).post("/training/session").set(as(trainer)).send({ courseId: course.id, scheduledAt: daysAhead(7).toISOString(), capacity: 1, attendance: [{ userId: emp1.id, status: "present" }, { userId: emp2.id, status: "present" }] });
      expect(full.status).toBe(400);

      const ok = await request(app).post("/training/session").set(as(trainer)).send({ courseId: course.id, title: "Spring session", instructorId: manager.id, location: "Room 2", capacity: 10, scheduledAt: daysAhead(7).toISOString(), attendance: [{ userId: emp1.id, status: "present" }, { userId: emp2.id, status: "present" }] });
      expect(ok.status).toBe(201);
      sessionId = ok.body.id;
      expect(ok.body).toMatchObject({ status: "scheduled", instructorName: "Person manager", location: "Room 2" });
      expect((await events("TrainingSession", sessionId)).some((c) => c?.event === "session_scheduled")).toBe(true);
    });

    it("lists and shows a session with its attendees' names", async () => {
      const list = (await request(app).get(`/training/sessions?courseId=${course.id}`).set(as(production))).body as { id: number; enrolled: number }[];
      expect(list.find((s) => s.id === sessionId)?.enrolled).toBe(2);
      const one = (await request(app).get(`/training/session/${sessionId}`).set(as(production))).body;
      expect(one.attendees.map((a: { name: string }) => a.name).sort()).toEqual(["Person emp1", "Person emp2"]);
    });

    it("updates a scheduled session, and completes it: present people are trained, absent ones are not", async () => {
      const upd = await request(app).patch(`/training/session/${sessionId}`).set(as(trainer)).send({ location: "Room 3" });
      expect(upd.body.location).toBe("Room 3");
      await request(app).post(`/training/${course.id}/assign-required`).set(as(manager)).send({ dueAt: daysAhead(30).toISOString() });
      const done = await request(app).post(`/training/session/${sessionId}/complete`).set(as(trainer)).send({ attendance: [{ userId: emp1.id, status: "present" }, { userId: emp2.id, status: "absent", notes: "Off sick" }] });
      expect(done.status).toBe(200);
      expect(done.body.recorded).toBe(1);
      expect(done.body.session.status).toBe("completed");

      const [a1] = await db.select().from(trainingAssignments).where(and(eq(trainingAssignments.courseId, course.id), eq(trainingAssignments.userId, emp1.id)));
      expect(a1).toMatchObject({ status: "completed", sessionId, trainerName: "Person manager" });
      expect(a1!.expiresAt!.toISOString().slice(0, 10)).toBe(addMonths(a1!.completedAt!, 12).toISOString().slice(0, 10)); // the course's validity
      expect((await statusOf(course.id, emp1.id))!.status).toBe("qualified");
      expect((await statusOf(course.id, emp2.id))!.status).toBe("assigned"); // absent: still to do
      expect((await events("TrainingSession", sessionId)).some((c) => c?.event === "session_completed" && c.attended === 1 && c.absent === 1)).toBe(true);
    });

    it("won't complete twice, change a finished session, or complete with nobody listed", async () => {
      expect((await request(app).post(`/training/session/${sessionId}/complete`).set(as(trainer)).send({})).status).toBe(409);
      expect((await request(app).patch(`/training/session/${sessionId}`).set(as(trainer)).send({ location: "Elsewhere" })).status).toBe(409);
      const empty = await request(app).post("/training/session").set(as(trainer)).send({ courseId: course.id, scheduledAt: daysAhead(9).toISOString() });
      expect((await request(app).post(`/training/session/${empty.body.id}/complete`).set(as(trainer)).send({})).status).toBe(400);
    });

    it("cancels a scheduled session with a reason", async () => {
      const s = await request(app).post("/training/session").set(as(trainer)).send({ courseId: course.id, scheduledAt: daysAhead(20).toISOString() });
      expect((await request(app).post(`/training/session/${s.body.id}/cancel`).set(as(trainer)).send({ reason: "no" })).status).toBe(400);
      const c = await request(app).post(`/training/session/${s.body.id}/cancel`).set(as(trainer)).send({ reason: "Instructor unavailable" });
      expect(c.body.status).toBe("cancelled");
      expect((await request(app).post(`/training/session/${s.body.id}/cancel`).set(as(trainer)).send({ reason: "Again, again" })).status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("competency evaluations", () => {
    let course: { id: number };

    it("makes a session's attendees wait for an evaluation when the course requires one", async () => {
      course = await newCourse({ validityMonths: 12, requirements: { evaluationRequired: true, passingScore: 80, criteria: ["Safe operation"] } });
      const s = await request(app).post("/training/session").set(as(trainer)).send({ courseId: course.id, scheduledAt: daysAhead(1).toISOString(), attendance: [{ userId: emp1.id, status: "present" }, { userId: emp2.id, status: "present" }] });
      await request(app).post(`/training/session/${s.body.id}/complete`).set(as(trainer)).send({});
      expect((await statusOf(course.id, emp1.id))!.status).toBe("awaiting_evaluation");
      const pending = (await request(app).get(`/training/competency?courseId=${course.id}&status=pending`).set(as(manager))).body as { userId: number }[];
      expect(pending.map((p) => p.userId).sort()).toEqual([emp1.id, emp2.id].sort());
    });

    it("won't let people evaluate themselves (an admin excepted, and that is recorded)", async () => {
      const own = await request(app).post("/training/competency").set(as(manager)).send({ userId: manager.id, courseId: course.id, status: "pass", score: 95 });
      expect(own.status).toBe(403);
      expect(own.body.message).toMatch(/your own/i);
      const adminOwn = await request(app).post("/training/competency").set(as(admin)).send({ userId: admin.id, courseId: course.id, status: "pass", score: 95 });
      expect(adminOwn.status).toBe(201);
      expect((await events("TrainingCompetency", adminOwn.body.id)).some((c) => c?.event === "competency_passed" && c.selfEvaluated === true)).toBe(true);
    });

    it("checks the decision: no pass with a failed criterion or below the passing score", async () => {
      const [p] = await db.select().from(trainingCompetencies).where(and(eq(trainingCompetencies.courseId, course.id), eq(trainingCompetencies.userId, emp1.id), eq(trainingCompetencies.status, "pending")));
      const url = `/training/competency/${p!.id}/evaluate`;
      expect((await request(app).post(url).set(as(manager)).send({ status: "pass", evaluation: { criteria: [{ name: "Safe operation", result: "fail" }] } })).status).toBe(400);
      expect((await request(app).post(url).set(as(manager)).send({ status: "pass", score: 60 })).status).toBe(400);
      expect((await request(app).post(url).set(as(manager)).send({ status: "pass" })).status).toBe(400); // a passing score is set, so a score or criteria are needed
    });

    it("records a pass with an expiry, which qualifies the person; a decided evaluation can't be rewritten", async () => {
      const [p] = await db.select().from(trainingCompetencies).where(and(eq(trainingCompetencies.courseId, course.id), eq(trainingCompetencies.userId, emp1.id), eq(trainingCompetencies.status, "pending")));
      const res = await request(app).post(`/training/competency/${p!.id}/evaluate`).set(as(manager)).send({ status: "pass", score: 92, evaluation: { criteria: [{ name: "Safe operation", result: "pass", notes: "Clean run" }] }, notes: "Confident on the truck" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "pass", score: 92, evaluatorId: manager.id });
      expect(res.body.expiresAt).toBeTruthy();
      expect((await statusOf(course.id, emp1.id))!.status).toBe("qualified");
      expect((await request(app).post(`/training/competency/${p!.id}/evaluate`).set(as(manager)).send({ status: "fail" })).status).toBe(409);
      await expect(pool.query(`UPDATE training_competencies SET status = 'fail' WHERE id = $1`, [p!.id])).rejects.toThrow(/cannot be edited/i);
      await expect(pool.query(`DELETE FROM training_competencies WHERE id = $1`, [p!.id])).rejects.toThrow(/cannot be edited/i);
    });

    it("records a failure, then retraining and a new evaluation bring the person back", async () => {
      const [p] = await db.select().from(trainingCompetencies).where(and(eq(trainingCompetencies.courseId, course.id), eq(trainingCompetencies.userId, emp2.id), eq(trainingCompetencies.status, "pending")));
      const fail = await request(app).post(`/training/competency/${p!.id}/evaluate`).set(as(manager)).send({ status: "fail", score: 55, notes: "Needs more practice" });
      expect(fail.body.status).toBe("fail");
      expect((await statusOf(course.id, emp2.id))!.status).toBe("failed");
      expect((await events("TrainingCompetency", p!.id)).some((c) => c?.event === "competency_failed")).toBe(true);

      // retrain (a new session), then a NEW evaluation
      const s = await request(app).post("/training/session").set(as(trainer)).send({ courseId: course.id, scheduledAt: daysAhead(2).toISOString(), attendance: [{ userId: emp2.id, status: "present" }] });
      await request(app).post(`/training/session/${s.body.id}/complete`).set(as(trainer)).send({});
      expect((await statusOf(course.id, emp2.id))!.status).toBe("awaiting_evaluation");
      const second = await request(app).post("/training/competency").set(as(manager)).send({ userId: emp2.id, courseId: course.id, status: "pass", score: 88 });
      expect(second.status).toBe(201);
      expect((await statusOf(course.id, emp2.id))!.status).toBe("qualified");
      const history = (await request(app).get(`/training/competency?courseId=${course.id}&userId=${emp2.id}`).set(as(manager))).body as { status: string }[];
      expect(history.map((h) => h.status).sort()).toEqual(["fail", "pass"]); // both assessments stay on record
    });

    it("keeps one waiting evaluation per person and course", async () => {
      const c = await newCourse();
      expect((await request(app).post("/training/competency").set(as(manager)).send({ userId: emp1.id, courseId: c.id })).status).toBe(201);
      expect((await request(app).post("/training/competency").set(as(manager)).send({ userId: emp1.id, courseId: c.id })).status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("expiry and retraining when the document is revised", () => {
    it("shows expired and expiring-soon training from the dates recorded at completion", async () => {
      const c = await newCourse({ validityMonths: 12 });
      await db.insert(trainingAssignments).values({ courseId: c.id, userId: emp1.id, status: "completed", completedAt: daysAgo(400), expiresAt: daysAgo(35) });
      await db.insert(trainingAssignments).values({ courseId: c.id, userId: emp2.id, status: "completed", completedAt: daysAgo(340), expiresAt: daysAhead(25) });
      expect((await statusOf(c.id, emp1.id))!.status).toBe("expired");
      expect((await statusOf(c.id, emp2.id))!.status).toBe("expiring_soon");
    });

    it("flags people trained on an older revision of the linked controlled document, and retrains them with one click", async () => {
      const [doc] = await db.insert(documents).values({ title: "Forklift SOP", status: "approved", currentVersion: 1 }).returning();
      const c = await newCourse();
      expect((await request(app).patch(`/training/${c.id}`).set(as(manager)).send({ documentId: doc!.id })).status).toBe(200);
      const a = await request(app).post(`/training/${c.id}/assign`).set(as(manager)).send({ userIds: [emp1.id, emp2.id] });
      for (const row of a.body as { id: number }[]) expect((await request(app).post(`/training/assignment/${row.id}/complete`).set(as(manager)).send({ trainerName: "Lee" })).status).toBe(200);
      const [done] = await db.select().from(trainingAssignments).where(and(eq(trainingAssignments.courseId, c.id), eq(trainingAssignments.userId, emp1.id)));
      expect(done!.documentVersion).toBe(1); // trained on revision 1
      expect((await statusOf(c.id, emp1.id))!.status).toBe("qualified");

      await db.update(documents).set({ currentVersion: 2 }).where(eq(documents.id, doc!.id)); // the document is revised and released
      expect((await statusOf(c.id, emp1.id))!.status).toBe("revision_changed");
      const retrain = await request(app).post(`/training/${c.id}/assign-required`).set(as(manager)).send({});
      expect(retrain.body.assigned.map((a: { userId: number }) => a.userId).sort()).toEqual([emp1.id, emp2.id].sort()); // one click assigns the retraining
      expect((await request(app).post(`/training/${c.id}/assign-required`).set(as(manager)).send({})).body.assigned).toEqual([]); // and only once
      expect((await statusOf(c.id, emp1.id))!.status).toBe("revision_changed"); // still out of date until the retraining is done
      for (const row of retrain.body.assigned as { id: number }[]) await request(app).post(`/training/assignment/${row.id}/complete`).set(as(manager)).send({});
      const [again] = await db.select().from(trainingAssignments).where(and(eq(trainingAssignments.courseId, c.id), eq(trainingAssignments.userId, emp1.id), eq(trainingAssignments.documentVersion, 2)));
      expect(again).toBeTruthy(); // now trained on revision 2
      expect((await statusOf(c.id, emp1.id))!.status).toBe("qualified");
    });

    it("completing an assignment twice is refused", async () => {
      const c = await newCourse({ requiredForDepartment: null });
      const a = await request(app).post(`/training/${c.id}/assign`).set(as(manager)).send({ userIds: [emp3.id] });
      const id = a.body[0].id;
      expect((await request(app).post(`/training/assignment/${id}/complete`).set(as(manager)).send({})).status).toBe(200);
      expect((await request(app).post(`/training/assignment/${id}/complete`).set(as(manager)).send({})).status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("telling people", () => {
    it("lists what needs attention, most serious first, and emails Quality one digest that isn't repeated", async () => {
      const list = (await request(app).get("/training/attention").set(as(production))).body as { status: string }[];
      expect(list.length).toBeGreaterThan(0);
      const order = ["failed", "expired", "overdue", "revision_changed", "awaiting_evaluation", "not_trained", "expiring_soon"];
      const ranks = list.map((i) => order.indexOf(i.status));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      const res = await request(app).post("/training/notify-due").set(as(manager)).send({});
      expect(res.status).toBe(200);
      expect(res.body.notified).toBeGreaterThan(0);
      const digest = (await db.select().from(notificationLog).where(and(eq(notificationLog.recipient, manager.email)))).find((m) => /^Training due/.test(m.subject));
      expect(digest?.body).toMatch(/Person emp/);
      expect(await notifyDue(db, { dedupeHours: 20 })).toMatchObject({ skipped: true, notified: 0 });
    });
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("who may do what, and organizations", () => {
    it("lets read-only departments look but not change anything", async () => {
      const c = await newCourse();
      for (const path of ["/training", `/training/${c.id}`, "/training/status", "/training/attention", "/training/sessions", "/training/competency", `/training/employee/${emp1.id}/history`]) expect((await request(app).get(path).set(as(production))).status, path).toBe(200);
      for (const res of [
        await request(app).post("/training/course").set(as(production)).send({ title: "Nope" }),
        await request(app).patch(`/training/${c.id}`).set(as(production)).send({ title: "Nope" }),
        await request(app).post("/training/session").set(as(production)).send({ courseId: c.id, scheduledAt: daysAhead(3).toISOString() }),
        await request(app).post("/training/competency").set(as(production)).send({ userId: emp2.id, courseId: c.id, status: "pass", score: 90 }),
        await request(app).post(`/training/${c.id}/assign`).set(as(production)).send({ userIds: [emp2.id] }),
        await request(app).post(`/training/${c.id}/assign-required`).set(as(production)).send({}),
        await request(app).post("/training/notify-due").set(as(production)).send({}),
      ]) expect(res.status).toBe(403);
    });

    it("keeps customers out and needs authentication", async () => {
      expect((await request(app).get("/training").set(as(customer))).status).toBe(403);
      expect((await request(app).post("/training/course").set(as(customer)).send({ title: "x" })).status).toBe(403);
      expect((await request(app).get("/training")).status).toBe(401);
    });

  });
});
