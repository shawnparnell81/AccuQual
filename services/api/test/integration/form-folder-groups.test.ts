import { ensureTestCompany } from "../helpers/company.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { company } from "../../src/drizzle/schema/company.js";
import { documentFolders } from "../../src/drizzle/schema/documentFolders.js";
import { controlledFormTemplates } from "../../src/drizzle/schema/controlledForms.js";
import { formFilings } from "../../src/drizzle/schema/formFilings.js";
import { isoQualityForms } from "../../src/drizzle/schema/isoQualityForms.js";
import { qmsForms } from "../../src/drizzle/schema/qmsForms.js";
import { documentChangeRequests } from "../../src/drizzle/schema/documentChangeRequests.js";
import { changeRequests } from "../../src/drizzle/schema/change.js";
import { validationReports } from "../../src/drizzle/schema/validationReport.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { MAIN_ISO_FOLDER_NAMES } from "../../src/modules/document-folders/mainIsoFolders.js";

const app = createApp();
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

interface FormFolderRow {
  formKey: string;
  formKeys: string[];
  name: string;
  savedCount: number;
}

interface FolderRow {
  id: number;
  name: string;
  parentId: number | null;
}

const OLD_DEPARTMENTS = [
  "SOP",
  "Engineering",
  "Quality",
  "Calibration & Measurement",
  "CAPA",
  "Production",
  "Work Instruction",
  "NCR",
  "Shipping & Receiving",
  "Training",
  "Audits",
  "Material Management",
  "Safety",
];

let qualityToken: string;
let managerToken: string;

