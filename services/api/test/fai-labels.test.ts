import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, desc, eq, sql } from "drizzle-orm";
import { ensureTestCompany } from "./helpers/company.js";
import { createApp } from "../src/app.js";
import { db } from "../src/db/index.js";
import { users } from "../src/drizzle/schema/users.js";
import { roles } from "../src/drizzle/schema/roles.js";
import { auditTrail } from "../src/drizzle/schema/auditTrail.js";
import { company } from "../src/drizzle/schema/company.js";
import { inspPlans, inspRecordSamples, inspRecords } from "../src/drizzle/schema/faiInspection.js";
import { inventoryItems, inventoryMovements, inventoryStock } from "../src/drizzle/schema/inventory.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { seedDefaultPermissions, seedTestRoles } from "./helpers/seedDefaults.js";
import { parseSampleCode, sampleCodeFor, sampleCountOf } from "../src/modules/fai-inspection/fai-labels.service.js";
import { updateRoleSchema } from "../src/modules/roles/roles.validation.js";

const app = createApp();
const suffix = Date.now().toString(36);
const FAI_VIEW = ["fai.view", "fai.create", "fai.edit"];
const userIds: number[] = [];
const recordIds: number[] = [];
const planIds: number[] = [];
let leadToken: string; // fai.view + labels.print + fai.scan
let viewerToken: string; // fai.view only
let scanOnlyToken: string; // fai.scan, no fai.view
let adminToken: string;
let leadId: number;
let savedProfile: unknown;

async function addPermissions(roleName: string, extra: string[], remove: string[] = []) {
  const [role] = await db.select().from(roles).where(eq(roles.name, roleName));
  if (!role) return;
  const next = [...new Set([...(role.permissions ?? []), ...extra])].filter((item) => !remove.includes(item));
  await db.update(roles).set({ permissions: next }).where(eq(roles.id, role.id));
}

async function makeUser(roleName: string, label: string) {
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, roleName));
  const [user] = await db
    .insert(users)
    .values({ email: `fai-labels-${label}-${suffix}@test.local`, passwordHash: "unused", department: "quality", roleId: role?.id ?? null, name: `Label Tester ${label}` })
    .returning();
  userIds.push(user!.id);
  return { id: user!.id, token: await signAccessToken({ sub: String(user!.id), roleId: null, roleName, department: "quality" }) };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function newRecord(token: string, body: Record<string, unknown> = {}, sampleSize: number | null = 5) {
  const res = await request(app)
    .post("/fai-inspection/records")
    .set(auth(token))
    .send({ faiNumber: `FAI-LBL-${suffix}-${Math.random().toString(36).slice(2, 5)}`.toUpperCase(), partNumber: "43GM1000PS", poReference: "4471", ...body });
  expect(res.status).toBe(201);
  recordIds.push(res.body.id);
  await db.update(inspRecords).set({ sampleSize }).where(eq(inspRecords.id, res.body.id));
  return res.body as { id: number; faiNumber: string };
}

async function lastAudit(id: number) {
  const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "FAI Inspection"), eq(auditTrail.entityId, id))).orderBy(desc(auditTrail.id)).limit(1);
  return row;
}

beforeAll(async () => {
  const co = await ensureTestCompany();
  await seedDefaultPermissions(co!.id);
  await seedTestRoles();
  await addPermissions("lead", [...FAI_VIEW, "labels.print", "fai.scan"]);
  await addPermissions("quality_manager", FAI_VIEW, ["labels.print", "fai.scan"]);
  await addPermissions("supervisor", ["fai.scan"], ["fai.view", "labels.print"]);
  const lead = await makeUser("lead", "lead");
  leadToken = lead.token;
  leadId = lead.id;
  viewerToken = (await makeUser("quality_manager", "viewer")).token;
  scanOnlyToken = (await makeUser("supervisor", "scanonly")).token;
  adminToken = (await makeUser("admin", "admin")).token;
  const [row] = await db.select({ profile: company.profile }).from(company).limit(1);
  savedProfile = row?.profile ?? null;
});

afterAll(async () => {
  for (const id of recordIds) {
    await db.delete(inspRecordSamples).where(eq(inspRecordSamples.recordId, id)).catch(() => {});
    await db.delete(inspRecords).where(eq(inspRecords.id, id)).catch(() => {});
  }
  for (const id of planIds) await db.delete(inspPlans).where(eq(inspPlans.id, id)).catch(() => {});
  await addPermissions("lead", [], ["labels.print", "fai.scan"]);
  await addPermissions("supervisor", [], ["fai.scan"]);
  if (savedProfile !== undefined) await db.update(company).set({ profile: savedProfile as never });
  for (const id of userIds) await db.delete(users).where(eq(users.id, id)).catch(() => {});
});

