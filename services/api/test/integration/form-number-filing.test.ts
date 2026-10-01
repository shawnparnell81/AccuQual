import { ensureTestCompany } from "../helpers/company.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { formFilings } from "../../src/drizzle/schema/formFilings.js";
import { isoQualityForms } from "../../src/drizzle/schema/isoQualityForms.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

let qualityToken: string;
let productionToken: string;
let managerToken: string;
let engineeringToken: string;

describe("editable form numbers and folder filing", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [quality] = await db.insert(users).values({ email: `form-number-q-${suffix}@test.local`, passwordHash: "unused" }).returning();
    const [production] = await db.insert(users).values({ email: `form-number-p-${suffix}@test.local`, passwordHash: "unused" }).returning();
    const [manager] = await db.insert(users).values({ email: `form-number-m-${suffix}@test.local`, passwordHash: "unused" }).returning();
    const [engineering] = await db.insert(users).values({ email: `form-number-e-${suffix}@test.local`, passwordHash: "unused" }).returning();
    qualityToken = signAccessToken({ sub: String(quality!.id), roleId: null, roleName: "operator", department: "quality" });
    productionToken = signAccessToken({ sub: String(production!.id), roleId: null, roleName: "operator", department: "production" });
    managerToken = signAccessToken({ sub: String(manager!.id), roleId: null, roleName: "quality_manager", department: "production" });
    engineeringToken = signAccessToken({ sub: String(engineering!.id), roleId: null, roleName: "operator", department: "engineering" });
  });

  it("keeps an edited number, leaves older copies blank, and files into a chosen folder", async () => {
    const templates = await request(app).get("/document-folders/form-templates").set("Authorization", `Bearer ${qualityToken}`);
    expect(templates.status).toBe(200);
    expect(templates.body.templates.find((form: { formKey: string }) => form.formKey === "frm-ncr-001")?.formId).toBe("FRM-NCR-001");
    expect(templates.body.templates.find((form: { formKey: string }) => form.formKey === "frm-trn-001")?.formId).toBe("FRM-TRN-001");

    const setNcr = await request(app).patch("/document-folders/form-templates/frm-ncr-001").set("Authorization", `Bearer ${engineeringToken}`).send({ formId: "NOPE" });
    expect(setNcr.status).toBe(200);
    expect(setNcr.body.formId).toBe("NOPE");
    await request(app).patch("/document-folders/form-templates/frm-ncr-001").set("Authorization", `Bearer ${engineeringToken}`).send({ formId: "" });

    const denied = await request(app).patch("/document-folders/form-templates/frm-qa-001").set("Authorization", `Bearer ${productionToken}`).send({ formId: "QA-1" });
    expect(denied.status).toBe(403);

    const qualityStaff = await request(app).patch("/document-folders/form-templates/frm-qa-001").set("Authorization", `Bearer ${qualityToken}`).send({ formId: "QA-1" });
    expect(qualityStaff.status).toBe(403);

    const managerSet = await request(app).patch("/document-folders/form-templates/frm-qa-001").set("Authorization", `Bearer ${managerToken}`).send({ formId: "QA-14" });
    expect(managerSet.status).toBe(200);
    expect(managerSet.body.formId).toBe("QA-14");

    const cleared = await request(app).patch("/document-folders/form-templates/frm-qa-001").set("Authorization", `Bearer ${engineeringToken}`).send({ formId: "  " });
    expect(cleared.status).toBe(200);
    expect(cleared.body.formId).toBe("");

    const setAgain = await request(app).patch("/document-folders/form-templates/frm-qa-001").set("Authorization", `Bearer ${engineeringToken}`).send({ formId: "QA-14" });
    expect(setAgain.status).toBe(200);

    const again = await request(app).get("/document-folders/form-templates").set("Authorization", `Bearer ${qualityToken}`);
    expect(again.body.templates.find((form: { formKey: string }) => form.formKey === "frm-qa-001")?.formId).toBe("QA-14");
    expect(again.body.templates.find((form: { formKey: string }) => form.formKey === "frm-ncr-001")?.formId).toBe("FRM-NCR-001");
    expect(again.body.templates.find((form: { formKey: string }) => form.formKey === "frm-psw-001")?.formId).toBe("");

    const [historical] = await db.insert(isoQualityForms).values({ formType: "quality_alert", data: { cells: {} } }).returning();
    await db.insert(formFilings).values({ formKey: "frm-qa-001", recordId: historical!.id, formNumber: "" });

    const oldCopy = await request(app).get(`/document-folders/form-filings?formKey=frm-qa-001&recordId=${historical!.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(oldCopy.status).toBe(200);
    expect(oldCopy.body.formNumber).toBe("");
    expect(oldCopy.body.snapshotted).toBe(true);

    const created = await request(app).post("/iso-quality-forms").set("Authorization", `Bearer ${qualityToken}`).send({ formType: "quality_alert", data: { cells: {} } });
    expect(created.status).toBe(201);
    const fresh = await request(app).get(`/document-folders/form-filings?formKey=frm-qa-001&recordId=${created.body.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(fresh.body.formNumber).toBe("QA-14");
    expect(fresh.body.snapshotted).toBe(true);

    await request(app).patch("/document-folders/form-templates/frm-qa-001").set("Authorization", `Bearer ${engineeringToken}`).send({ formId: "QA-99" });
    const still = await request(app).get(`/document-folders/form-filings?formKey=frm-qa-001&recordId=${created.body.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(still.body.formNumber).toBe("QA-14");
    const library = await request(app).get("/document-folders/form-templates").set("Authorization", `Bearer ${qualityToken}`);
    expect(library.body.templates.find((form: { formKey: string }) => form.formKey === "frm-qa-001")?.formId).toBe("QA-99");

    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    const folders = tree.body as { id: number; name: string; parentId: number | null }[];
    let quality = folders.find((folder) => folder.parentId === null && folder.name === "Quality");
    if (!quality) {
      const made = await request(app).post("/document-folders").set("Authorization", `Bearer ${qualityToken}`).send({ name: "Quality" });
      quality = made.body;
    }
    let customer = folders.find((folder) => folder.parentId === quality?.id && folder.name === "Customer Quality");
    if (!customer) {
      const made = await request(app).post("/document-folders").set("Authorization", `Bearer ${qualityToken}`).send({ name: "Customer Quality", parentId: quality!.id });
      customer = made.body;
    }
    const productAlerts = folders.find((folder) => folder.parentId === quality?.id && folder.name === "Product Alerts");
    expect(productAlerts?.id).toBeTruthy();
    const suggested = await request(app).get(`/document-folders/form-filings?formKey=frm-qa-001&recordId=${created.body.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(suggested.body.suggestedFolderId).toBe(productAlerts!.id);
    expect(suggested.body.suggestedPath).toEqual(["Quality", "Product Alerts"]);

    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents");
    expect(iso?.id).toBeTruthy();
    const filed = await request(app).post("/document-folders/form-filings").set("Authorization", `Bearer ${qualityToken}`).send({ formKey: "frm-qa-001", recordId: created.body.id, folderId: iso!.id });
    expect(filed.status).toBe(201);
    expect(filed.body.formNumber).toBe("QA-14");
    expect(filed.body.parentId).toBe(iso!.id);
    expect(filed.body.fileName).toMatch(/^QualityAlert_/);

    const moved = await request(app).post("/document-folders/form-filings").set("Authorization", `Bearer ${qualityToken}`).send({ formKey: "frm-qa-001", recordId: created.body.id, folderId: customer!.id });
    expect(moved.status).toBe(201);
    expect(moved.body.parentId).toBe(customer!.id);
    expect(moved.body.formNumber).toBe("QA-14");
    expect(moved.body.fileName).toBe(filed.body.fileName);

    const audits = await db
      .select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityType, "DocumentFolder"), eq(auditTrail.entityId, moved.body.folderNodeId)));
    expect(audits.some((row) => (row.changes as { event?: string; toParentId?: number } | null)?.event === "moved" && (row.changes as { toParentId?: number }).toParentId === customer!.id)).toBe(true);

    const numberAudit = await db.select().from(auditTrail).where(eq(auditTrail.entityType, "ControlledFormTemplate"));
    expect(numberAudit.some((row) => (row.changes as { event?: string; to?: string } | null)?.event === "form_number" && (row.changes as { to?: string }).to === "QA-99")).toBe(true);
  });

  it("files an FRM NCR into a Documents folder and lets a quality manager read its history", async () => {
    const templates = await request(app).get("/document-folders/form-templates").set("Authorization", `Bearer ${qualityToken}`);
    expect(templates.status).toBe(200);
    const masters = templates.body.templates as { formKey: string; formId: string }[];
    const masterId = (formKey: string) => masters.find((form) => form.formKey === formKey)?.formId ?? "";

    const ncr = await request(app).post("/iso-quality-forms").set("Authorization", `Bearer ${qualityToken}`).send({ formType: "ncr_report", data: { cells: { B8: "Cracked housing" } } });
    expect(ncr.status).toBe(201);
    const ncrFiling = await request(app).get(`/document-folders/form-filings?formKey=frm-ncr-001&recordId=${ncr.body.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(ncrFiling.status).toBe(200);
    expect(ncrFiling.body.snapshotted).toBe(true);
    expect(ncrFiling.body.formNumber).toBe(masterId("frm-ncr-001"));
    expect(ncrFiling.body.suggestedPath).toEqual(["NCR"]);

    const stillFiled = [
      ["quality_alert", "frm-qa-001"],
      ["psw", "frm-psw-001"],
      ["first_article", "frm-fai-001"],
      ["quarantine_notice", "frm-ncr-002"],
      ["concession", "frm-ncr-003"],
    ] as const;
    for (const [formType, formKey] of stillFiled) {
      const created = await request(app).post("/iso-quality-forms").set("Authorization", `Bearer ${qualityToken}`).send({ formType, data: { cells: {} } });
      expect(created.status).toBe(201);
      const filing = await request(app).get(`/document-folders/form-filings?formKey=${formKey}&recordId=${created.body.id}`).set("Authorization", `Bearer ${qualityToken}`);
      expect(filing.status).toBe(200);
      expect(filing.body.snapshotted).toBe(true);
      expect(filing.body.formNumber).toBe(masterId(formKey));
    }

    expect((await request(app).get("/document-folders/form-filings?formKey=ncr&recordId=1").set("Authorization", `Bearer ${qualityToken}`)).status).toBe(400);
    expect((await request(app).get("/document-folders/form-filings?formKey=capa&recordId=1").set("Authorization", `Bearer ${qualityToken}`)).status).toBe(400);
    expect((await request(app).get("/document-folders/form-filings?formKey=8d&recordId=1").set("Authorization", `Bearer ${qualityToken}`)).status).toBe(400);

    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    const folders = tree.body as { id: number; name: string; parentId: number | null }[];
    const ncrFolder = folders.find((folder) => folder.parentId === null && folder.name === "NCR");
    expect(ncrFolder?.id).toBeTruthy();

    const filed = await request(app).post("/document-folders/form-filings").set("Authorization", `Bearer ${qualityToken}`).send({ formKey: "frm-ncr-001", recordId: ncr.body.id, folderId: ncrFolder!.id });
    expect(filed.status).toBe(201);
    expect(filed.body.parentId).toBe(ncrFolder!.id);
    expect(filed.body.formNumber).toBe(masterId("frm-ncr-001"));

    const after = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    const saved = (after.body as { name: string; parentId: number | null; linkedPath?: string | null }[]).find((folder) => folder.linkedPath === `/iso-forms/record/${ncr.body.id}`);
    expect(saved?.parentId).toBe(ncrFolder!.id);
    expect(saved?.name).toBe(filed.body.fileName);

    const history = await request(app).get(`/workflow/history/iso_forms/${ncr.body.id}`).set("Authorization", `Bearer ${managerToken}`);
    expect(history.status).toBe(200);
    expect((history.body as { action: string }[]).some((row) => row.action === "create")).toBe(true);
    const audit = await request(app).get(`/audit-trail/${encodeURIComponent("ISO form")}/${ncr.body.id}`).set("Authorization", `Bearer ${managerToken}`);
    expect(audit.status).toBe(200);
    expect(audit.body.length).toBeGreaterThan(0);
  });
});
