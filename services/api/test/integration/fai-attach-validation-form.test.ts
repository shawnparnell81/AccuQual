import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { documentFolders } from "../../src/drizzle/schema/documentFolders.js";
import { validationReports } from "../../src/drizzle/schema/validationReport.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedTestRoles } from "../helpers/seedDefaults.js";
import { setTestPin, TEST_PIN } from "../helpers/signaturePin.js";

const FAI_FULL_PERMISSIONS = ["fai.view", "fai.create", "fai.edit", "fai.delete", "fai.signoff", "fai.plans.manage"];
const FAI_VIEW_ONLY = ["fai.view"];
const ISO_DOCUMENTS_FOLDER = "ISO Compliance Documents";

const app = createApp();
const suffix = Date.now().toString(36);
const userIds: number[] = [];
let editorToken: string;
let viewOnlyToken: string;

async function makeUser(roleName: string, permissions: string[]) {
  const roleRowName = `${roleName}-${suffix}`;
  const [role] = await db.insert(roles).values({ name: roleRowName, permissions }).onConflictDoNothing().returning();
  const email = `fai-attach-${roleName}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`;
  const [user] = await db.insert(users).values({ email, passwordHash: "unused", department: "quality", roleId: role?.id ?? null }).returning();
  userIds.push(user!.id);
  await setTestPin(user!.id);
  const token = await signAccessToken({ sub: String(user!.id), roleId: null, roleName: roleRowName, department: "quality" });
  return token;
}

async function auditDescriptions(entityId: number): Promise<string[]> {
  const rows = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "FAI Inspection"), eq(auditTrail.entityId, entityId)));
  return rows.map((r) => (r.changes as any)?.description).filter((d): d is string => typeof d === "string");
}

async function faiFolderChildren() {
  const all = await db.select().from(documentFolders);
  const iso = all.find((f) => f.parentId == null && f.name === ISO_DOCUMENTS_FOLDER);
  const testData = iso && all.find((f) => f.parentId === iso.id && f.name === "Test Data Projects");
  const fai = testData && all.find((f) => f.parentId === testData.id && f.name === "FAI");
  return { fai, children: fai ? all.filter((f) => f.parentId === fai.id) : [] };
}

beforeAll(async () => {
  await ensureTestCompany();
  await seedTestRoles();
  await db.insert(documentFolders).values({ name: ISO_DOCUMENTS_FOLDER, parentId: null, sortOrder: 0 });

  editorToken = await makeUser("fai-editor", FAI_FULL_PERMISSIONS);
  viewOnlyToken = await makeUser("fai-viewer", FAI_VIEW_ONLY);
});

afterAll(async () => {
  for (const id of userIds) await db.delete(users).where(eq(users.id, id)).catch(() => {});
});

