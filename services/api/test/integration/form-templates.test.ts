import { ensureTestCompany } from "../helpers/company.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { company } from "../../src/drizzle/schema/company.js";
import { blankTemplateLabel, blankTemplateStartPath, FORM_TEMPLATES, filedRecordName, keptOutOfBlankFormsTemplates } from "../../src/modules/document-folders/formFiling.js";

const app = createApp();
const suffix = Date.now();

let token: string;
let userId: number;

describe("ISO Compliance Documents form templates", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [user] = await db
      .insert(users)
      .values({ email: `form-templates-${suffix}@test.local`, passwordHash: "unused", name: "Shawn Parnell" })
      .returning();
    userId = user!.id;
    token = signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department: "quality" });
  });

  it("files each fillable blank once under Blank Forms Templates and leaves the living lists on the older drawer", async () => {
    expect(filedRecordName("FRM-VAL-007", 12, "2026-09-28")).toBe("FRM-VAL-007_12_2026-09-28");

    const first = await request(app).get("/document-folders/form-templates").set("Authorization", `Bearer ${token}`);
    expect(first.status).toBe(200);
    const again = await request(app).get("/document-folders/form-templates").set("Authorization", `Bearer ${token}`);
    expect(again.body.templates).toHaveLength(first.body.templates.length);
    expect(first.body.fileNamePattern).toBe("{formId}_{recordNumber}_{date}");

    const templates = first.body.templates as { formKey: string; formId: string; title: string; subjectRoute: string; folderId: number; isoPath: string[]; start: { createPath: string; openPath: string; body: Record<string, unknown> } | null }[];
    const csa = templates.find((form) => form.formKey === "frm-val-001");
    const pump = templates.find((form) => form.formKey === "frm-val-007");
    const eightD = templates.find((form) => form.formKey === "8d");
    const ncr = templates.find((form) => form.formKey === "ncr");
    const training = templates.find((form) => form.formKey === "training-record");
    const audit = templates.find((form) => form.formKey === "audit-plan");
    expect(csa?.formId).toBe("FRM-VAL-001");
    expect(csa?.title).toBe("CSA VALIDATION REPORT");
    expect(pump?.formId).toBe("FRM-VAL-007");
    expect(pump?.title).toBe("FUEL PUMP VALIDATION DOCUMENT");
    expect(csa?.isoPath).toEqual(["Blank Forms Templates", "Validation"]);
    expect(pump?.folderId).toBe(csa?.folderId);
    expect(csa?.subjectRoute).toBe("/folders/validation-reports");
    expect(csa?.start).toEqual({ createPath: "/validation-reports", openPath: "/validation-reports/{id}", body: { data: { formType: "csa", cells: {} } } });
    expect(pump?.start).toEqual({ createPath: "/validation-reports", openPath: "/validation-reports/{id}", body: { data: { formType: "fuel_pump", cells: {} } } });
    expect(eightD?.isoPath).toEqual(["Blank Forms Templates", "Problem Solving"]);
    expect(eightD?.subjectRoute).toBe("/8d");
    expect(eightD?.start).toEqual({ createPath: "/8d", openPath: "/8d/{id}", body: {} });
    const linked = templates.filter((form) => form.start == null);
    expect(linked.map((form) => form.formKey).sort()).toEqual(["frm-msa-001", "frm-par-001", "lst-eqp-001", "lst-gen-001"]);
    expect(templates.find((form) => form.formKey === "frm-psw-001")?.formId).toBe("");
    expect((templates.find((form) => form.formKey === "frm-psw-001") as { fileNamePattern?: string } | undefined)?.fileNamePattern).toBe("PSW_{recordNumber}_{date}");
    expect(templates.find((form) => form.formKey === "frm-msa-001")?.formId).toBe("");
    expect((templates.find((form) => form.formKey === "frm-par-001") as { fileNamePattern?: string } | undefined)?.fileNamePattern).toBe("Pareto_{recordNumber}_{date}");
    expect(templates.find((form) => form.formKey === "frm-fai-001")?.start?.body).toMatchObject({ formType: "first_article" });
    expect(templates.find((form) => form.formKey === "frm-fae-001")?.subjectRoute).toBe("/iso-forms/frm-fae-001");
    expect(templates.filter((form) => form.formKey === "frm-psw-001")).toHaveLength(1);
    expect(templates.filter((form) => form.start).every((form) => form.start?.openPath.includes("{id}"))).toBe(true);
    const equipmentList = templates.find((form) => form.formKey === "lst-eqp-001");
    const documentList = templates.find((form) => form.formKey === "lst-gen-001");
    const auditForm = templates.find((form) => form.formKey === "frm-gen-001");
    const ncrForm = templates.find((form) => form.formKey === "frm-ncr-001");
    expect(equipmentList?.subjectRoute).toBe("/calibration/master-list");
    expect(equipmentList?.isoPath).toEqual(["Blank Form Templates", "Calibration"]);
    expect(documentList?.subjectRoute).toBe("/documents/master-list");
    expect(documentList?.isoPath).toEqual(["Blank Form Templates", "Document Control"]);
    expect(keptOutOfBlankFormsTemplates({ formKey: "lst-gen-003", formId: "LST-GEN-003", title: "Scope of Laboratory Activities" })).toBe(true);
    expect(keptOutOfBlankFormsTemplates({ title: "Master Equipment List" })).toBe(true);
    expect(keptOutOfBlankFormsTemplates({ formKey: "frm-val-001", formId: "FRM-VAL-001", title: "CSA VALIDATION REPORT" })).toBe(false);
    expect(auditForm?.formId).toBe("FRM-GEN-001");
    expect(auditForm?.title).toBe("AUDIT CHECKLIST");
    const crossTraining = templates.find((form) => form.formKey === "frm-trn-002");
    expect(crossTraining?.formId).toBe("FRM-TRN-002");
    expect(crossTraining?.title).toBe("GRADING RUBRIC: CROSS-TRAINING EVALUATION");
    expect((crossTraining as { fileNamePattern?: string } | undefined)?.fileNamePattern).toBe("{formId}_{recordNumber}_{date}");
    expect(filedRecordName("FRM-TRN-002", 4, "2026-09-28", "{formId}_{recordNumber}_{date}")).toBe("FRM-TRN-002_4_2026-09-28");
    expect(templates.find((form) => form.formKey === "frm-trn-001")).toMatchObject({ formId: "FRM-TRN-001", title: "COMPETENCY AND TRAINING RECORD" });
    expect(training?.title).toBe("Training & Competency Record");
    expect(auditForm?.start?.createPath).toBe("/iso-quality-forms");
    expect(ncrForm?.formId).toBe("FRM-NCR-001");
    expect(ncrForm?.title).toBe("NON-CONFORMANCE REPORT (NCR)");
    expect(ncrForm?.subjectRoute).toBe("/iso-forms/frm-ncr-001");
    expect(ncr?.subjectRoute).toBe("/ncr");
    expect(ncr?.isoPath).toEqual(["Blank Forms Templates", "Nonconformance"]);
    expect(training?.isoPath).toEqual(["Blank Forms Templates", "Training"]);
    expect(audit?.isoPath).toEqual(["Blank Forms Templates", "Audit"]);
    expect(templates.filter((form) => form.formKey === "frm-val-001")).toHaveLength(1);

    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    expect(tree.status).toBe(200);
    const folders = tree.body as { id: number; name: string; parentId: number | null; sortOrder: number; linkedPath: string | null }[];
    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents");
    const blanks = folders.find((folder) => folder.parentId === iso?.id && folder.name === "Blank Forms Templates");
    const legacy = folders.find((folder) => folder.parentId === iso?.id && folder.name === "Blank Form Templates");
    const validation = folders.find((folder) => folder.parentId === blanks?.id && folder.name === "Validation");
    expect(blanks).toBeTruthy();
    expect(legacy).toBeTruthy();
    expect(validation?.id).toBe(csa?.folderId);
    expect(folders.find((folder) => folder.parentId === legacy?.id && folder.name === "Calibration")?.id).toBe(equipmentList?.folderId);
    expect(folders.find((folder) => folder.parentId === legacy?.id && folder.name === "Document Control")?.id).toBe(documentList?.folderId);

    const topicNames = folders
      .filter((folder) => folder.parentId === blanks?.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((folder) => folder.name);
    expect(topicNames).toEqual([...topicNames].sort((a, b) => a.localeCompare(b)));
    const expectedValidation = FORM_TEMPLATES.filter((seed) => seed.topic === "Validation" && seed.start)
      .sort((a, b) => a.title.localeCompare(b.title) || a.formKey.localeCompare(b.formKey))
      .map((seed) => blankTemplateLabel(seed.formId, seed.title));
    const validationLeaves = folders
      .filter((folder) => folder.parentId === validation?.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .map((folder) => folder.name);
    expect(validationLeaves).toEqual(expectedValidation);
    const startLeaves = folders.filter((folder) => folder.linkedPath?.startsWith("/blank-forms/start/"));
    const fillable = templates.filter((form) => form.start);
    expect(startLeaves).toHaveLength(fillable.length);
    expect(startLeaves.filter((folder) => folder.linkedPath === blankTemplateStartPath("frm-val-001"))).toHaveLength(1);
    expect(startLeaves.find((folder) => folder.linkedPath === blankTemplateStartPath("frm-val-007"))?.name).toBe("FRM-VAL-007 FUEL PUMP VALIDATION DOCUMENT");
    expect(startLeaves.find((folder) => folder.linkedPath === blankTemplateStartPath("frm-tst-001"))?.name).toBe("FRM-TST-001 ASTM E542 Gravimetric Volume Calculator");
    expect(startLeaves.find((folder) => folder.linkedPath === blankTemplateStartPath("frm-tst-002"))?.name).toBe("FRM-TST-002 ASTM E542 Gravimetric Volume Calculator");
    expect(startLeaves.find((folder) => folder.linkedPath === blankTemplateStartPath("dcr"))?.name).toBe("Document Change Request");
    expect(startLeaves.find((folder) => folder.linkedPath === blankTemplateStartPath("frm-ecr-001"))?.name).toContain("FRM-ECR-001");
    expect(startLeaves.some((folder) => folder.linkedPath === blankTemplateStartPath("lst-gen-001") || folder.linkedPath === blankTemplateStartPath("lst-eqp-001") || folder.linkedPath === blankTemplateStartPath("lst-gen-003"))).toBe(false);
    expect(folders.some((folder) => folder.parentId === blanks?.id && /Master (Document|Equipment) List|Scope of Laboratory Activities/.test(folder.name))).toBe(false);

    const reloaded = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    const reloadedLeaves = (reloaded.body as { linkedPath: string | null }[]).filter((folder) => folder.linkedPath?.startsWith("/blank-forms/start/"));
    expect(reloadedLeaves).toHaveLength(startLeaves.length);
    expect((reloaded.body as { name: string; parentId: number | null }[]).filter((folder) => folder.parentId === iso?.id && folder.name === "Blank Forms Templates")).toHaveLength(1);

    const [marked] = await db.select().from(company).limit(1);
    expect(marked?.profile?.blankFormsTemplatesReady).toBe(true);
    expect(marked?.profile?.blankFormKeysPlaced).toContain("frm-val-001");
    expect(marked?.profile?.blankFormKeysPlaced).not.toContain("lst-gen-001");
    expect(marked?.profile?.blankFormKeysPlaced).not.toContain("lst-eqp-001");
    const audits = await db.select().from(auditTrail);
    const moved = audits.find((row) => row.entityType === "DocumentFolder" && (row.changes as { event?: string; summary?: string } | null)?.event === "moved");
    expect(moved?.performedBy).toBe(userId);
    expect(String((moved?.changes as { summary?: string } | null)?.summary)).toContain("Blank Forms Templates");
    expect(folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance")).toBeUndefined();
    expect(folders.find((folder) => folder.parentId === iso?.id && folder.name === "03_Blank_Forms_Templates")).toBeUndefined();
    expect(folders.some((folder) => folder.parentId === iso?.id && /^\d/.test(folder.name))).toBe(false);
    const rootQuality = folders.find((folder) => folder.parentId === null && folder.name === "Quality");
    expect(folders.find((folder) => folder.parentId === rootQuality?.id && folder.name === "Validation Reports")).toBeUndefined();
  });

  it("starts a fresh copy without changing the blank, and a deleted or renamed shortcut stays that way", async () => {
    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    const folders = tree.body as { id: number; name: string; parentId: number | null; linkedPath: string | null }[];
    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents")!;
    const home = folders.find((folder) => folder.parentId === iso.id && folder.name === "Blank Forms Templates")!;
    const validation = folders.find((folder) => folder.parentId === home.id && folder.name === "Validation")!;
    const csaLeaf = folders.find((folder) => folder.linkedPath === blankTemplateStartPath("frm-val-001"))!;
    const pumpLeaf = folders.find((folder) => folder.linkedPath === blankTemplateStartPath("frm-val-007"))!;
    const before = await request(app).get("/document-folders/form-templates").set("Authorization", `Bearer ${token}`);
    const csa = (before.body.templates as { formKey: string; formId: string; title: string; folderId: number }[]).find((form) => form.formKey === "frm-val-001")!;

    const started = await request(app).post("/validation-reports").set("Authorization", `Bearer ${token}`).send({ data: { formType: "csa", cells: {} } });
    expect(started.status).toBe(201);
    const saved = await request(app)
      .patch(`/validation-reports/${started.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ data: { formType: "csa", cells: { A1: "filled copy" } } });
    expect(saved.status).toBe(200);

    const afterStart = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    const afterFolders = afterStart.body as { id: number; name: string; parentId: number | null; linkedPath: string | null }[];
    const still = afterFolders.find((folder) => folder.id === csaLeaf.id);
    expect(still?.name).toBe(csaLeaf.name);
    expect(still?.linkedPath).toBe(csaLeaf.linkedPath);
    expect(still?.parentId).toBe(validation.id);
    const afterTemplates = await request(app).get("/document-folders/form-templates").set("Authorization", `Bearer ${token}`);
    const csaAfter = (afterTemplates.body.templates as { formKey: string; formId: string; title: string; folderId: number }[]).find((form) => form.formKey === "frm-val-001");
    expect(csaAfter).toMatchObject({ formId: csa.formId, title: csa.title, folderId: csa.folderId });

    const removed = await request(app).delete(`/document-folders/${csaLeaf.id}`).set("Authorization", `Bearer ${token}`);
    expect(removed.status).toBe(204);
    const renamed = await request(app).patch(`/document-folders/${pumpLeaf.id}`).set("Authorization", `Bearer ${token}`).send({ name: "Pump blank renamed" });
    expect(renamed.status).toBe(200);
    const quality = folders.find((folder) => folder.parentId === iso.id && folder.name === "Quality");
    expect(quality).toBeTruthy();
    const moved = await request(app).patch(`/document-folders/${validation.id}`).set("Authorization", `Bearer ${token}`).send({ parentId: quality!.id });
    expect(moved.status).toBe(200);

    const reloaded = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    const next = reloaded.body as { id: number; name: string; parentId: number | null; linkedPath: string | null }[];
    expect(next.find((folder) => folder.linkedPath === blankTemplateStartPath("frm-val-001"))).toBeUndefined();
    expect(next.find((folder) => folder.id === pumpLeaf.id)?.name).toBe("Pump blank renamed");
    expect(next.find((folder) => folder.id === validation.id)?.parentId).toBe(quality!.id);
    expect(next.filter((folder) => folder.linkedPath === blankTemplateStartPath("frm-val-007"))).toHaveLength(1);
    const listed = await request(app).get("/document-folders/form-templates").set("Authorization", `Bearer ${token}`);
    expect((listed.body.templates as { formKey: string }[]).filter((form) => form.formKey === "frm-val-001")).toHaveLength(1);
  });
});