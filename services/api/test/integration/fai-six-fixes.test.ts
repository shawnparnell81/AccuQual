import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, desc, eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { company } from "../../src/drizzle/schema/company.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { inspApprovedSources, inspRecords } from "../../src/drizzle/schema/faiInspection.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions, seedTestRoles } from "../helpers/seedDefaults.js";
import { setTestPin, TEST_PIN } from "../helpers/signaturePin.js";
import { setEmailTransport } from "../../src/modules/notifications/notification.service.js";

const FAI = ["fai.view", "fai.create", "fai.edit", "fai.signoff"];

const app = createApp();
const suffix = Date.now().toString(36);
const userIds: number[] = [];
const sentMail: { to: string; subject: string; body: string }[] = [];
let managerToken: string; // quality department, FAI permissions, no sources.manage
let sourcesToken: string; // quality department + sources.manage
let noNcrToken: string; // FAI permissions but a department with no NCR access
let adminToken: string;
let managerId: number;

async function addPermissions(roleName: string, extra: string[]) {
  const [role] = await db.select().from(roles).where(eq(roles.name, roleName));
  if (role) await db.update(roles).set({ permissions: [...new Set([...(role.permissions ?? []), ...extra])] }).where(eq(roles.id, role.id));
}

async function makeUser(roleName: string, department: string) {
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, roleName));
  const [user] = await db
    .insert(users)
    .values({ email: `fai-six-${roleName}-${department}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department, roleId: role?.id ?? null, name: `Six ${roleName} ${department}` } as any)
    .returning();
  userIds.push(user!.id);
  await setTestPin(user!.id);
  const token = await signAccessToken({ sub: String(user!.id), roleId: null, roleName, department });
  return { token, id: user!.id };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const co = await ensureTestCompany();
  await seedDefaultPermissions(co!.id);
  await seedTestRoles();
  await addPermissions("quality_manager", FAI);
  await addPermissions("lead", [...FAI, "fai.sources.manage"]);
  await addPermissions("supervisor", FAI);
  const manager = await makeUser("quality_manager", "quality");
  managerToken = manager.token;
  managerId = manager.id;
  sourcesToken = (await makeUser("lead", "quality")).token;
  noNcrToken = (await makeUser("supervisor", "marketing")).token;
  adminToken = (await makeUser("admin", "quality")).token;
  setEmailTransport({ send: async (message) => { sentMail.push(message); return "sent"; } });
});

afterEach(() => { sentMail.length = 0; });

afterAll(async () => {
  setEmailTransport(null);
  for (const id of userIds) await db.delete(users).where(eq(users.id, id)).catch(() => {});
});

async function newRecord(token: string, body: Record<string, unknown> = {}) {
  const res = await request(app).post("/fai-inspection/records").set(auth(token)).send({ faiNumber: `FAI-SIX-${suffix}-${Math.random().toString(36).slice(2, 6)}`, partNumber: "SIX-100", ...body });
  expect(res.status).toBe(201);
  return res.body as { id: number; faiNumber: string };
}

async function lastAudit(entityType: string, entityId: number) {
  const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, entityType), eq(auditTrail.entityId, entityId))).orderBy(desc(auditTrail.id)).limit(1);
  return row;
}

describe("Fix 1 — Create NCR from a failed FAI record", () => {
  it("creates a pre-filled NCR linked back to the FAI record, and is idempotent", async () => {
    const rec = await newRecord(managerToken, { partNumber: "SIX-NCR-1", poReference: "PO-9001", supplierFactory: "Plant 7" });
    const fail = await request(app).post(`/fai-inspection/records/${rec.id}/sign`).set(auth(managerToken)).send({ pin: TEST_PIN, certified: true, outcome: "failed", description: "Six fixes fail" });
    expect(fail.status).toBe(200);

    const first = await request(app).post(`/fai-inspection/records/${rec.id}/ncr`).set(auth(managerToken));
    expect(first.status).toBe(201);
    expect(first.body.existing).toBe(false);

    const [made] = await db.select().from(ncr).where(eq(ncr.id, first.body.id));
    expect(made).toBeTruthy();
    const text = JSON.stringify(made);
    expect(text).toContain("SIX-NCR-1");
    expect(text).toContain("PO-9001");
    expect(text).toContain(rec.faiNumber);
    expect(JSON.stringify((made as any).processData?.validationSource ?? {})).toContain(`/fai-inspection/records/${rec.id}`);

    const [linked] = await db.select().from(inspRecords).where(eq(inspRecords.id, rec.id));
    expect(linked!.ncrId).toBe(first.body.id);

    const again = await request(app).post(`/fai-inspection/records/${rec.id}/ncr`).set(auth(managerToken));
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ id: first.body.id, existing: true });
  });

  it("refuses a record that has not failed", async () => {
    const rec = await newRecord(managerToken);
    const res = await request(app).post(`/fai-inspection/records/${rec.id}/ncr`).set(auth(managerToken));
    expect(res.status).toBe(409);
  });

  it("needs the existing NCR create permission", async () => {
    const rec = await newRecord(managerToken);
    await request(app).post(`/fai-inspection/records/${rec.id}/sign`).set(auth(managerToken)).send({ pin: TEST_PIN, certified: true, outcome: "failed", description: "Six fixes fail 2" });
    const res = await request(app).post(`/fai-inspection/records/${rec.id}/ncr`).set(auth(noNcrToken));
    expect(res.status).toBe(403);
    const [still] = await db.select().from(inspRecords).where(eq(inspRecords.id, rec.id));
    expect(still!.ncrId).toBeNull();
  });
});

describe("Fix 2 — Submit for sign-off", () => {
  it("moves a draft to awaiting sign-off, audit-logs it, and sign-off still works", async () => {
    const rec = await newRecord(managerToken);
    const res = await request(app).post(`/fai-inspection/records/${rec.id}/submit-signoff`).set(auth(managerToken));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("awaiting_signoff");

    const audit = await lastAudit("FAI Inspection", rec.id);
    expect(audit).toBeTruthy();
    expect(audit!.performedBy).toBe(managerId);
    expect(JSON.stringify(audit!.changes).toLowerCase()).toContain("sign-off");

    const signed = await request(app).post(`/fai-inspection/records/${rec.id}/sign`).set(auth(managerToken)).send({ pin: TEST_PIN, certified: true, outcome: "passed", description: "Six fixes pass" });
    expect(signed.status).toBe(200);
    expect(signed.body.status).toBe("passed");
  });

  it("only accepts a draft or in-inspection record", async () => {
    const rec = await newRecord(managerToken);
    await request(app).post(`/fai-inspection/records/${rec.id}/submit-signoff`).set(auth(managerToken));
    const second = await request(app).post(`/fai-inspection/records/${rec.id}/submit-signoff`).set(auth(managerToken));
    expect(second.status).toBe(409);
  });

  it("needs fai.edit", async () => {
    const rec = await newRecord(managerToken);
    const viewer = await makeUser("operator", "quality");
    const res = await request(app).post(`/fai-inspection/records/${rec.id}/submit-signoff`).set(auth(viewer.token));
    expect(res.status).toBe(403);
  });
});

describe("Fix 3 — Audit log filters and paging", () => {
  const marker = `auditprobe${suffix}`;
  beforeAll(async () => {
    for (let i = 0; i < 5; i += 1) {
      await db.insert(auditTrail).values({ entityType: "NCR", entityId: 900000 + i, action: `update ${marker}`, changes: { description: `Filter probe ${marker} ${i}` }, performedBy: managerId });
    }
    await db.insert(auditTrail).values({ entityType: "SignIn", entityId: 1, action: `login ${marker}`, changes: {}, performedBy: userIds[userIds.length - 1] });
  });

  it("keeps the legacy array response without ?paged=1", async () => {
    const res = await request(app).get("/audit-trail").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("filters by user, record type, date range and action text", async () => {
    const byText = await request(app).get("/audit-trail").query({ paged: 1, q: marker, entityType: "NCR", userId: managerId }).set(auth(adminToken));
    expect(byText.status).toBe(200);
    expect(byText.body.rows).toHaveLength(5);
    expect(byText.body.rows.every((row: any) => row.entityType === "NCR" && row.performedBy === managerId)).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    const inRange = await request(app).get("/audit-trail").query({ paged: 1, q: marker, entityType: "NCR", from: today, to: today }).set(auth(adminToken));
    expect(inRange.body.rows.length).toBe(5);
    const past = await request(app).get("/audit-trail").query({ paged: 1, q: marker, entityType: "NCR", from: "2001-01-01", to: "2001-01-02" }).set(auth(adminToken));
    expect(past.body.rows).toHaveLength(0);

    const bad = await request(app).get("/audit-trail").query({ paged: 1, from: "not-a-date" }).set(auth(adminToken));
    expect(bad.status).toBe(400);
  });

  it("pages back to older entries with the cursor", async () => {
    const first = await request(app).get("/audit-trail").query({ paged: 1, q: marker, entityType: "NCR", limit: 2 }).set(auth(adminToken));
    expect(first.body.rows).toHaveLength(2);
    expect(first.body.nextBefore).toBeTruthy();
    const second = await request(app).get("/audit-trail").query({ paged: 1, q: marker, entityType: "NCR", limit: 2, before: first.body.nextBefore }).set(auth(adminToken));
    expect(second.body.rows).toHaveLength(2);
    const firstIds = first.body.rows.map((row: any) => row.id);
    expect(second.body.rows.every((row: any) => !firstIds.includes(row.id) && row.id < Math.min(...firstIds))).toBe(true);
    const third = await request(app).get("/audit-trail").query({ paged: 1, q: marker, entityType: "NCR", limit: 2, before: second.body.nextBefore }).set(auth(adminToken));
    expect(third.body.rows).toHaveLength(1);
    expect(third.body.nextBefore).toBeNull();
  });

  it("still keeps another person's sign-in entries Admin-only", async () => {
    const asManager = await request(app).get("/audit-trail").query({ paged: 1, q: marker, entityType: "SignIn" }).set(auth(managerToken));
    expect(asManager.status).toBe(200);
    expect(asManager.body.rows).toHaveLength(0);
    const asAdmin = await request(app).get("/audit-trail").query({ paged: 1, q: marker, entityType: "SignIn" }).set(auth(adminToken));
    expect(asAdmin.body.rows.length).toBeGreaterThan(0);

    const options = await request(app).get("/audit-trail/filters").set(auth(managerToken));
    expect(options.status).toBe(200);
    expect(options.body.entityTypes).not.toContain("SignIn");
  });
});

describe("Fix 5 — Engineering Planner link is a company setting", () => {
  it("is Admin-editable, validated, readable by anyone signed in, and audit-logged", async () => {
    const denied = await request(app).patch("/company/profile").set(auth(managerToken)).send({ engineeringPlannerUrl: "https://planner.example.com/a" });
    expect(denied.status).toBe(403);

    const bad = await request(app).patch("/company/profile").set(auth(adminToken)).send({ engineeringPlannerUrl: "javascript:alert(1)" });
    expect(bad.status).toBe(400);

    const [before] = await db.select().from(company);
    const set = await request(app).patch("/company/profile").set(auth(adminToken)).send({ engineeringPlannerUrl: "https://planner.example.com/a" });
    expect(set.status).toBe(200);
    expect(set.body.engineeringPlannerUrl).toBe("https://planner.example.com/a");

    const read = await request(app).get("/company/profile").set(auth(managerToken));
    expect(read.body.engineeringPlannerUrl).toBe("https://planner.example.com/a");

    const audit = await lastAudit("Company", 1);
    expect(JSON.stringify(audit!.changes)).toContain("Engineering Planner link");

    const cleared = await request(app).patch("/company/profile").set(auth(adminToken)).send({ engineeringPlannerUrl: "" });
    expect(cleared.body.engineeringPlannerUrl).toBeNull();

    if (before) await db.update(company).set({ profile: before.profile }).where(eq(company.id, before.id));
  });
});

describe("Fix 6 — Approved Sources add / edit / delete", () => {
  it("needs the new permission (the role, not a role name)", async () => {
    const body = { partNumber: `SRC-DENIED-${suffix}` };
    expect((await request(app).post("/fai-inspection/sources").set(auth(managerToken)).send(body)).status).toBe(403);
    const effective = await request(app).get("/permissions/effective").set(auth(sourcesToken));
    expect(effective.body["fai.sources.manage"]).toBe("edit");
    const none = await request(app).get("/permissions/effective").set(auth(managerToken));
    expect(none.body["fai.sources.manage"]).toBe("none");
  });

  it("creates with the FAI required default, edits, rejects duplicates, deletes, and audit-logs each step", async () => {
    const part = `SRC-${suffix}`;
    const create = await request(app).post("/fai-inspection/sources").set(auth(sourcesToken)).send({ partNumber: part, supplierFactory: "Factory 1", receivingLocation: "Dock A" });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe("fai_required");
    const id = create.body.id as number;
    expect((await lastAudit("FaiSourceApproval", id))!.action).toBe("create");

    const dup = await request(app).post("/fai-inspection/sources").set(auth(sourcesToken)).send({ partNumber: part, supplierFactory: "Factory 1", receivingLocation: "Dock A" });
    expect(dup.status).toBe(409);

    const edit = await request(app).put(`/fai-inspection/sources/${id}`).set(auth(sourcesToken)).send({ receivingLocation: "Dock B" });
    expect(edit.status).toBe(200);
    expect(edit.body.receivingLocation).toBe("Dock B");
    const editAudit = await lastAudit("FaiSourceApproval", id);
    expect(editAudit!.action).toBe("update");
    expect(JSON.stringify(editAudit!.changes)).toContain("Dock B");

    const statusIgnored = await request(app).put(`/fai-inspection/sources/${id}`).set(auth(sourcesToken)).send({ status: "approved" });
    expect([200, 400]).toContain(statusIgnored.status);
    const [row] = await db.select().from(inspApprovedSources).where(eq(inspApprovedSources.id, id));
    expect(row!.status).toBe("fai_required");

    const del = await request(app).delete(`/fai-inspection/sources/${id}`).set(auth(sourcesToken));
    expect(del.status).toBe(200);
    expect((await lastAudit("FaiSourceApproval", id))!.action).toBe("delete");
    expect(await db.select().from(inspApprovedSources).where(eq(inspApprovedSources.id, id))).toHaveLength(0);
  });

  it("can start a source at a chosen status", async () => {
    const res = await request(app).post("/fai-inspection/sources").set(auth(sourcesToken)).send({ partNumber: `SRC-ST-${suffix}`, status: "not_approved" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("not_approved");
    await request(app).delete(`/fai-inspection/sources/${res.body.id}`).set(auth(sourcesToken));
  });
});