describe("sample codes", () => {
  it("are <FAI number>-S<n>, at least two digits, and read back", () => {
    expect(sampleCodeFor("FAI-0012", 3)).toBe("FAI-0012-S03");
    expect(sampleCodeFor("FAI-0012", 12)).toBe("FAI-0012-S12");
    expect(sampleCodeFor("FAI-0012", 123)).toBe("FAI-0012-S123");
    expect(parseSampleCode("FAI-0012-S03")).toEqual({ faiNumber: "FAI-0012", sampleNumber: 3 });
    expect(parseSampleCode("fai-0012-s123")).toEqual({ faiNumber: "fai-0012", sampleNumber: 123 });
    expect(parseSampleCode("43GM1000PS")).toBeNull();
    expect(parseSampleCode("FAI-0012-S00")).toBeNull();
  });

  it("each (FAI number, sample) pair has its own code", () => {
    const codes = new Set<string>();
    for (const fai of ["FAI-1", "FAI-1-S01", "FAI-2"]) for (let n = 1; n <= 150; n += 1) codes.add(sampleCodeFor(fai, n));
    expect(codes.size).toBe(450);
  });

  it("a record's samples come from its sample size, else the AQL sample size", () => {
    expect(sampleCountOf({ sampleSize: 5 })).toBe(5);
    expect(sampleCountOf({ sampleSize: null, aqlSampleSize: 80 })).toBe(80);
    expect(sampleCountOf({})).toBe(0);
    expect(sampleCountOf({ sampleSize: 99999 })).toBe(2000);
  });
});

describe("permissions", () => {
  it("are assignable on the Roles page and reported to the app", async () => {
    expect(updateRoleSchema.safeParse({ permissions: ["labels.print", "fai.scan", "fai.view", "fai.edit"] }).success).toBe(true);
    const lead = await request(app).get("/permissions/effective").set(auth(leadToken));
    expect(lead.body["labels.print"]).toBe("edit");
    expect(lead.body["fai.scan"]).toBe("edit");
    const viewer = await request(app).get("/permissions/effective").set(auth(viewerToken));
    expect(viewer.body["labels.print"]).toBe("none");
    expect(viewer.body["fai.scan"]).toBe("none");
  });
});

