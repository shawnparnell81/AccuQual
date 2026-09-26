import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Equipment & Calibration lifecycle through its real HTTP endpoints: status, scheduling, completing, the failure hold and return
// to service, the override, due status computed on the server, the attention list and due digest, RBAC, company isolation, audit.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { equipment, calibrations } from "../../src/drizzle/schema/calibration.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { auditRowChanges } from "../../src/drizzle/schema/auditRowChanges.js";
import { notificationLog } from "../../src/drizzle/schema/notifications.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { addDays, dueStatusOf, notifyDue } from "../../src/modules/calibration/calibration.service.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;

const userIds: number[] = [];
type Who = { id: number; email: string; token: string };
let quality: Who; // quality department, ordinary role: can edit equipment, cannot override
let manager: Who; // quality department, quality_manager: may override
let production: Who; // granted read-only on calibration by this organization
let customer: Who;


async function makeUser(co: number, label: string, roleName: string, department: string | null): Promise<Who> {
  const email = `equip-${label}-${suffix}@test.local`;
  const [u] = await db.insert(users).values({ email, passwordHash: "unused", department }).returning();
  userIds.push(u!.id);
  return { id: u!.id, email, token: await signAccessToken({ sub: String(u!.id), roleId: null, roleName, department }) };
}
const as = (w: Who) => ({ Authorization: `Bearer ${w.token}` });
const day = (offset: number) => addDays(new Date(), offset).toISOString();

const events = async (equipmentId: number) =>
  (await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Equipment"), eq(auditTrail.entityId, equipmentId)))).map((r) => r.changes as Record<string, unknown> | null);
const hasEvent = async (id: number, event: string) => (await events(id)).some((c) => c?.event === event);

async function newEquipment(over: Record<string, unknown> = {}) {
  const res = await request(app).post("/equipment").set(as(quality)).send({ name: `Gauge ${Math.random().toString(36).slice(2, 7)}`, type: "caliper", calibrationIntervalDays: 90, ...over });
  expect(res.status).toBe(201);
  return res.body.id as number;
}
const get = async (id: number, who: Who = quality) => (await request(app).get(`/equipment/${id}`).set(as(who))).body;

describe("dueStatusOf (pure)", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  it("bands the due date the way the screens colour it", () => {
    expect(dueStatusOf(null, false, now)).toBe("uncalibrated");
    expect(dueStatusOf(new Date("2026-06-01T00:00:00Z"), false, now)).toBe("overdue");
    expect(dueStatusOf(new Date("2026-07-10T00:00:00Z"), false, now)).toBe("due_soon"); // 25 days
    expect(dueStatusOf(new Date("2026-08-01T00:00:00Z"), false, now)).toBe("upcoming"); // ~47 days
    expect(dueStatusOf(new Date("2026-12-01T00:00:00Z"), false, now)).toBe("current");
    expect(dueStatusOf(new Date("2026-12-01T00:00:00Z"), true, now)).toBe("failed"); // a failed calibration beats any date
  });
});

