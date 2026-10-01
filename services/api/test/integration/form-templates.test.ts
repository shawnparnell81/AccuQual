import { ensureTestCompany } from "../helpers/company.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, isNull } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { documentFolders } from "../../src/drizzle/schema/documentFolders.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { filedRecordName } from "../../src/modules/document-folders/formFiling.js";

const app = createApp();
const suffix = Date.now();

let token: string;

describe("ISO Compliance Documents form templates", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [user] = await db
      .insert(users)
      .values({ email: `form-templates-${suffix}@test.local`, passwordHash: "unused" })
      .returning();
    token = signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department: "quality" });
    const [quality] = await db.select().from(documentFolders).where(and(isNull(documentFolders.parentId), eq(documentFolders.name, "Quality")));
    if (!quality) await db.insert(documentFolders).values({ name: "Quality", sortOrder: 0 });
  });

  it("files each blank template once under Blank Form Templates and names a filled record from the pattern", async () => {
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
    expect(csa?.formId).toBe("");
    expect(csa?.title).toBe("CSA VALIDATION REPORT");
    expect(pump?.formId).toBe("");
    expect(pump?.title).toBe("FUEL PUMP VALIDATION DOCUMENT");
    expect(csa?.isoPath).toEqual(["Blank Form Templates", "Validation"]);
    expect(pump?.folderId).toBe(csa?.folderId);
    expect(csa?.subjectRoute).toBe("/folders/validation-reports");
    expect(csa?.start).toEqual({ createPath: "/validation-reports", openPath: "/validation-reports/{id}", body: { data: { formType: "csa", cells: {} } } });
    expect(pump?.start).toEqual({ createPath: "/validation-reports", openPath: "/validation-reports/{id}", body: { data: { formType: "fuel_pump", cells: {} } } });
    expect(eightD?.isoPath).toEqual(["Blank Form Templates", "Problem Solving"]);
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
    expect(ncrForm).toBeUndefined();
    expect(equipmentList?.subjectRoute).toBe("/calibration/master-list");
    expect(equipmentList?.isoPath).toEqual(["Blank Form Templates", "Calibration"]);
    expect(documentList?.subjectRoute).toBe("/documents/master-list");
    expect(documentList?.isoPath).toEqual(["Blank Form Templates", "Document Control"]);
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
    expect(ncr?.subjectRoute).toBe("/ncr");
    expect(ncr?.isoPath).toEqual(["Blank Form Templates", "Nonconformance"]);
    expect(training?.isoPath).toEqual(["Blank Form Templates", "Training"]);
    expect(audit?.isoPath).toEqual(["Blank Form Templates", "Audit"]);
    expect(templates.filter((form) => form.formKey === "frm-val-001")).toHaveLength(1);

    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    expect(tree.status).toBe(200);
    const folders = tree.body as { id: number; name: string; parentId: number | null }[];
    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents");
    const blanks = folders.find((folder) => folder.parentId === iso?.id && folder.name === "Blank Form Templates");
    const validation = folders.find((folder) => folder.parentId === blanks?.id && folder.name === "Validation");
    expect(validation?.id).toBe(csa?.folderId);
    expect(folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance")).toBeUndefined();
    expect(folders.find((folder) => folder.parentId === iso?.id && folder.name === "03_Blank_Forms_Templates")).toBeUndefined();
    expect(folders.some((folder) => folder.parentId === iso?.id && /^\d/.test(folder.name))).toBe(false);
    const rootQuality = folders.find((folder) => folder.parentId === null && folder.name === "Quality");
    expect(folders.find((folder) => folder.parentId === rootQuality?.id && folder.name === "Validation Reports")).toBeUndefined();
  });
});