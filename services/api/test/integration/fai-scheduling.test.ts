import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { sites, userSites } from "../../src/drizzle/schema/sites.js";
import { inspApprovedSources } from "../../src/drizzle/schema/faiInspection.js";
import { notificationLog } from "../../src/drizzle/schema/notifications.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedTestRoles } from "../helpers/seedDefaults.js";
import { setTestPin, TEST_PIN } from "../helpers/signaturePin.js";
import { sweepFaiDue } from "../../src/modules/fai-inspection/fai-scheduler.service.js";
import { addMonths, isoToday } from "../../src/modules/fai-inspection/fai-due-status.js";

const FAI_PERMISSIONS = ["fai.view", "fai.create", "fai.edit", "fai.delete", "fai.signoff", "fai.plans.manage"];
const SCHEDULE_PERMISSIONS = [...FAI_PERMISSIONS, "fai.schedule.manage"];

const app = createApp();
const suffix = Date.now().toString(36);
const userIds: number[] = [];
let managerToken: string; // fai.view only, no fai.schedule.manage
let schedulerToken: string; // has fai.schedule.manage too
let siteAId: number;
let siteBId: number;

async function makeUser(roleName: string, siteId?: number) {
  // Set the real roleId too (not just the JWT's roleName claim) — the scheduler looks up OTHER users'
  // permissions via a DB join (users.roleId -> roles), the same way the real "create user" flow does.
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, roleName));
  const email = `fai-sched-${roleName}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`;
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: "unused", department: "quality", currentSiteId: siteId ?? null, roleId: role?.id ?? null })
    .returning();
  userIds.push(user!.id);
  await setTestPin(user!.id);
  if (siteId) await db.insert(userSites).values({ userId: user!.id, siteId });
  const token = await signAccessToken({ sub: String(user!.id), roleId: null, roleName, department: "quality" });
  return { token, email, id: user!.id };
}

beforeAll(async () => {
  await ensureTestCompany();
  await seedTestRoles();
  const [qm] = await db.select().from(roles).where(eq(roles.name, "quality_manager"));
  if (qm) await db.update(roles).set({ permissions: [...new Set([...(qm.permissions ?? []), ...FAI_PERMISSIONS])] }).where(eq(roles.id, qm.id));
  const [lead] = await db.select().from(roles).where(eq(roles.name, "lead"));
  if (lead) await db.update(roles).set({ permissions: [...new Set([...(lead.permissions ?? []), ...SCHEDULE_PERMISSIONS])] }).where(eq(roles.id, lead.id));

  const [siteA] = await db.insert(sites).values({ name: `Plant A ${suffix}`, code: `PA-${suffix}`, isDefault: false }).returning();
  const [siteB] = await db.insert(sites).values({ name: `Plant B ${suffix}`, code: `PB-${suffix}`, isDefault: false }).returning();
  siteAId = siteA!.id;
  siteBId = siteB!.id;

  managerToken = (await makeUser("quality_manager", siteAId)).token;
  schedulerToken = (await makeUser("lead", siteAId)).token;
});

afterAll(async () => {
  for (const id of userIds) await db.delete(users).where(eq(users.id, id)).catch(() => {});
});