describe("sample tags on an FAI record", () => {
  it("lists every sample with its code; a viewer sees them but cannot print", async () => {
    const rec = await newRecord(leadToken);
    const lead = await request(app).get(`/fai-inspection/records/${rec.id}/samples`).set(auth(leadToken));
    expect(lead.status).toBe(200);
    expect(lead.body.sampleCount).toBe(5);
    expect(lead.body.canPrint).toBe(true);
    expect(lead.body.samples.map((s: { code: string }) => s.code)).toEqual([1, 2, 3, 4, 5].map((n) => `${rec.faiNumber}-S0${n}`));
    const viewer = await request(app).get(`/fai-inspection/records/${rec.id}/samples`).set(auth(viewerToken));
    expect(viewer.status).toBe(200);
    expect(viewer.body.canPrint).toBe(false);
    const none = await newRecord(leadToken, {}, null);
    const empty = await request(app).get(`/fai-inspection/records/${none.id}/samples`).set(auth(leadToken));
    expect(empty.body.sampleCount).toBe(0);
  });

  it("label data needs Can print labels and carries the company name from Settings and the default size", async () => {
    const rec = await newRecord(leadToken);
    expect((await request(app).get(`/fai-inspection/records/${rec.id}/labels`).set(auth(viewerToken))).status).toBe(403);
    const res = await request(app).get(`/fai-inspection/records/${rec.id}/labels`).set(auth(leadToken));
    expect(res.status).toBe(200);
    const [co] = await db.select({ name: company.name }).from(company).limit(1);
    expect(res.body).toMatchObject({ faiNumber: rec.faiNumber, partNumber: "43GM1000PS", lotReference: "4471", sampleCount: 5, companyName: co!.name });
    expect(["2x1", "2.25x1.25", "3x2", "4x6"]).toContain(res.body.defaultSize);
    expect(JSON.stringify(res.body)).not.toMatch(/DMA/);
  });

  it("printing needs the permission, valid samples and a sample size", async () => {
    const rec = await newRecord(leadToken);
    const path = `/fai-inspection/records/${rec.id}/labels/print`;
    expect((await request(app).post(path).set(auth(viewerToken)).send({ samples: [1], size: "2x1" })).status).toBe(403);
    expect((await request(app).post(path).set(auth(scanOnlyToken)).send({ samples: [1], size: "2x1" })).status).toBe(403);
    expect((await request(app).post(path).set(auth(leadToken)).send({ samples: [0], size: "2x1" })).status).toBe(400);
    expect((await request(app).post(path).set(auth(leadToken)).send({ samples: [6], size: "2x1" })).status).toBe(400);
    expect((await request(app).post(path).set(auth(leadToken)).send({ samples: [1], size: "9x9" })).status).toBe(400);
    expect((await request(app).post(path).set(auth(leadToken)).send({ samples: [], size: "2x1" })).status).toBe(400);
    const none = await newRecord(leadToken, {}, null);
    expect((await request(app).post(`/fai-inspection/records/${none.id}/labels/print`).set(auth(leadToken)).send({ samples: [1], size: "2x1" })).status).toBe(409);
    expect(await db.select().from(inspRecordSamples).where(eq(inspRecordSamples.recordId, rec.id))).toHaveLength(0);
  });

  it("printing registers the tags, counts them, audit-logs it and leaves the FAI record and inventory alone", async () => {
    const rec = await newRecord(leadToken);
    const [before] = await db.select().from(inspRecords).where(eq(inspRecords.id, rec.id));
    const inventoryCounts = async () => ({
      items: (await db.select({ n: sql<number>`count(*)::int` }).from(inventoryItems))[0]!.n,
      stock: (await db.select({ n: sql<number>`count(*)::int` }).from(inventoryStock))[0]!.n,
      movements: (await db.select({ n: sql<number>`count(*)::int` }).from(inventoryMovements))[0]!.n,
    });
    const inventoryBefore = await inventoryCounts();

    const res = await request(app).post(`/fai-inspection/records/${rec.id}/labels/print`).set(auth(leadToken)).send({ samples: [3, 1, 2, 3], size: "2x1" });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.labels).toEqual([1, 2, 3].map((n) => ({ number: n, code: `${rec.faiNumber}-S0${n}` })));

    const stored = await db.select().from(inspRecordSamples).where(eq(inspRecordSamples.recordId, rec.id));
    expect(stored.map((s) => [s.sampleNumber, s.printedCount, s.lastPrintedBy]).sort()).toEqual([[1, 1, leadId], [2, 1, leadId], [3, 1, leadId]]);

    await request(app).post(`/fai-inspection/records/${rec.id}/labels/print`).set(auth(leadToken)).send({ samples: [2], size: "3x2" });
    const again = await request(app).get(`/fai-inspection/records/${rec.id}/samples`).set(auth(leadToken));
    expect(again.body.samples.map((s: { printedCount: number }) => s.printedCount)).toEqual([1, 2, 1, 0, 0]);

    const audit = await lastAudit(rec.id);
    expect(audit!.performedBy).toBe(leadId);
    const text = String((audit!.changes as { description: string }).description);
    expect(text).toContain("Label Tester lead printed 1 sample tag for ");
    expect(text).toContain(`${rec.faiNumber} (43GM1000PS, PO 4471, 3 x 2 in labels)`);
    expect(text).not.toMatch(/\b\d{5,}\b/);

    // Printing never edits the form: same row, same status, same updated time.
    const [after] = await db.select().from(inspRecords).where(eq(inspRecords.id, rec.id));
    expect(after).toEqual(before);
    expect(await inventoryCounts()).toEqual(inventoryBefore);
  });

  it("a tag keeps its code if the FAI number is edited later, and deleting the record removes its tags", async () => {
    const rec = await newRecord(leadToken);
    await request(app).post(`/fai-inspection/records/${rec.id}/labels/print`).set(auth(leadToken)).send({ samples: [1], size: "2x1" });
    await db.update(inspRecords).set({ faiNumber: `${rec.faiNumber}-RENAMED` }).where(eq(inspRecords.id, rec.id));
    const printedAgain = await request(app).post(`/fai-inspection/records/${rec.id}/labels/print`).set(auth(leadToken)).send({ samples: [1], size: "2x1" });
    expect(printedAgain.body.labels[0].code).toBe(`${rec.faiNumber}-S01`);
    const scan = await request(app).get("/fai-inspection/scan").query({ code: `${rec.faiNumber}-S01` }).set(auth(leadToken));
    expect(scan.body.sample.recordId).toBe(rec.id);
    await request(app).delete(`/fai-inspection/records/${rec.id}`).set(auth(adminToken));
    expect(await db.select().from(inspRecordSamples).where(eq(inspRecordSamples.recordId, rec.id))).toHaveLength(0);
  });
});

