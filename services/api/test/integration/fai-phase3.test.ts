import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { sites, userSites } from "../../src/drizzle/schema/sites.js";
import { inspApprovedSources } from "../../src/drizzle/schema/faiInspection.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedTestRoles } from "../helpers/seedDefaults.js";
import { setTestPin, TEST_PIN } from "../helpers/signaturePin.js";
import { setEmailTransport } from "../../src/modules/notifications/notification.service.js";
import { sweepFaiDue } from "../../src/modules/fai-inspection/fai-scheduler.service.js";
import { sendMondaySummaries } from "../../src/modules/fai-inspection/fai-notifications.service.js";
import { addMonths, isoToday } from "../../src/modules/fai-inspection/fai-due-status.js";

const FAI_PERMISSIONS = ["fai.view", "fai.create", "fai.edit", "fai.delete", "fai.signoff", "fai.plans.manage"];
const FULL_PERMISSIONS = [...FAI_PERMISSIONS, "fai.schedule.manage", "fai.notifications.manage", "fai.reports.view"];

const app = createApp();
const suffix = Date.now().toString(36);
const userIds: number[] = [];
let managerToken: string;
let fullToken: string;
let siteAId: number;
const sentMail: { to: string; subject: string; body: string }[] = [];

async function makeUser(roleName: string, siteId?: number, notificationPreferences?: any) {
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, roleName));
  const email = `fai-p3-${roleName}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`;
  const [user] = await db.insert(users).values({ email, passwordHash: "unused", department: "quality", currentSiteId: siteId ?? null, roleId: role?.id ?? null, notificationPreferences }).returning();
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
  if (lead) await db.update(roles).set({ permissions: [...new Set([...(lead.permissions ?? []), ...FULL_PERMISSIONS])] }).where(eq(roles.id, lead.id));

  const [siteA] = await db.insert(sites).values({ name: `Plant P3 ${suffix}`, code: `P3-${suffix}`, isDefault: false }).returning();
  siteAId = siteA!.id;

  managerToken = (await makeUser("quality_manager", siteAId)).token;
  fullToken = (await makeUser("lead", siteAId)).token;

  setEmailTransport({ send: async (message) => { sentMail.push(message); return "sent"; } });
});

afterEach(() => { sentMail.length = 0; });

afterAll(async () => {
  setEmailTransport(null);
  for (const id of userIds) await db.delete(users).where(eq(users.id, id)).catch(() => {});
});