describe("FAI attach existing validation form", () => {
  it("auto-attaches a CSA validation report when the plan's productFamily is CSA", async () => {
    const plan = await request(app).post("/fai-inspection/plans").set("Authorization", `Bearer ${editorToken}`)
      .send({ partNumber: `ATTACH-CSA-${suffix}`, productFamily: "Complete Strut Assembly", characteristics: [] });
    expect(plan.status).toBe(201);

    const rec = await request(app).post("/fai-inspection/records").set("Authorization", `Bearer ${editorToken}`)
      .send({ faiNumber: `FAI-ATTACH-CSA-${suffix}`, planId: plan.body.id, partNumber: `ATTACH-CSA-${suffix}`, lotSize: 150 });
    expect(rec.status).toBe(201);
    expect(rec.body.linkedCsaFaiId).toBeTruthy();
    expect(rec.body.linkedFuelPumpFaiId).toBeFalsy();

    const [report] = await db.select().from(validationReports).where(eq(validationReports.id, rec.body.linkedCsaFaiId));
    expect(report).toBeTruthy();
    expect((report!.data as any).formType).toBe("csa");
    expect((report!.data as any).cells).toEqual({});
    expect(report!.recordNumber).toBeNull();

    const descriptions = await auditDescriptions(rec.body.id);
    const attachLine = descriptions.find((d) => d.includes("FRM-VAL-001"));
    expect(attachLine).toBeTruthy();
    expect(attachLine).not.toMatch(/#\d|\bid\s*[:=]?\s*\d/i);

    const { children } = await faiFolderChildren();
    const node = children.find((c) => c.linkedPath === `/validation-reports/${rec.body.linkedCsaFaiId}`);
    expect(node).toBeTruthy();
  });

  it("auto-attaches a Fuel Pump validation report when the plan's productFamily is Fuel Pump", async () => {
    const plan = await request(app).post("/fai-inspection/plans").set("Authorization", `Bearer ${editorToken}`)
      .send({ partNumber: `ATTACH-FP-${suffix}`, productFamily: "Fuel Pump", characteristics: [] });
    const rec = await request(app).post("/fai-inspection/records").set("Authorization", `Bearer ${editorToken}`)
      .send({ faiNumber: `FAI-ATTACH-FP-${suffix}`, planId: plan.body.id, partNumber: `ATTACH-FP-${suffix}` });
    expect(rec.status).toBe(201);
    expect(rec.body.linkedFuelPumpFaiId).toBeTruthy();
    expect(rec.body.linkedCsaFaiId).toBeFalsy();

    const [report] = await db.select().from(validationReports).where(eq(validationReports.id, rec.body.linkedFuelPumpFaiId));
    expect((report!.data as any).formType).toBe("fuel_pump");

    const { children } = await faiFolderChildren();
    expect(children.some((c) => c.linkedPath === `/validation-reports/${rec.body.linkedFuelPumpFaiId}`)).toBe(true);
  });

  it("attaches nothing for an unrelated product family", async () => {
    const plan = await request(app).post("/fai-inspection/plans").set("Authorization", `Bearer ${editorToken}`)
      .send({ partNumber: `ATTACH-BRAKE-${suffix}`, productFamily: "Brake pads", characteristics: [] });
    const rec = await request(app).post("/fai-inspection/records").set("Authorization", `Bearer ${editorToken}`)
      .send({ faiNumber: `FAI-ATTACH-BRAKE-${suffix}`, planId: plan.body.id, partNumber: `ATTACH-BRAKE-${suffix}` });
    expect(rec.status).toBe(201);
    expect(rec.body.linkedCsaFaiId).toBeFalsy();
    expect(rec.body.linkedFuelPumpFaiId).toBeFalsy();
    return rec;
  });

  it("manual attach works, attaching the same type twice is 409, and a user without fai.edit gets 403", async () => {
    const rec = await request(app).post("/fai-inspection/records").set("Authorization", `Bearer ${editorToken}`)
      .send({ faiNumber: `FAI-ATTACH-MANUAL-${suffix}`, partNumber: `ATTACH-MANUAL-${suffix}` });
    expect(rec.body.linkedCsaFaiId).toBeFalsy();

    const denied = await request(app).post(`/fai-inspection/records/${rec.body.id}/attach-form`).set("Authorization", `Bearer ${viewOnlyToken}`).send({ formType: "csa" });
    expect(denied.status).toBe(403);

    const attach = await request(app).post(`/fai-inspection/records/${rec.body.id}/attach-form`).set("Authorization", `Bearer ${editorToken}`).send({ formType: "csa" });
    expect(attach.status).toBe(200);
    expect(attach.body.linkedCsaFaiId).toBeTruthy();
    expect(attach.body.attachedForms).toContainEqual(expect.objectContaining({ formType: "csa", title: "CSA Validation Report (FRM-VAL-001)" }));

    const again = await request(app).post(`/fai-inspection/records/${rec.body.id}/attach-form`).set("Authorization", `Bearer ${editorToken}`).send({ formType: "csa" });
    expect(again.status).toBe(409);

    const reportId = attach.body.linkedCsaFaiId;
    const detach = await request(app).post(`/fai-inspection/records/${rec.body.id}/detach-form`).set("Authorization", `Bearer ${editorToken}`).send({ formType: "csa" });
    expect(detach.status).toBe(200);
    expect(detach.body.linkedCsaFaiId).toBeFalsy();

    const [stillThere] = await db.select().from(validationReports).where(eq(validationReports.id, reportId));
    expect(stillThere).toBeTruthy();
  });

  it("AQL sample size on create is still computed as before", async () => {
    const rec = await request(app).post("/fai-inspection/records").set("Authorization", `Bearer ${editorToken}`)
      .send({ faiNumber: `FAI-ATTACH-AQL-${suffix}`, partNumber: `ATTACH-AQL-${suffix}`, lotSize: 500 });
    expect(rec.status).toBe(201);
    expect(rec.body.codeLetter).toBe("H");
    expect(rec.body.aqlSampleSize).toBe(50);
  });
});

describe("FAI attach: every product family", () => {
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it("auto-attaches the matching form for a new family, through the generic link", async () => {
    const plan = await request(app).post("/fai-inspection/plans").set(auth(editorToken))
      .send({ partNumber: `ATTACH-GAS-${suffix}`, productFamily: "Gas Lift Support", characteristics: [] });
    const rec = await request(app).post("/fai-inspection/records").set(auth(editorToken))
      .send({ faiNumber: `FAI-ATTACH-GAS-${suffix}`, planId: plan.body.id, partNumber: `ATTACH-GAS-${suffix}` });
    expect(rec.status).toBe(201);
    expect(rec.body.linkedValidationReportId).toBeTruthy();
    expect(rec.body.linkedValidationFormType).toBe("regular_gas_lift");
    expect(rec.body.linkedCsaFaiId).toBeFalsy();
    expect(rec.body.linkedFuelPumpFaiId).toBeFalsy();
    const [report] = await db.select().from(validationReports).where(eq(validationReports.id, rec.body.linkedValidationReportId));
    expect((report!.data as any).formType).toBe("regular_gas_lift");
    const got = await request(app).get(`/fai-inspection/records/${rec.body.id}`).set(auth(editorToken));
    expect(got.body.productType).toBe("regular_gas_lift");
    expect(got.body.attachedForms).toEqual([expect.objectContaining({ formType: "regular_gas_lift", title: "Regular Gas Lift Support Validation (FRM-VAL-012)", openPath: `/validation-reports/${rec.body.linkedValidationReportId}` })]);
  });

  it("manual attach and detach of a new type are audit-logged; a second generic form is 409; wrong type is 400; viewer 403", async () => {
    const rec = await request(app).post("/fai-inspection/records").set(auth(editorToken))
      .send({ faiNumber: `FAI-ATTACH-SHOCK-${suffix}`, partNumber: `ATTACH-SHOCK-${suffix}` });
    const path = `/fai-inspection/records/${rec.body.id}`;
    expect((await request(app).post(`${path}/attach-form`).set(auth(viewOnlyToken)).send({ formType: "shock" })).status).toBe(403);
    expect((await request(app).post(`${path}/attach-form`).set(auth(editorToken)).send({ formType: "nonsense" })).status).toBe(400);
    const attach = await request(app).post(`${path}/attach-form`).set(auth(editorToken)).send({ formType: "shock" });
    expect(attach.status).toBe(200);
    expect(attach.body.linkedValidationFormType).toBe("shock");
    expect((await request(app).post(`${path}/attach-form`).set(auth(editorToken)).send({ formType: "shock" })).status).toBe(409);
    expect((await request(app).post(`${path}/attach-form`).set(auth(editorToken)).send({ formType: "coil_spring" })).status).toBe(409);
    // CSA still has its own link and can sit beside the generic one.
    expect((await request(app).post(`${path}/attach-form`).set(auth(editorToken)).send({ formType: "csa" })).status).toBe(200);

    const reportId = attach.body.linkedValidationReportId;
    const detach = await request(app).post(`${path}/detach-form`).set(auth(editorToken)).send({ formType: "shock" });
    expect(detach.status).toBe(200);
    expect(detach.body.linkedValidationReportId).toBeNull();
    expect(detach.body.linkedValidationFormType).toBeNull();
    expect(detach.body.linkedCsaFaiId).toBeTruthy();
    const [kept] = await db.select().from(validationReports).where(eq(validationReports.id, reportId));
    expect(kept).toBeTruthy();
    const lines = await auditDescriptions(rec.body.id);
    expect(lines.some((d) => d.startsWith("Attached Shock Validation (FRM-VAL-002)"))).toBe(true);
    expect(lines.some((d) => d.startsWith("Detached Shock Validation (FRM-VAL-002)"))).toBe(true);
  });

  it("existing records with the old CSA / Fuel Pump links still show their form, and the new columns exist", async () => {
    const [report] = await db.insert(validationReports).values({ data: { formType: "csa", cells: {} } }).returning();
    const created = await request(app).post("/fai-inspection/records").set(auth(editorToken)).send({ faiNumber: `FAI-ATTACH-OLD-${suffix}`, partNumber: `ATTACH-OLD-${suffix}` });
    const { inspRecords } = await import("../../src/drizzle/schema/faiInspection.js");
    await db.update(inspRecords).set({ linkedCsaFaiId: report!.id }).where(eq(inspRecords.id, created.body.id));
    const got = await request(app).get(`/fai-inspection/records/${created.body.id}`).set(auth(editorToken));
    expect(got.body.attachedForms).toEqual([expect.objectContaining({ formType: "csa", reportId: report!.id })]);
    expect(got.body).toHaveProperty("linkedValidationReportId");
    expect(got.body).toHaveProperty("linkedValidationFormType");
  });
});