describe("Equipment & Calibration lifecycle (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const t = await ensureTestCompany();
    
    companyId = t!.id;
    
    await seedDefaultPermissions(companyId);
    
    // By default only Quality has any access to calibration; an organization can grant another department read-only, which is what this does.
    await db.insert(departmentPermissions).values({ departmentName: "production", moduleName: "calibration", accessLevel: "read" });
    quality = await makeUser(companyId, "quality", "operator", "quality");
    manager = await makeUser(companyId, "manager", "quality_manager", "quality");
    production = await makeUser(companyId, "production", "operator", "production");
    customer = await makeUser(companyId, "customer", "customer", null);
    
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("the equipment record", () => {
    it("starts active, keeps its type, and starts inactive only when asked", async () => {
      const id = await newEquipment({ name: "Micrometer", type: "micrometer" });
      expect(await get(id)).toMatchObject({ name: "Micrometer", type: "micrometer", status: "active", dueStatus: "uncalibrated", nextDueAt: null, scheduledCalibrationId: null });
      const retired = await request(app).post("/equipment").set(as(quality)).send({ name: "Old scale", status: "inactive" });
      expect(retired.body.status).toBe("inactive");
      expect((await request(app).post("/equipment").set(as(quality)).send({ name: "Sneaky", status: "out_of_service" })).status).toBe(400);
    });

    it("can be edited, but status changes only through the status endpoint", async () => {
      const id = await newEquipment();
      const res = await request(app).patch(`/equipment/${id}`).set(as(quality)).send({ type: "torque wrench", location: "Cage B", status: "out_of_service" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ type: "torque wrench", location: "Cage B", status: "active" }); // status silently ignored
    });

    it("moves between active, inactive and out of service with a reason where one is needed, and audits it", async () => {
      const id = await newEquipment();
      expect((await request(app).post(`/equipment/${id}/status`).set(as(quality)).send({ status: "out_of_service" })).status).toBe(400);
      expect((await request(app).post(`/equipment/${id}/status`).set(as(quality)).send({ status: "out_of_service", reason: "abc" })).status).toBe(400);
      const out = await request(app).post(`/equipment/${id}/status`).set(as(quality)).send({ status: "out_of_service", reason: "Dropped on the floor" });
      expect(out.status).toBe(200);
      expect(out.body).toMatchObject({ status: "out_of_service", statusReason: "Dropped on the floor", statusCause: "manual" });
      expect((await request(app).post(`/equipment/${id}/status`).set(as(quality)).send({ status: "out_of_service", reason: "again again" })).status).toBe(400); // already
      // A manual hold is not a failed-calibration hold: an ordinary editor can lift it, with a reason.
      expect((await request(app).post(`/equipment/${id}/status`).set(as(quality)).send({ status: "active" })).status).toBe(400);
      const back = await request(app).post(`/equipment/${id}/status`).set(as(quality)).send({ status: "active", reason: "Inspected, undamaged" });
      expect(back.body).toMatchObject({ status: "active", statusReason: null, statusCause: null });
      expect((await events(id)).filter((c) => c?.event === "equipment_status_changed")).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("scheduling and completing", () => {
    it("records a finished calibration through the long-standing shape, with the next due date from the interval", async () => {
      const id = await newEquipment({ calibrationIntervalDays: 90 });
      const performedAt = day(-10);
      const res = await request(app).post(`/equipment/${id}/calibration`).set(as(quality)).send({ performedAt, result: "pass", technicianName: "Pat" });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: "completed", result: "pass", technicianName: "Pat" });
      expect(new Date(res.body.nextDueAt).toISOString().slice(0, 10)).toBe(addDays(new Date(performedAt), 90).toISOString().slice(0, 10));
      expect(await get(id)).toMatchObject({ status: "active", lastResult: "pass", dueStatus: "current" });
    });

    it("needs either a schedule date or a finished calibration with a result", async () => {
      const id = await newEquipment();
      expect((await request(app).post(`/equipment/${id}/calibration`).set(as(quality)).send({})).status).toBe(400);
      expect((await request(app).post(`/equipment/${id}/calibration`).set(as(quality)).send({ performedAt: day(-1) })).status).toBe(400);
    });

    it("schedules one calibration at a time, shows it, and refuses to schedule inactive equipment", async () => {
      const id = await newEquipment();
      const first = await request(app).post(`/equipment/${id}/calibration`).set(as(quality)).send({ scheduledAt: day(14), notes: "Annual" });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ status: "scheduled", performedAt: null, notes: "Annual" });
      const second = await request(app).post(`/equipment/${id}/calibration`).set(as(quality)).send({ scheduledAt: day(30) });
      expect(second.status).toBe(409);
      expect(await get(id)).toMatchObject({ scheduledCalibrationId: first.body.id, scheduleOverdue: false });
      expect(await hasEvent(id, "calibration_scheduled")).toBe(true);

      const inactive = await request(app).post("/equipment").set(as(quality)).send({ name: "Shelved", status: "inactive" });
      expect((await request(app).post(`/equipment/${inactive.body.id}/calibration`).set(as(quality)).send({ scheduledAt: day(5) })).status).toBe(400);
    });

    it("completes a scheduled calibration once, and can cancel one that has not been done", async () => {
      const id = await newEquipment();
      const s = await request(app).post(`/equipment/${id}/calibration`).set(as(quality)).send({ scheduledAt: day(3) });
      const done = await request(app).post(`/equipment/calibration/${s.body.id}/complete`).set(as(quality)).send({ result: "adjusted", results: { readings: [10.001, 10.002], unit: "mm" }, technicianName: "Sam" });
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ status: "completed", result: "adjusted", results: { unit: "mm" } });
      expect(done.body.nextDueAt).toBeTruthy();
      expect((await request(app).post(`/equipment/calibration/${s.body.id}/complete`).set(as(quality)).send({ result: "pass" })).status).toBe(409);
      expect((await request(app).delete(`/equipment/calibration/${s.body.id}`).set(as(quality))).status).toBe(409); // finished work is part of the record

      const s2 = await request(app).post(`/equipment/${id}/calibration`).set(as(quality)).send({ scheduledAt: day(20) });
      expect((await request(app).delete(`/equipment/calibration/${s2.body.id}`).set(as(quality))).status).toBe(204);
      expect(await hasEvent(id, "calibration_schedule_cancelled")).toBe(true);
      expect(await db.select().from(calibrations).where(eq(calibrations.id, s2.body.id))).toHaveLength(0);
    });

    it("closes the schedule when the calibration is logged the usual way, instead of leaving it open", async () => {
      const id = await newEquipment();
      const s = await request(app).post(`/equipment/${id}/calibration`).set(as(quality)).send({ scheduledAt: day(1) });
      const logged = await request(app).post(`/equipment/${id}/calibration`).set(as(quality)).send({ performedAt: day(0), result: "pass" });
      expect(logged.body.id).toBe(s.body.id); // the scheduled row was completed
      expect(await db.select().from(calibrations).where(eq(calibrations.equipmentId, id))).toHaveLength(1);
      expect((await get(id)).scheduledCalibrationId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("a failed calibration", () => {
    let id: number;

    it("takes the equipment out of service, sets no due date, tells Quality, and announces it", async () => {
      id = await newEquipment();
      await request(app).post(`/equipment/${id}/calibration`).set(as(quality)).send({ performedAt: day(-30), result: "pass" });
      const s = await request(app).post(`/equipment/${id}/calibration`).set(as(quality)).send({ scheduledAt: day(-1) });
      expect((await get(id)).scheduleOverdue).toBe(true);
      const failed = await request(app).post(`/equipment/calibration/${s.body.id}/complete`).set(as(quality)).send({ result: "fail", results: { reading: 10.4, tolerance: 0.01 } });
      expect(failed.status).toBe(200);
      expect(failed.body).toMatchObject({ status: "failed", result: "fail", nextDueAt: null });

      expect(await get(id)).toMatchObject({ status: "out_of_service", statusCause: "calibration_failure", dueStatus: "failed", nextDueAt: null, lastResult: "fail" });
      expect(await hasEvent(id, "calibration_failed")).toBe(true);
      const mail = await db.select().from(notificationLog).where(and(eq(notificationLog.recipient, manager.email)));
      expect(mail.some((m) => /Calibration failed/.test(m.subject))).toBe(true);
    });

    it("shows up in the attention list, most serious first", async () => {
      const ok = await newEquipment({ name: "Perfectly fine" });
      await request(app).post(`/equipment/${ok}/calibration`).set(as(quality)).send({ performedAt: day(-5), result: "pass" });
      const soon = await newEquipment({ name: "Due soon", calibrationIntervalDays: 30 });
      await request(app).post(`/equipment/${soon}/calibration`).set(as(quality)).send({ performedAt: day(-10), result: "pass" }); // due in ~20 days
      const over = await newEquipment({ name: "Overdue", calibrationIntervalDays: 30 });
      await request(app).post(`/equipment/${over}/calibration`).set(as(quality)).send({ performedAt: day(-50), result: "pass" }); // due ~20 days ago

      const list = (await request(app).get("/equipment/attention").set(as(quality))).body as { id: number; reason: string }[];
      const reasons = Object.fromEntries(list.map((i) => [i.id, i.reason]));
      expect(reasons[id]).toBe("out_of_service");
      expect(reasons[over]).toBe("overdue");
      expect(reasons[soon]).toBe("due_soon");
      expect(reasons[ok]).toBeUndefined();
      expect(list.findIndex((i) => i.id === id)).toBeLessThan(list.findIndex((i) => i.id === over));
      expect(list.findIndex((i) => i.id === over)).toBeLessThan(list.findIndex((i) => i.id === soon));
    });

    it("can't simply be set active by an ordinary editor: it needs a passing calibration or a reviewer's override", async () => {
      const byEditor = await request(app).post(`/equipment/${id}/status`).set(as(quality)).send({ status: "active", reason: "Looks fine to me" });
      expect(byEditor.status).toBe(403);
      expect(byEditor.body.message).toMatch(/failed calibration/i);
      expect((await events(id)).some((c) => c?.permission)).toBe(false); // an in-rule refusal, not a permission gate
    });

    it("can be overridden by a quality manager, with a reason, and the override is on record", async () => {
      expect((await request(app).post(`/equipment/${id}/status`).set(as(manager)).send({ status: "active" })).status).toBe(400); // reason still required
      const res = await request(app).post(`/equipment/${id}/status`).set(as(manager)).send({ status: "active", reason: "Recalibrated off-site; certificate attached to the record" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("active");
      expect((await events(id)).some((c) => c?.event === "failure_override" && c.to === "active")).toBe(true);
    });

    it("returns to service on its own when the next calibration passes", async () => {
      const eq2 = await newEquipment();
      const bad = await request(app).post(`/equipment/${eq2}/calibration`).set(as(quality)).send({ performedAt: day(-2), result: "fail" });
      expect(bad.status).toBe(201);
      expect((await get(eq2)).status).toBe("out_of_service");
      // A schedule is allowed on equipment that is out of service — that is how it comes back.
      const s = await request(app).post(`/equipment/${eq2}/calibration`).set(as(quality)).send({ scheduledAt: day(1) });
      expect(s.status).toBe(201);
      const good = await request(app).post(`/equipment/calibration/${s.body.id}/complete`).set(as(quality)).send({ result: "pass" });
      expect(good.status).toBe(200);
      expect(await get(eq2)).toMatchObject({ status: "active", statusCause: null, dueStatus: "current" });
      expect(await hasEvent(eq2, "returned_to_service")).toBe(true);
    });

    it("does not return manually-held equipment to service just because a calibration passed", async () => {
      const eq3 = await newEquipment();
      await request(app).post(`/equipment/${eq3}/status`).set(as(quality)).send({ status: "out_of_service", reason: "Sent to the repair shop" });
      await request(app).post(`/equipment/${eq3}/calibration`).set(as(quality)).send({ performedAt: day(0), result: "pass" });
      expect((await get(eq3)).status).toBe("out_of_service");
    });
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("telling people", () => {
    it("emails Quality one digest of what needs attention, on demand, and not twice within the dedupe window", async () => {
      const over = await newEquipment({ name: "Digest overdue", calibrationIntervalDays: 30 });
      await request(app).post(`/equipment/${over}/calibration`).set(as(quality)).send({ performedAt: day(-90), result: "pass" });
      const res = await request(app).post("/equipment/notify-due").set(as(quality)).send({});
      expect(res.status).toBe(200);
      expect(res.body.items).toBeGreaterThan(0);
      expect(res.body.notified).toBeGreaterThan(0);
      const digest = (await db.select().from(notificationLog).where(and(eq(notificationLog.recipient, manager.email)))).find((m) => /^Calibration due/.test(m.subject));
      expect(digest?.body).toMatch(/Digest overdue/);

      // The timer path dedupes: a second digest inside 20 hours is skipped.
      const again = await notifyDue(db, { dedupeHours: 20 });
      expect(again).toMatchObject({ skipped: true, notified: 0 });
    });
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("who may do what, and organizations", () => {
    let id: number;
    let calId: number;

    it("lets read-only departments look but not change anything", async () => {
      id = await newEquipment();
      const s = await request(app).post(`/equipment/${id}/calibration`).set(as(quality)).send({ scheduledAt: day(7) });
      calId = s.body.id;
      expect((await request(app).get(`/equipment/${id}`).set(as(production))).status).toBe(200);
      expect((await request(app).get("/equipment").set(as(production))).status).toBe(200);
      expect((await request(app).get("/equipment/attention").set(as(production))).status).toBe(200);
      for (const res of [
        await request(app).post("/equipment").set(as(production)).send({ name: "Nope" }),
        await request(app).patch(`/equipment/${id}`).set(as(production)).send({ type: "x" }),
        await request(app).post(`/equipment/${id}/status`).set(as(production)).send({ status: "inactive" }),
        await request(app).post(`/equipment/${id}/calibration`).set(as(production)).send({ scheduledAt: day(9) }),
        await request(app).post(`/equipment/calibration/${calId}/complete`).set(as(production)).send({ result: "pass" }),
        await request(app).post("/equipment/notify-due").set(as(production)).send({}),
      ]) expect(res.status).toBe(403);
    });

    it("keeps customers out entirely", async () => {
      for (const res of [await request(app).get("/equipment").set(as(customer)), await request(app).get(`/equipment/${id}`).set(as(customer)), await request(app).post("/equipment").set(as(customer)).send({ name: "x" })]) expect(res.status).toBe(403);
    });

    it("needs authentication", async () => {
      expect((await request(app).get("/equipment")).status).toBe(401);
    });

    ;
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("records that pre-date scheduling", () => {
    it("treats a legacy calibration row (no status, no completed date) as a finished event and still computes its state", async () => {
      const id = await newEquipment({ calibrationIntervalDays: 365 });
      const performedAt = new Date(Date.now() - 20 * 86_400_000);
      // Inserted exactly as the old code wrote it: only the columns that existed then.
      await db.insert(calibrations).values({ equipmentId: id, performedAt, result: "pass", nextDueAt: addDays(performedAt, 365) });
      expect(await get(id)).toMatchObject({ lastResult: "pass", dueStatus: "current" });
    });
  });
});
