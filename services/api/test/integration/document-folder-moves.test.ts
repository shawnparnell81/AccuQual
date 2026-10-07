import { ensureTestCompany } from "../helpers/company.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { company } from "../../src/drizzle/schema/company.js";
import { documentFolders } from "../../src/drizzle/schema/documentFolders.js";
import { formFilings } from "../../src/drizzle/schema/formFilings.js";
import { isoQualityForms } from "../../src/drizzle/schema/isoQualityForms.js";
import { permissionRoleModules, permissionRoles, userPermissionRoles } from "../../src/drizzle/schema/permissions.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { MAIN_ISO_FOLDER_NAMES } from "../../src/modules/document-folders/mainIsoFolders.js";

const app = createApp();
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

interface FolderRow {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  linkedPath: string | null;
}

let qualityToken: string;
let qualityUserId: number;
let productionToken: string;
let grantedToken: string;

function childNamed(folders: FolderRow[], parentId: number, name: string): FolderRow | undefined {
  return folders.filter((folder) => folder.parentId === parentId && folder.name === name).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)[0];
}

describe("ISO main folders and moving what is already filed", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [quality] = await db.insert(users).values({ email: `iso-folders-q-${suffix}@test.local`, passwordHash: "unused", name: "Shawn Parnell", department: "quality" }).returning();
    const [production] = await db.insert(users).values({ email: `iso-folders-p-${suffix}@test.local`, passwordHash: "unused", name: "Pat Reader", department: "production" }).returning();
    const [granted] = await db.insert(users).values({ email: `iso-folders-g-${suffix}@test.local`, passwordHash: "unused", name: "Pat Editor", department: "production" }).returning();
    qualityUserId = quality!.id;
    qualityToken = signAccessToken({ sub: String(quality!.id), roleId: null, roleName: "operator", department: "quality" });
    productionToken = signAccessToken({ sub: String(production!.id), roleId: null, roleName: "operator", department: "production" });
    const [role] = await db.insert(permissionRoles).values({ roleName: `Folder clerk ${suffix}`, description: "Files documents" }).returning();
    await db.insert(permissionRoleModules).values({ roleId: role!.id, moduleName: "documents", accessLevel: "edit" });
    await db.insert(userPermissionRoles).values({ userId: granted!.id, roleId: role!.id });
    grantedToken = signAccessToken({ sub: String(granted!.id), roleId: null, roleName: "operator", department: "production" });
  });

  it("creates the 14 drawers once, in order, and a second load does not duplicate or reorder them", async () => {
    const first = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    expect(first.status).toBe(200);
    const folders = first.body as FolderRow[];
    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents");
    expect(iso).toBeTruthy();
    const children = folders.filter((folder) => folder.parentId === iso!.id).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    expect(children.slice(0, MAIN_ISO_FOLDER_NAMES.length).map((folder) => folder.name)).toEqual([...MAIN_ISO_FOLDER_NAMES]);
    for (const name of MAIN_ISO_FOLDER_NAMES) {
      expect(folders.filter((folder) => folder.parentId === iso!.id && folder.name === name)).toHaveLength(1);
    }
    const nestedStandards = folders.filter((folder) => folder.name === "Engineering Standards" && folder.parentId !== iso!.id);
    expect(nestedStandards.length).toBeGreaterThan(0);
    expect(children.some((folder) => folder.name === "Quality")).toBe(true);
    expect(children.some((folder) => folder.name === "Blank Form Templates")).toBe(true);

    const master = childNamed(folders, iso!.id, "Master Source Files");
    const reordered = await request(app).patch(`/document-folders/${master!.id}`).set("Authorization", `Bearer ${qualityToken}`).send({ sortOrder: 40 });
    expect(reordered.status).toBe(200);

    const second = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    const again = second.body as FolderRow[];
    const isoAgain = again.find((folder) => folder.id === iso!.id);
    expect(again.filter((folder) => folder.parentId === isoAgain!.id && folder.name === "Master Source Files")).toHaveLength(1);
    expect(again.find((folder) => folder.id === master!.id)?.sortOrder).toBe(40);
    for (const name of MAIN_ISO_FOLDER_NAMES) {
      expect(again.filter((folder) => folder.parentId === isoAgain!.id && folder.name === name)).toHaveLength(1);
    }
  });

  it("moves a folder with its subtree, blocks a move into a descendant, and keeps a saved form's revision and link", async () => {
    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    const folders = tree.body as FolderRow[];
    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents")!;
    const quality = childNamed(folders, iso.id, "Quality")!;
    const fai = childNamed(folders, quality.id, "FAI / Validation")!;
    const csa = childNamed(folders, fai.id, "CSA")!;
    const master = childNamed(folders, iso.id, "Master Source Files")!;
    const logs = childNamed(folders, iso.id, "Quality Logs")!;
    const equipment = childNamed(folders, iso.id, "Equipment Records")!;

    const moved = await request(app).patch(`/document-folders/${quality.id}`).set("Authorization", `Bearer ${qualityToken}`).send({ parentId: master.id });
    expect(moved.status).toBe(200);
    expect(moved.body.parentId).toBe(master.id);

    const after = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    const next = after.body as FolderRow[];
    expect(next.find((folder) => folder.id === quality.id)?.parentId).toBe(master.id);
    expect(next.find((folder) => folder.id === fai.id)?.parentId).toBe(quality.id);
    expect(next.find((folder) => folder.id === csa.id)?.parentId).toBe(fai.id);

    const cycle = await request(app).patch(`/document-folders/${master.id}`).set("Authorization", `Bearer ${qualityToken}`).send({ parentId: csa.id });
    expect(cycle.status).toBe(400);

    const stamp = { version: 4, revision: "C", structureHash: "keep-me" };
    const [record] = await db
      .insert(isoQualityForms)
      .values({ formType: "ncr_report", data: { cells: { B8: "Cracked housing" }, _formTemplate: stamp } })
      .returning();
    const filed = await request(app)
      .post("/document-folders/form-filings")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ formKey: "frm-ncr-001", recordId: record!.id, folderId: logs.id });
    expect(filed.status).toBe(201);
    const nodeId = filed.body.folderNodeId as number;
    const beforeNode = next.find((folder) => folder.id === nodeId) ?? (await db.select().from(documentFolders).where(eq(documentFolders.id, nodeId)))[0];
    const linkedPath = beforeNode && "linkedPath" in beforeNode ? beforeNode.linkedPath : null;

    const itemMove = await request(app).patch(`/document-folders/${nodeId}`).set("Authorization", `Bearer ${qualityToken}`).send({ parentId: equipment.id });
    expect(itemMove.status).toBe(200);
    expect(itemMove.body.parentId).toBe(equipment.id);
    expect(itemMove.body.linkedPath).toBe(linkedPath);

    const [form] = await db.select().from(isoQualityForms).where(eq(isoQualityForms.id, record!.id));
    expect(form?.data).toMatchObject({ _formTemplate: stamp, cells: { B8: "Cracked housing" } });
    const [filing] = await db.select().from(formFilings).where(eq(formFilings.folderNodeId, nodeId));
    expect(filing?.folderNodeId).toBe(nodeId);
    expect(filing?.formNumber).toBe(filed.body.formNumber);

    const open = await request(app).get(`/document-folders/form-filings?formKey=frm-ncr-001&recordId=${record!.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(open.status).toBe(200);
    expect(open.body.parentId).toBe(equipment.id);
    expect(open.body.parentPath).toContain("Equipment Records");
    expect(open.body.folderNodeId).toBe(nodeId);

    const history = await request(app).get(`/audit-trail/DocumentFolder/${quality.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(history.status).toBe(200);
    const move = (history.body as { action: string; performedByName?: string; changes?: { summary?: string; event?: string } }[]).find((row) => row.changes?.event === "moved");
    expect(move?.performedByName).toContain("Shawn Parnell");
    expect(move?.changes?.summary).toMatch(/Moved the folder "Quality" from ISO Compliance Documents → ISO Compliance Documents \/ Master Source Files/);

    const itemHistory = await request(app).get(`/audit-trail/DocumentFolder/${nodeId}`).set("Authorization", `Bearer ${qualityToken}`);
    const itemRow = (itemHistory.body as { changes?: { summary?: string; event?: string } }[]).find((row) => row.changes?.event === "moved");
    expect(itemRow?.changes?.summary).toMatch(/Moved the saved item .+ from ISO Compliance Documents \/ Quality Logs → ISO Compliance Documents \/ Equipment Records/);
    expect(qualityUserId).toBeGreaterThan(0);
  });

  it("lets Document Control edit move a folder and refuses a department that only has read", async () => {
    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    const folders = tree.body as FolderRow[];
    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents")!;
    const archive = childNamed(folders, iso.id, "Obsolete Archive")!;
    const personnel = childNamed(folders, iso.id, "Personnel Files")!;

    const denied = await request(app).patch(`/document-folders/${personnel.id}`).set("Authorization", `Bearer ${productionToken}`).send({ parentId: archive.id });
    expect(denied.status).toBe(403);
    const deniedCreate = await request(app).post("/document-folders").set("Authorization", `Bearer ${productionToken}`).send({ name: "Should not exist", parentId: iso.id });
    expect(deniedCreate.status).toBe(403);
    const deniedRename = await request(app).patch(`/document-folders/${personnel.id}`).set("Authorization", `Bearer ${productionToken}`).send({ name: "Renamed by a reader" });
    expect(deniedRename.status).toBe(403);

    const allowed = await request(app).patch(`/document-folders/${personnel.id}`).set("Authorization", `Bearer ${grantedToken}`).send({ parentId: archive.id });
    expect(allowed.status).toBe(200);
    expect(allowed.body.parentId).toBe(archive.id);
    const still = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    expect((still.body as FolderRow[]).find((folder) => folder.id === personnel.id)?.parentId).toBe(archive.id);
    expect((still.body as FolderRow[]).some((folder) => folder.name === "Should not exist")).toBe(false);
    expect((still.body as FolderRow[]).find((folder) => folder.id === personnel.id)?.name).toBe("Personnel Files");
  });

  it("keeps a deleted main folder deleted, and still refuses to delete one that is not empty", async () => {
    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    const folders = tree.body as FolderRow[];
    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents")!;
    const facility = childNamed(folders, iso.id, "Facility Records");
    const logs = childNamed(folders, iso.id, "Engineering Logs");
    const qualityFolder = folders.find((folder) => folder.name === "Quality" && folders.some((child) => child.parentId === folder.id));
    expect(facility).toBeTruthy();
    expect(logs).toBeTruthy();
    expect(qualityFolder).toBeTruthy();

    const blocked = await request(app).delete(`/document-folders/${qualityFolder!.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(blocked.status).toBe(400);

    const denied = await request(app).delete(`/document-folders/${facility!.id}`).set("Authorization", `Bearer ${productionToken}`);
    expect(denied.status).toBe(403);

    const removed = await request(app).delete(`/document-folders/${facility!.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(removed.status).toBe(204);
    const history = await request(app).get(`/audit-trail/DocumentFolder/${facility!.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(history.status).toBe(200);
    expect((history.body as { action?: string; changes?: { name?: string } }[]).some((row) => row.action === "delete" && row.changes?.name === "Facility Records")).toBe(true);

    const renamed = await request(app).patch(`/document-folders/${logs!.id}`).set("Authorization", `Bearer ${qualityToken}`).send({ name: "Shop Log" });
    expect(renamed.status).toBe(200);

    const [co] = await db.select({ id: company.id, profile: company.profile }).from(company);
    const profile = { ...(co!.profile ?? {}) };
    delete profile.isoMainFoldersReady;
    await db.update(company).set({ profile }).where(eq(company.id, co!.id));

    const again = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    expect(again.status).toBe(200);
    const next = again.body as FolderRow[];
    expect(next.some((folder) => folder.name === "Facility Records")).toBe(false);
    expect(next.some((folder) => folder.parentId === iso.id && folder.name === "Engineering Logs")).toBe(false);
    expect(next.find((folder) => folder.id === logs!.id)?.name).toBe("Shop Log");
    expect(next.find((folder) => folder.id === qualityFolder!.id)).toBeTruthy();
    expect(next.filter((folder) => folder.parentId === iso.id && folder.name === "Master Source Files")).toHaveLength(1);
    expect(next.find((folder) => folder.name === "Master Source Files")?.sortOrder).toBe(40);
    for (const name of MAIN_ISO_FOLDER_NAMES) {
      if (name === "Facility Records" || name === "Engineering Logs" || name === "Personnel Files") continue;
      expect(next.filter((folder) => folder.parentId === iso.id && folder.name === name)).toHaveLength(1);
    }

    const recreated = await request(app).post("/document-folders").set("Authorization", `Bearer ${qualityToken}`).send({ name: "Facility Records", parentId: iso.id });
    expect(recreated.status).toBe(201);
    const withCopy = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    expect((withCopy.body as FolderRow[]).filter((folder) => folder.parentId === iso.id && folder.name === "Facility Records")).toHaveLength(1);

    const removedAgain = await request(app).delete(`/document-folders/${recreated.body.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(removedAgain.status).toBe(204);
    const gone = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    expect((gone.body as FolderRow[]).some((folder) => folder.name === "Facility Records")).toBe(false);

    const [marked] = await db.select({ profile: company.profile }).from(company);
    expect(marked?.profile?.isoMainFoldersReady).toBe(true);
  });
});