describe("Scan to find: FAI & AQL", () => {
  it("opens a sample tag's FAI record with that sample highlighted (any letter case), and an unprinted tag finds nothing", async () => {
    const rec = await newRecord(leadToken);
    await request(app).post(`/fai-inspection/records/${rec.id}/labels/print`).set(auth(leadToken)).send({ samples: [3], size: "2x1" });
    const res = await request(app).get("/fai-inspection/scan").query({ code: rec.faiNumber.toLowerCase() + "-s03" }).set(auth(leadToken));
    expect(res.status).toBe(200);
    expect(res.body.sample).toMatchObject({ recordId: rec.id, sampleNumber: 3, sampleCount: 5, code: `${rec.faiNumber}-S03`, path: `/fai-inspection/records/${rec.id}?sample=3` });
    const unprinted = await request(app).get("/fai-inspection/scan").query({ code: `${rec.faiNumber}-S04` }).set(auth(leadToken));
    expect(unprinted.body.sample).toBeNull();
    expect(unprinted.body.results).toEqual([]);
  });

  it("lists a part number's plans and FAI records, newest first, and finds one record by its FAI number", async () => {
    const part = `SCAN-${suffix.toUpperCase()}`;
    const first = await newRecord(leadToken, { partNumber: part, poReference: "PO-A" });
    const [firstRow] = await db.select({ siteId: inspRecords.siteId }).from(inspRecords).where(eq(inspRecords.id, first.id));
    const [plan] = await db.insert(inspPlans).values({ partNumber: part, partDescription: "Test part", status: "Active", siteId: firstRow!.siteId }).returning();
    planIds.push(plan!.id);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await newRecord(leadToken, { partNumber: part, poReference: "PO-B" });
    await db.update(inspRecords).set({ createdAt: new Date(Date.now() + 60_000) }).where(eq(inspRecords.id, second.id));

    const res = await request(app).get("/fai-inspection/scan").query({ code: part.toLowerCase() }).set(auth(leadToken));
    expect(res.status).toBe(200);
    expect(res.body.sample).toBeNull();
    const found = res.body.results.map((r: { type: string; id: number }) => [r.type, r.id]);
    expect(found).toHaveLength(3);
    expect(found[0]).toEqual(["FAI record", second.id]); // newest first
    expect(found).toContainEqual(["FAI plan", plan!.id]);
    expect(found).toContainEqual(["FAI record", first.id]);
    expect(res.body.results[0].path).toBe(`/fai-inspection/records/${second.id}`);
    const dates = res.body.results.map((r: { date: string }) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);

    const byNumber = await request(app).get("/fai-inspection/scan").query({ code: first.faiNumber }).set(auth(leadToken));
    expect(byNumber.body.results).toHaveLength(1);
    expect(byNumber.body.results[0].path).toBe(`/fai-inspection/records/${first.id}`);

    const nothing = await request(app).get("/fai-inspection/scan").query({ code: "NO-SUCH-PART-9999" }).set(auth(leadToken));
    expect(nothing.body).toEqual({ sample: null, results: [] });
  });

  it("needs Can scan to find FAI and read access to FAI records", async () => {
    expect((await request(app).get("/fai-inspection/scan").query({ code: "43GM1000PS" }).set(auth(viewerToken))).status).toBe(403);
    expect((await request(app).get("/fai-inspection/scan").query({ code: "43GM1000PS" }).set(auth(scanOnlyToken))).status).toBe(403);
    expect((await request(app).get("/fai-inspection/scan").query({ code: "43GM1000PS" }).set(auth(leadToken))).status).toBe(200);
  });
});

describe("default label size (Settings)", () => {
  it("Admin sets it in Company Settings, it is audit-logged, others cannot, and label data reports it", async () => {
    const bad = await request(app).patch("/company/profile").set(auth(adminToken)).send({ labelSize: "9x9" });
    expect(bad.status).toBe(400);
    expect((await request(app).patch("/company/profile").set(auth(leadToken)).send({ labelSize: "3x2" })).status).toBe(403);

    const set = await request(app).patch("/company/profile").set(auth(adminToken)).send({ labelSize: "3x2" });
    expect(set.status).toBe(200);
    expect(set.body.labelSize).toBe("3x2");
    const [audit] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Company"), eq(auditTrail.entityId, 1))).orderBy(desc(auditTrail.id)).limit(1);
    expect(String((audit!.changes as { description?: string }).description)).toContain("default label size");

    const rec = await newRecord(leadToken);
    const label = await request(app).get(`/fai-inspection/records/${rec.id}/labels`).set(auth(leadToken));
    expect(label.body.defaultSize).toBe("3x2");
  });
});