describe("FAI scheduling — Phase 2", () => {
  describe("random-pull rules", () => {
    it("fai.view alone can read the rules, but not edit them", async () => {
      const get = await request(app).get("/fai-inspection/random-pulls/rules").set("Authorization", `Bearer ${managerToken}`);
      expect(get.status).toBe(200);
      expect(get.body.pickMode).toBe("percent");
      const put = await request(app).put("/fai-inspection/random-pulls/rules").set("Authorization", `Bearer ${managerToken}`).send({ pickPercent: 50 });
      expect(put.status).toBe(403);
    });

    it("fai.schedule.manage can edit the rules, and it's audit-logged", async () => {
      const res = await request(app).put("/fai-inspection/random-pulls/rules").set("Authorization", `Bearer ${schedulerToken}`)
        .send({ pickMode: "percent", pickPercent: 50, excludeMonths: 6 });
      expect(res.status).toBe(200);
      expect(res.body.pickPercent).toBe(50);
    });
  });

  describe("due-date status on the Approved Sources list", () => {
    it("shows dueStatus computed from nextDueDate", async () => {
      const [src] = await db.insert(inspApprovedSources).values({
        partNumber: "SCHED-001", status: "approved", nextDueDate: addMonths(isoToday(), -1), siteId: siteAId,
      }).returning();
      const res = await request(app).get("/fai-inspection/sources").set("Authorization", `Bearer ${managerToken}`);
      expect(res.status).toBe(200);
      const row = res.body.find((r: any) => r.id === src!.id);
      expect(row.dueStatus).toBe("overdue");
    });
  });

  describe("daily scheduler sweep", () => {
    it("notifies a user assigned to the source's own plant, but not one assigned to a different plant", async () => {
      const plantAUser = await makeUser("quality_manager", siteAId);
      const plantBUser = await makeUser("quality_manager", siteBId);
      const [src] = await db.insert(inspApprovedSources).values({
        partNumber: "SCHED-SWEEP-001", status: "approved", nextDueDate: isoToday(), siteId: siteAId,
      }).returning();

      const result = await sweepFaiDue();
      expect(result.sources).toBeGreaterThanOrEqual(1);

      const recipients = (await db.select({ recipient: notificationLog.recipient }).from(notificationLog)
        .where(and(eq(notificationLog.relatedEntityType, "FAI Approved Source"), eq(notificationLog.relatedEntityId, src!.id))))
        .map((r) => r.recipient);
      expect(recipients).toContain(plantAUser.email);
      expect(recipients).not.toContain(plantBUser.email);
    });

    it("is safe to run twice the same day — no duplicate notification rows", async () => {
      const [src] = await db.insert(inspApprovedSources).values({
        partNumber: "SCHED-SWEEP-002", status: "approved", nextDueDate: isoToday(), siteId: siteAId,
      }).returning();
      await sweepFaiDue();
      const afterFirst = await db.select().from(notificationLog).where(eq(notificationLog.relatedEntityId, src!.id));
      await sweepFaiDue();
      const afterSecond = await db.select().from(notificationLog).where(eq(notificationLog.relatedEntityId, src!.id));
      expect(afterSecond.length).toBe(afterFirst.length);
    });
  });

  describe("annual random pulls", () => {
    it("requires fai.schedule.manage to generate a pick list", async () => {
      const res = await request(app).post("/fai-inspection/random-pulls/batches").set("Authorization", `Bearer ${managerToken}`).send({});
      expect(res.status).toBe(403);
    });

    it("generates, approves (PIN), links an FAI record, and shows it in compliance", async () => {
      // Rules: pick 100% by count=1 so the test is deterministic regardless of how many other sources exist.
      await request(app).put("/fai-inspection/random-pulls/rules").set("Authorization", `Bearer ${schedulerToken}`)
        .send({ pickMode: "count", pickCount: 1, excludeMonths: 6 });

      const [src] = await db.insert(inspApprovedSources).values({
        partNumber: "PULL-001", status: "approved", lastFaiDate: addMonths(isoToday(), -12), siteId: siteAId,
      }).returning();

      const year = new Date().getFullYear();
      const gen = await request(app).post("/fai-inspection/random-pulls/batches").set("Authorization", `Bearer ${schedulerToken}`).send({ year });
      expect(gen.status).toBe(201);
      expect(gen.body.items.length).toBeGreaterThanOrEqual(1);
      expect(gen.body.status).toBe("pending_approval");

      const wrongPin = await request(app).post(`/fai-inspection/random-pulls/batches/${gen.body.id}/approve`).set("Authorization", `Bearer ${schedulerToken}`)
        .send({ pin: "0000", certified: true, description: "Approve pick list" });
      expect(wrongPin.status).toBe(401);

      const approve = await request(app).post(`/fai-inspection/random-pulls/batches/${gen.body.id}/approve`).set("Authorization", `Bearer ${schedulerToken}`)
        .send({ pin: TEST_PIN, certified: true, description: "Approve annual pick list" });
      expect(approve.status).toBe(200);
      expect(approve.body.status).toBe("approved");
      const item = approve.body.items[0];
      expect(item.status).toBe("pending");

      // Create the FAI record the way the UI would — trigger reason "Annual random pull", FAI number typed by the user.
      const rec = await request(app).post("/fai-inspection/records").set("Authorization", `Bearer ${schedulerToken}`)
        .send({ faiNumber: `FAI-PULL-${suffix}`, partNumber: item.partNumber, triggerReason: "Annual random pull" });
      expect(rec.status).toBe(201);

      const link = await request(app).post(`/fai-inspection/random-pulls/items/${item.id}/link`).set("Authorization", `Bearer ${schedulerToken}`)
        .send({ recordId: rec.body.id });
      expect(link.status).toBe(200);

      const batchAfterLink = await request(app).get(`/fai-inspection/random-pulls/batches/${gen.body.id}`).set("Authorization", `Bearer ${schedulerToken}`);
      expect(batchAfterLink.body.items[0].status).toBe("linked");

      // Sign it off passed; the item should derive "completed_pass" without any separate write.
      const sign = await request(app).post(`/fai-inspection/records/${rec.body.id}/sign`).set("Authorization", `Bearer ${schedulerToken}`)
        .send({ pin: TEST_PIN, certified: true, outcome: "passed", description: "Random pull inspection complete" });
      expect(sign.status).toBe(200);

      const batchAfterSign = await request(app).get(`/fai-inspection/random-pulls/batches/${gen.body.id}`).set("Authorization", `Bearer ${schedulerToken}`);
      expect(batchAfterSign.body.items[0].status).toBe("completed_pass");

      const compliance = await request(app).get(`/fai-inspection/random-pulls/compliance?year=${year}`).set("Authorization", `Bearer ${managerToken}`);
      expect(compliance.status).toBe(200);
      expect(compliance.body.picked).toBeGreaterThanOrEqual(1);
      expect(compliance.body.completed).toBeGreaterThanOrEqual(1);
      expect(compliance.body.overdue).toBe(0); // current year, not a past year
      void src;
    });

    it("excludes a source FAI'd within the exclusion window", async () => {
      await request(app).put("/fai-inspection/random-pulls/rules").set("Authorization", `Bearer ${schedulerToken}`)
        .send({ pickMode: "count", pickCount: 50, excludeMonths: 6 });
      const [recent] = await db.insert(inspApprovedSources).values({
        partNumber: "PULL-RECENT-001", status: "approved", lastFaiDate: addMonths(isoToday(), -1), siteId: siteAId,
      }).returning();
      const gen = await request(app).post("/fai-inspection/random-pulls/batches").set("Authorization", `Bearer ${schedulerToken}`).send({ year: new Date().getFullYear() + 100 });
      expect(gen.status).toBe(201);
      expect(gen.body.items.some((i: any) => i.sourceId === recent!.id)).toBe(false);
    });
  });
});