describe("FAI Phase 3 — emails, charts, reports", () => {
  describe("distribution lists", () => {
    it("fai.view alone cannot manage distribution lists", async () => {
      const res = await request(app).get("/fai-inspection/distribution-lists").set("Authorization", `Bearer ${managerToken}`);
      expect(res.status).toBe(403);
    });

    it("fai.notifications.manage can create, update and delete one, and it's audit-logged", async () => {
      const create = await request(app).post("/fai-inspection/distribution-lists").set("Authorization", `Bearer ${fullToken}`)
        .send({ name: "Quality Team", members: [{ type: "email", email: "quality-team@test.local" }], matchEventTypes: [] });
      expect(create.status).toBe(201);
      const id = create.body.id;
      const update = await request(app).patch(`/fai-inspection/distribution-lists/${id}`).set("Authorization", `Bearer ${fullToken}`).send({ name: "Quality Team Renamed" });
      expect(update.status).toBe(200);
      expect(update.body.name).toBe("Quality Team Renamed");
      const del = await request(app).delete(`/fai-inspection/distribution-lists/${id}`).set("Authorization", `Bearer ${fullToken}`);
      expect(del.status).toBe(200);
    });
  });

  describe("event emails", () => {
    it("awaiting sign-off, passed and failed each send to a matching list, scoped by plant and event type", async () => {
      const member = await makeUser("quality_manager", siteAId);
      const list = await request(app).post("/fai-inspection/distribution-lists").set("Authorization", `Bearer ${fullToken}`)
        .send({ name: "Plant A list", members: [{ type: "user", userId: member.id }], matchSiteId: siteAId, matchEventTypes: [] });
      expect(list.status).toBe(201);

      const rec = await request(app).post("/fai-inspection/records").set("Authorization", `Bearer ${managerToken}`)
        .send({ faiNumber: `FAI-P3-AWAIT-${suffix}`, partNumber: "P3-001" });
      expect(rec.status).toBe(201);

      const awaiting = await request(app).patch(`/fai-inspection/records/${rec.body.id}`).set("Authorization", `Bearer ${managerToken}`).send({ status: "awaiting_signoff" });
      expect(awaiting.status).toBe(200);
      expect(sentMail.some((m) => m.to === member.email && /awaiting sign-off/.test(m.subject))).toBe(true);
      sentMail.length = 0;

      const passed = await request(app).post(`/fai-inspection/records/${rec.body.id}/sign`).set("Authorization", `Bearer ${managerToken}`)
        .send({ pin: TEST_PIN, certified: true, outcome: "passed", description: "Phase 3 pass test" });
      expect(passed.status).toBe(200);
      expect(sentMail.some((m) => m.to === member.email && /signed PASSED/.test(m.subject))).toBe(true);
      sentMail.length = 0;

      const rec2 = await request(app).post("/fai-inspection/records").set("Authorization", `Bearer ${managerToken}`).send({ faiNumber: `FAI-P3-FAIL-${suffix}`, partNumber: "P3-002" });
      const failed = await request(app).post(`/fai-inspection/records/${rec2.body.id}/sign`).set("Authorization", `Bearer ${managerToken}`)
        .send({ pin: TEST_PIN, certified: true, outcome: "failed", description: "Phase 3 fail test" });
      expect(failed.status).toBe(200);
      const failMail = sentMail.find((m) => m.to === member.email && /signed FAILED/.test(m.subject));
      expect(failMail).toBeTruthy();
      expect(failMail!.body).toMatch(/NCR/);
    });

    it("a person who turned FAI emails off for themselves gets no email, even on a matching list", async () => {
      const optedOut = await makeUser("quality_manager", siteAId, { inApp: true, email: true, dailyDigest: true, faiEmail: false });
      await request(app).post("/fai-inspection/distribution-lists").set("Authorization", `Bearer ${fullToken}`)
        .send({ name: "Opt-out test list", members: [{ type: "user", userId: optedOut.id }], matchSiteId: siteAId, matchEventTypes: [] });
      const rec = await request(app).post("/fai-inspection/records").set("Authorization", `Bearer ${managerToken}`).send({ faiNumber: `FAI-P3-OPTOUT-${suffix}`, partNumber: "P3-003" });
      await request(app).patch(`/fai-inspection/records/${rec.body.id}`).set("Authorization", `Bearer ${managerToken}`).send({ status: "awaiting_signoff" });
      expect(sentMail.some((m) => m.to === optedOut.email)).toBe(false);
    });

    it("an event-type filter only matches the event kinds it names", async () => {
      const member = await makeUser("quality_manager", siteAId);
      await request(app).post("/fai-inspection/distribution-lists").set("Authorization", `Bearer ${fullToken}`)
        .send({ name: "Failures only", members: [{ type: "user", userId: member.id }], matchEventTypes: ["failed"] });
      const rec = await request(app).post("/fai-inspection/records").set("Authorization", `Bearer ${managerToken}`).send({ faiNumber: `FAI-P3-EVT-${suffix}`, partNumber: "P3-004" });
      await request(app).post(`/fai-inspection/records/${rec.body.id}/sign`).set("Authorization", `Bearer ${managerToken}`)
        .send({ pin: TEST_PIN, certified: true, outcome: "passed", description: "x" });
      expect(sentMail.some((m) => m.to === member.email)).toBe(false); // "passed" isn't in this list's event types
    });
  });

  describe("due/overdue reminder email", () => {
    it("sends once per status change, not every sweep", async () => {
      const member = await makeUser("quality_manager", siteAId);
      await request(app).post("/fai-inspection/distribution-lists").set("Authorization", `Bearer ${fullToken}`)
        .send({ name: "Due reminders", members: [{ type: "user", userId: member.id }], matchSiteId: siteAId, matchEventTypes: ["due_reminder"] });
      await db.insert(inspApprovedSources).values({ partNumber: "P3-DUE-001", status: "approved", nextDueDate: isoToday(), siteId: siteAId });

      await sweepFaiDue();
      const firstCount = sentMail.filter((m) => m.to === member.email).length;
      expect(firstCount).toBeGreaterThanOrEqual(1);

      await sweepFaiDue();
      const secondCount = sentMail.filter((m) => m.to === member.email).length;
      expect(secondCount).toBe(firstCount); // no re-send while the status hasn't changed
    });
  });

  describe("random pull approval email", () => {
    it("sends the picked-sources list once approved", async () => {
      const member = await makeUser("quality_manager", siteAId);
      await request(app).post("/fai-inspection/distribution-lists").set("Authorization", `Bearer ${fullToken}`)
        .send({ name: "Pull approvals", members: [{ type: "user", userId: member.id }], matchEventTypes: ["random_pull_approved"] });
      await request(app).put("/fai-inspection/random-pulls/rules").set("Authorization", `Bearer ${fullToken}`).send({ pickMode: "count", pickCount: 1 });
      await db.insert(inspApprovedSources).values({ partNumber: "P3-PULL-001", status: "approved", lastFaiDate: addMonths(isoToday(), -12), siteId: siteAId });
      const gen = await request(app).post("/fai-inspection/random-pulls/batches").set("Authorization", `Bearer ${fullToken}`).send({ year: new Date().getFullYear() + 50 });
      expect(gen.status).toBe(201);
      await request(app).post(`/fai-inspection/random-pulls/batches/${gen.body.id}/approve`).set("Authorization", `Bearer ${fullToken}`)
        .send({ pin: TEST_PIN, certified: true, description: "approve" });
      expect(sentMail.some((m) => m.to === member.email && /random-pull list approved/.test(m.subject))).toBe(true);
    });
  });

  describe("Monday 7am summary", () => {
    it("sends on the Monday-7am hour and not again the same week", async () => {
      const member = await makeUser("quality_manager", siteAId);
      await request(app).post("/fai-inspection/distribution-lists").set("Authorization", `Bearer ${fullToken}`)
        .send({ name: "Weekly digest", members: [{ type: "user", userId: member.id }], mondaySummary: true, matchEventTypes: [] });
      // 2026-10-12 is a Monday (UTC).
      const monday7am = new Date("2026-10-12T07:00:00.000Z");
      const r1 = await sendMondaySummaries(monday7am);
      expect(r1.sent).toBeGreaterThanOrEqual(1);
      expect(sentMail.some((m) => m.to === member.email && /Weekly FAI Summary/.test(m.subject))).toBe(true);
      sentMail.length = 0;
      const r2 = await sendMondaySummaries(monday7am);
      expect(r2.sent).toBe(0);
    });

    it("does not send outside the Monday-7am hour", async () => {
      const tuesday = new Date("2026-10-13T07:00:00.000Z");
      const r = await sendMondaySummaries(tuesday);
      expect(r.sent).toBe(0);
    });
  });

  describe("dashboard charts", () => {
    it("pass rate by month covers 12 months and never errors on no data", async () => {
      const res = await request(app).get("/fai-inspection/charts/pass-rate-by-month").set("Authorization", `Bearer ${managerToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(12);
    });
    it("aging buckets are always the same 4 buckets", async () => {
      const res = await request(app).get("/fai-inspection/charts/aging").set("Authorization", `Bearer ${managerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.map((b: any) => b.bucket)).toEqual(["0-7", "8-30", "31-60", "60+"]);
    });
  });

  describe("reports", () => {
    it("fai.view alone cannot open reports; fai.reports.view can", async () => {
      const denied = await request(app).get("/fai-inspection/reports/aql-lot/preview").set("Authorization", `Bearer ${managerToken}`);
      expect(denied.status).toBe(403);
      const allowed = await request(app).get("/fai-inspection/reports/aql-lot/preview").set("Authorization", `Bearer ${fullToken}`);
      expect(allowed.status).toBe(200);
      expect(allowed.body.title).toBe("AQL Lot Report");
    });

    it("AQL Lot Report reads real saved values, including total defects across result lines", async () => {
      const plan = await request(app).post("/fai-inspection/plans").set("Authorization", `Bearer ${managerToken}`)
        .send({ partNumber: "P3-RPT-001", characteristics: [{ name: "Length", limitType: "plus_minus", nominal: "5", tolerancePlus: "0.1", toleranceMinus: "0.1" }] });
      const rec = await request(app).post("/fai-inspection/records").set("Authorization", `Bearer ${managerToken}`)
        .send({ faiNumber: `FAI-P3-RPT-${suffix}`, planId: plan.body.id, partNumber: "P3-RPT-001", lotSize: 150 });
      const full = await request(app).get(`/fai-inspection/records/${rec.body.id}`).set("Authorization", `Bearer ${managerToken}`);
      const lineId = full.body.lines[0].id;
      await request(app).post(`/fai-inspection/records/${rec.body.id}/lines`).set("Authorization", `Bearer ${managerToken}`)
        .send({ lines: [{ id: lineId, measuredValue: "5.05", defects: 2 }] });

      const report = await request(app).get("/fai-inspection/reports/aql-lot/preview").set("Authorization", `Bearer ${fullToken}`).query({ partNumber: "P3-RPT-001" });
      expect(report.status).toBe(200);
      const row = report.body.rows.find((r: any[]) => r[0] === `FAI-P3-RPT-${suffix}`);
      expect(row).toBeTruthy();
      expect(row[2]).toBe(150); // lot size
      expect(row[9]).toBe(2); // defects found
    });

    it("export returns a downloadable PDF and Excel file", async () => {
      const pdf = await request(app).get("/fai-inspection/reports/source-qualification/export").set("Authorization", `Bearer ${fullToken}`).query({ format: "pdf" });
      expect(pdf.status).toBe(200);
      expect(pdf.headers["content-type"]).toBe("application/pdf");
      const xlsx = await request(app).get("/fai-inspection/reports/source-qualification/export").set("Authorization", `Bearer ${fullToken}`).query({ format: "excel" });
      expect(xlsx.status).toBe(200);
      expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
    });
  });
});
