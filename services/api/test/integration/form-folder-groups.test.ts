import { ensureTestCompany } from "../helpers/company.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { company } from "../../src/drizzle/schema/company.js";
import { documentFolders } from "../../src/drizzle/schema/documentFolders.js";
import { controlledFormTemplates } from "../../src/drizzle/schema/controlledForms.js";
import { formFilings } from "../../src/drizzle/schema/formFilings.js";
import { qmsForms } from "../../src/drizzle/schema/qmsForms.js";
import { documentChangeRequests } from "../../src/drizzle/schema/documentChangeRequests.js";
import { changeRequests } from "../../src/drizzle/schema/change.js";
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
    const [faiNode] = await db.insert(documentFolders).values({ name: "FAI from the blank", parentId: shelf!.id, linkedPath: "/iso-forms/record/41" }).returning();
    const [dcrNode] = await db.insert(documentFolders).values({ name: "DCR from the blank", parentId: shelf!.id, linkedPath: "/iso-forms/record/42" }).returning();
    const [ecrNode] = await db.insert(documentFolders).values({ name: "ECR from the blank", parentId: shelf!.id, linkedPath: "/iso-forms/record/43" }).returning();
    await db.insert(formFilings).values([
      { formKey: "frm-fai-001", recordId: 41, folderNodeId: faiNode!.id },
      { formKey: "frm-doc-001", recordId: 42, folderNodeId: dcrNode!.id },
      { formKey: "frm-ecr-001", recordId: 43, folderNodeId: ecrNode!.id },
    ]);
    await db.insert(qmsForms).values({ formType: "first_article_inspection", formNo: "FAI-1" });
    await db.insert(documentChangeRequests).values({ documentProcessName: "Work instruction" });
    await db.insert(changeRequests).values({ title: "Engineering Change Request" });

    const listed = await request(app).get("/document-folders/form-folders").set("Authorization", `Bearer ${qualityToken}`);
    expect(listed.status).toBe(200);
    const rows = listed.body as FormFolderRow[];
    const named = (name: string) => rows.filter((row) => row.name === name);
    expect(named("Document Change Request")).toHaveLength(1);
    expect(named("DOCUMENT CHANGE REQUEST")).toHaveLength(0);
    expect(named("Engineering Change Request")).toHaveLength(1);
    expect(named("ENGINEERING CHANGE REQUEST (ECR)")).toHaveLength(0);
    expect(named("First Article Inspection Report")).toHaveLength(1);
    expect(rows.some((row) => row.name.includes("first_article_inspection") || row.name.includes("frm-fai-001"))).toBe(false);
    expect(named("AIR STRUT VALIDATION DOCUMENT (FRM-VAL-010)")).toHaveLength(1);
    expect(named("AIR STRUT VALIDATION DOCUMENT (FRM-VAL-011)")).toHaveLength(1);
    expect(named("ASTM E542 Gravimetric Volume Calculator (FRM-TST-001)")).toHaveLength(1);
    expect(named("ASTM E542 Gravimetric Volume Calculator (FRM-TST-002)")).toHaveLength(1);

    const fai = named("First Article Inspection Report")[0]!;
    const dcr = named("Document Change Request")[0]!;
    const ecr = named("Engineering Change Request")[0]!;
    expect(fai.formKeys.sort()).toEqual(["first_article_inspection", "frm-fai-001"]);
    expect(dcr.formKeys.sort()).toEqual(["dcr", "frm-doc-001"]);
    expect(ecr.formKeys.sort()).toEqual(["ecr", "frm-ecr-001"]);
    expect(fai.savedCount).toBe(2);
    expect(dcr.savedCount).toBe(2);
    expect(ecr.savedCount).toBe(2);

    const detail = await request(app).get("/document-folders/form-folders/frm-fai-001").set("Authorization", `Bearer ${qualityToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.name).toBe("First Article Inspection Report");
    expect(detail.body.fills).toHaveLength(2);

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