describe("form folder groups and department folder edit", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [quality] = await db.insert(users).values({ email: `form-groups-q-${suffix}@test.local`, passwordHash: "unused", name: "Shawn Parnell", department: "quality" }).returning();
    const [manager] = await db.insert(users).values({ email: `form-groups-m-${suffix}@test.local`, passwordHash: "unused", name: "Quinn Manager", department: "quality" }).returning();
    qualityToken = signAccessToken({ sub: String(quality!.id), roleId: null, roleName: "operator", department: "quality" });
    managerToken = signAccessToken({ sub: String(manager!.id), roleId: null, roleName: "quality_manager", department: "quality" });
  });

  it("shows one folder for each live duplicate pair, keeps numbered forms apart, and keeps saved copies", async () => {
    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    expect(tree.status).toBe(200);
    const folders = tree.body as FolderRow[];
    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents");
    expect(iso).toBeTruthy();
    for (const name of MAIN_ISO_FOLDER_NAMES) {
      expect(folders.some((folder) => folder.parentId === iso!.id && folder.name === name)).toBe(true);
    }
    for (const name of OLD_DEPARTMENTS) {
      expect(folders.some((folder) => folder.name === name)).toBe(true);
    }
    const departmentNames = new Set(folders.filter((folder) => folder.parentId === iso!.id).map((folder) => folder.name));
    expect(departmentNames.has("Engineering")).toBe(true);
    expect(departmentNames.has("Engineering Standards")).toBe(true);
    expect(departmentNames.has("Quality")).toBe(true);
    expect(departmentNames.has("Quality Manual")).toBe(true);

    const [shelf] = await db.insert(documentFolders).values({ name: `Filed copies ${suffix}`, parentId: iso!.id, sortOrder: 80 }).returning();
    const savedAt = new Date();
    const [faiForm] = await db.insert(isoQualityForms).values({ formType: "first_article", data: {}, updatedAt: savedAt }).returning();
    const [dcrForm] = await db.insert(isoQualityForms).values({ formType: "document_change", data: {}, updatedAt: savedAt }).returning();
    const [ecrForm] = await db.insert(isoQualityForms).values({ formType: "engineering_change", data: {}, updatedAt: savedAt }).returning();
    const [faiNode] = await db.insert(documentFolders).values({ name: "FAI from the blank", parentId: shelf!.id, linkedPath: `/iso-forms/record/${faiForm!.id}` }).returning();
    const [dcrNode] = await db.insert(documentFolders).values({ name: "DCR from the blank", parentId: shelf!.id, linkedPath: `/iso-forms/record/${dcrForm!.id}` }).returning();
    const [ecrNode] = await db.insert(documentFolders).values({ name: "ECR from the blank", parentId: shelf!.id, linkedPath: `/iso-forms/record/${ecrForm!.id}` }).returning();
    await db.insert(formFilings).values([
      { formKey: "frm-fai-001", recordId: faiForm!.id, folderNodeId: faiNode!.id },
      { formKey: "frm-doc-001", recordId: dcrForm!.id, folderNodeId: dcrNode!.id },
      { formKey: "frm-ecr-001", recordId: ecrForm!.id, folderNodeId: ecrNode!.id },
    ]);
    await db.insert(qmsForms).values({ formType: "first_article_inspection", formNo: "FAI-1", updatedAt: savedAt });
    await db.insert(documentChangeRequests).values({ documentProcessName: "Work instruction", updatedAt: savedAt });
    await db.insert(changeRequests).values({ title: "Engineering Change Request", updatedAt: savedAt });

    const listed = await request(app).get("/document-folders/form-folders").set("Authorization", `Bearer ${qualityToken}`);
    expect(listed.status).toBe(200);
    const rows = listed.body as FormFolderRow[];
    const named = (name: string) => rows.filter((row) => row.name === name);
    expect(named("Document Change Request")).toHaveLength(1);
    expect(named("DOCUMENT CHANGE REQUEST")).toHaveLength(0);
    expect(named("Engineering Change Request")).toHaveLength(1);
    expect(named("ENGINEERING CHANGE REQUEST (ECR)")).toHaveLength(0);
    expect(named("First Article Inspection Report")).toHaveLength(0);
    expect(named("CSA VALIDATION REPORT")).toHaveLength(1);
    expect(rows.some((row) => row.name.includes("first_article_inspection") || row.name.includes("frm-fai-001"))).toBe(false);
    expect(named("AIR STRUT VALIDATION DOCUMENT")).toHaveLength(1);
    expect(named("AIR SPRING VALIDATION DOCUMENT")).toHaveLength(1);
    expect(named("ASTM E542 Gravimetric Volume Calculator (FRM-TST-001)")).toHaveLength(1);
    expect(named("ASTM E542 Gravimetric Volume Calculator (FRM-TST-002)")).toHaveLength(1);

    const dcr = named("Document Change Request")[0]!;
    const ecr = named("Engineering Change Request")[0]!;
    expect(named("CSA VALIDATION REPORT")[0]?.formKeys).toEqual(["frm-val-001"]);
    expect(dcr.formKeys.sort()).toEqual(["dcr", "frm-doc-001"]);
    expect(ecr.formKeys.sort()).toEqual(["ecr", "frm-ecr-001"]);
    expect(dcr.savedCount).toBe(2);
    expect(ecr.savedCount).toBe(2);

    const detail = await request(app).get("/document-folders/form-folders/frm-fai-001").set("Authorization", `Bearer ${qualityToken}`);
    expect(detail.status).toBe(404);

    const deniedRename = await request(app).patch("/document-folders/form-folders/dcr").set("Authorization", `Bearer ${managerToken}`).send({ name: "Change paperwork" });
    expect(deniedRename.status).toBe(403);
    const renamed = await request(app).patch("/document-folders/form-folders/dcr").set("Authorization", `Bearer ${qualityToken}`).send({ name: "Change paperwork" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Change paperwork");
    const empty = await request(app).patch("/document-folders/form-folders/dcr").set("Authorization", `Bearer ${qualityToken}`).send({ name: "   " });
    expect(empty.status).toBe(400);
    const clash = await request(app).patch("/document-folders/form-folders/dcr").set("Authorization", `Bearer ${qualityToken}`).send({ name: "engineering change request" });
    expect(clash.status).toBe(400);
    const afterRename = await request(app).get("/document-folders/form-folders").set("Authorization", `Bearer ${qualityToken}`);
    const paperwork = (afterRename.body as FormFolderRow[]).filter((row) => row.formKeys.includes("dcr"));
    expect(paperwork).toHaveLength(1);
    expect(paperwork[0]?.name).toBe("Change paperwork");
    expect(paperwork[0]?.savedCount).toBe(2);

    const [template] = await db.select({ id: controlledFormTemplates.id }).from(controlledFormTemplates).where(eq(controlledFormTemplates.formKey, renamed.body.formKey as string));
    const history = await request(app).get(`/audit-trail/FormFolder/${template!.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(history.status).toBe(200);
    expect(
      (history.body as { changes?: { event?: string; summary?: string }; performedBy?: number }[]).some(
        (row) => row.changes?.event === "renamed" && row.changes.summary === 'Renamed the folder from "Document Change Request" to "Change paperwork".' && row.performedBy != null,
      ),
    ).toBe(true);
  });

  it("saves a filled form into the folder named for that form, newest first, and still accepts a Documents folder", async () => {
    const [older] = await db.insert(validationReports).values({ data: { formType: "csa", cells: {} }, updatedAt: new Date("2020-01-02T00:00:00.000Z") }).returning();
    const [newer] = await db.insert(validationReports).values({ data: { formType: "csa", cells: { B6: "Lot A" } }, updatedAt: new Date() }).returning();
    const missing = await request(app).post("/document-folders/form-filings").set("Authorization", `Bearer ${qualityToken}`).send({ formKey: "frm-val-001", recordId: older!.id });
    expect(missing.status).toBe(400);

    const first = await request(app)
      .post("/document-folders/form-filings")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ formKey: "frm-val-001", recordId: older!.id, formFolderKey: "frm-val-001" });
    expect(first.status).toBe(201);
    expect(first.body.parentPath).toContain("Saved Form Folders");
    expect(first.body.parentPath).toContain("CSA VALIDATION REPORT");
    await db.update(formFilings).set({ updatedAt: new Date("2020-01-01T00:00:00.000Z") }).where(and(eq(formFilings.formKey, "frm-val-001"), eq(formFilings.recordId, older!.id)));

    const second = await request(app)
      .post("/document-folders/form-filings")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ formKey: "frm-val-001", recordId: newer!.id, formFolderKey: "frm-val-001" });
    expect(second.status).toBe(201);

    const detail = await request(app).get("/document-folders/form-folders/frm-val-001").set("Authorization", `Bearer ${qualityToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.name).toBe("CSA VALIDATION REPORT");
    const fills = detail.body.fills as { recordId: number; fileName: string; savedAt: string }[];
    expect(fills.map((row) => row.recordId).slice(0, 2)).toEqual([newer!.id, older!.id]);
    expect(fills[0]!.savedAt >= fills[1]!.savedAt).toBe(true);

    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    const folders = tree.body as FolderRow[];
    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents")!;
    const documents = folders.find((folder) => folder.parentId === iso.id && folder.name === "Quality");
    expect(documents).toBeTruthy();
    const [third] = await db.insert(validationReports).values({ data: { formType: "csa", cells: { B6: "Docs" } }, updatedAt: new Date() }).returning();
    const moved = await request(app)
      .post("/document-folders/form-filings")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ formKey: "frm-val-001", recordId: third!.id, folderId: documents!.id });
    expect(moved.status).toBe(201);
    expect(moved.body.parentPath).toContain("Quality");
    expect(moved.body.parentPath).not.toContain("Saved Form Folders");

    const after = await request(app).get("/document-folders/form-folders/frm-val-001").set("Authorization", `Bearer ${qualityToken}`);
    expect((after.body.fills as { recordId: number }[])[0]?.recordId).toBe(third!.id);

    const created = await request(app).get(`/audit-trail/DocumentFolder/${first.body.folderNodeId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(created.status).toBe(200);
    expect(
      (created.body as { action?: string; changes?: { event?: string; formKey?: string }; performedBy?: number }[]).some(
        (row) => row.action === "create" && row.changes?.event === "filed" && row.changes.formKey === "frm-val-001" && row.performedBy != null,
      ),
    ).toBe(true);

    const relocated = await request(app)
      .post("/document-folders/form-filings")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ formKey: "frm-val-001", recordId: older!.id, folderId: documents!.id });
    expect(relocated.status).toBe(201);
    const moveLog = await request(app).get(`/audit-trail/DocumentFolder/${first.body.folderNodeId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(
      (moveLog.body as { action?: string; changes?: { event?: string }; performedBy?: number }[]).some(
        (row) => row.action === "update" && row.performedBy != null,
      ),
    ).toBe(true);
  });

  it("renames and deletes an older department folder, and does not put it back", async () => {
    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    const folders = tree.body as FolderRow[];
    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents")!;
    const safety = folders.find((folder) => folder.parentId === iso.id && folder.name === "Safety");
    expect(safety).toBeTruthy();
    const material = folders.find((folder) => folder.name === "Material Management");
    expect(material).toBeTruthy();

    const denied = await request(app).patch(`/document-folders/${safety!.id}`).set("Authorization", `Bearer ${managerToken}`).send({ name: "Plant Safety" });
    expect(denied.status).toBe(403);
    const renamed = await request(app).patch(`/document-folders/${safety!.id}`).set("Authorization", `Bearer ${qualityToken}`).send({ name: "Plant Safety" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Plant Safety");
    const blank = await request(app).patch(`/document-folders/${safety!.id}`).set("Authorization", `Bearer ${qualityToken}`).send({ name: " " });
    expect(blank.status).toBe(400);
    const sibling = await request(app).patch(`/document-folders/${safety!.id}`).set("Authorization", `Bearer ${qualityToken}`).send({ name: "training" });
    expect(sibling.status).toBe(400);

    const renameHistory = await request(app).get(`/audit-trail/DocumentFolder/${safety!.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(renameHistory.status).toBe(200);
    expect((renameHistory.body as { changes?: { event?: string; from?: string; to?: string }; performedBy?: number }[]).some((row) => row.changes?.event === "renamed" && row.changes.from === "Safety" && row.changes.to === "Plant Safety" && row.performedBy != null)).toBe(true);

    const child = folders.find((folder) => folder.parentId === safety!.id);
    const removed = await request(app).post(`/document-folders/${safety!.id}/retire`).set("Authorization", `Bearer ${qualityToken}`).send({ destinationId: iso.id });
    expect(removed.status).toBe(204);
    const deniedDelete = await request(app).post(`/document-folders/${material!.id}/retire`).set("Authorization", `Bearer ${managerToken}`).send({});
    expect(deniedDelete.status).toBe(403);

    const [co] = await db.select({ id: company.id, profile: company.profile }).from(company);
    const profile = { ...(co!.profile ?? {}) };
    delete profile.isoMainFoldersReady;
    await db.update(company).set({ profile }).where(eq(company.id, co!.id));

    const again = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    const next = again.body as FolderRow[];
    expect(next.some((folder) => folder.name === "Safety" || folder.name === "Plant Safety")).toBe(false);
    if (child) expect(next.find((folder) => folder.id === child.id)?.parentId).toBe(iso.id);
    for (const name of OLD_DEPARTMENTS) {
      if (name === "Safety") continue;
      expect(next.some((folder) => folder.name === name)).toBe(true);
    }
    for (const name of MAIN_ISO_FOLDER_NAMES) {
      expect(next.some((folder) => folder.parentId === iso.id && folder.name === name)).toBe(true);
    }
  });
});
