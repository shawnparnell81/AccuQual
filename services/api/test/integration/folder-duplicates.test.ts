import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

interface FolderRow {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  linkedPath: string | null;
  pdfPath: string | null;
  documentId: number | null;
}

let qualityToken: string;
let productionToken: string;

function childNamed(folders: FolderRow[], parentId: number | null, name: string): FolderRow | undefined {
  return folders.filter((folder) => folder.parentId === parentId && folder.name === name).sort((a, b) => a.id - b.id)[0];
}

async function tree(): Promise<FolderRow[]> {
  const response = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
  expect(response.status).toBe(200);
  return response.body as FolderRow[];
}

async function clearMergeFlag() {
  const [row] = await db.select({ id: company.id, profile: company.profile }).from(company);
  const profile = { ...(row?.profile ?? {}) };
  delete profile.duplicateFoldersMerged;
  delete profile.folderNamesUnified;
  await db.update(company).set({ profile }).where(eq(company.id, row!.id));
}

function inLegacyDrawer(folders: FolderRow[], folder: FolderRow): boolean {
  const byId = new Map(folders.map((row) => [row.id, row]));
  let current: FolderRow | undefined = folder;
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.name === "Blank Form Templates") return true;
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return false;
}

describe("one folder in one place, and library pool moves", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [quality] = await db.insert(users).values({ email: `folder-once-q-${suffix}@test.local`, passwordHash: "unused", name: "Shawn Parnell", department: "quality" }).returning();
    const [production] = await db.insert(users).values({ email: `folder-once-p-${suffix}@test.local`, passwordHash: "unused", name: "Pat Reader", department: "production" }).returning();
    qualityToken = signAccessToken({ sub: String(quality!.id), roleId: null, roleName: "operator", department: "quality" });
    productionToken = signAccessToken({ sub: String(production!.id), roleId: null, roleName: "operator", department: "production" });
  });

  it("gives each seeded folder one home, folds a nested Quality Manual into the main drawer, and does not bring back a deleted main folder", async () => {
    await clearMergeFlag();
    const first = await tree();
    const iso = first.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents")!;
    const quality = childNamed(first, iso.id, "Quality")!;
    const manual = childNamed(first, iso.id, "Quality Manual")!;
    const standards = childNamed(first, iso.id, "Engineering Standards")!;
    const procedures = childNamed(first, iso.id, "Procedures")!;
    expect(manual).toBeTruthy();
    expect(standards).toBeTruthy();
    expect(procedures).toBeTruthy();

    const filingNames = new Map<string, number>();
    for (const folder of first) {
      if (inLegacyDrawer(first, folder)) continue;
      if (folder.pdfPath || folder.documentId || folder.linkedPath) continue;
      filingNames.set(folder.name, (filingNames.get(folder.name) ?? 0) + 1);
    }
    const repeated = [...filingNames.entries()].filter(([, count]) => count > 1).map(([name]) => name);
    expect(repeated).toEqual([]);

    const policies = first.find((folder) => folder.name === "Quality Manual & Policies" && folder.parentId === quality.id)!;
    await clearMergeFlag();
    const [nestedManual] = await db.insert(documentFolders).values({ name: "Quality Manual", parentId: policies.id, sortOrder: 0 }).returning();
    const [scopeNotes] = await db.insert(documentFolders).values({ name: "Scope notes", parentId: nestedManual!.id, sortOrder: 0, linkedPath: "/documents/master-list" }).returning();
    const [onlyChild] = await db.insert(documentFolders).values({ name: "Empty shelf", parentId: quality.id, sortOrder: 90 }).returning();
    const [nestedProcedures] = await db.insert(documentFolders).values({ name: "Procedures", parentId: onlyChild!.id, sortOrder: 0 }).returning();

    const [copy] = await db.insert(documentFolders).values({ name: "Quality", parentId: iso.id, sortOrder: 80 }).returning();
    const [kept] = await db.insert(documentFolders).values({ name: "Kept notes", parentId: copy!.id, sortOrder: 0 }).returning();

    const merged = await tree();
    const qualities = merged.filter((folder) => folder.name === "Quality" && folder.parentId === iso.id);
    expect(qualities).toHaveLength(1);
    expect(qualities[0]?.id).toBe(quality.id);
    expect(merged.find((folder) => folder.id === kept!.id)?.parentId).toBe(quality.id);
    expect(merged.some((folder) => folder.id === copy!.id)).toBe(false);
    const manuals = merged.filter((folder) => folder.name === "Quality Manual" && !inLegacyDrawer(merged, folder));
    expect(manuals).toHaveLength(1);
    expect(manuals[0]?.id).toBe(manual.id);
    expect(merged.find((folder) => folder.id === scopeNotes!.id)?.parentId).toBe(manual.id);
    expect(merged.find((folder) => folder.id === scopeNotes!.id)?.linkedPath).toBe("/documents/master-list");
    expect(merged.some((folder) => folder.id === nestedManual!.id)).toBe(false);
    expect(merged.filter((folder) => folder.name === "Procedures" && !inLegacyDrawer(merged, folder))).toHaveLength(1);
    expect(merged.find((folder) => folder.name === "Procedures")?.id).toBe(procedures.id);
    expect(merged.some((folder) => folder.id === nestedProcedures!.id || folder.id === onlyChild!.id)).toBe(false);
    expect(merged.some((folder) => folder.id === policies.id)).toBe(true);

    const history = await request(app).get(`/audit-trail/DocumentFolder/${manual.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(history.status).toBe(200);
    const line = (history.body as { performedByName?: string; changes?: { summary?: string; event?: string } }[]).find((row) => row.changes?.event === "merged" && row.changes?.summary?.includes("Quality Manual"));
    expect(line?.performedByName).toContain("Shawn Parnell");
    expect(line?.changes?.summary).toMatch(/Merged the duplicate folder "Quality Manual" from .+ → .+/);

    const [extra] = await db.insert(documentFolders).values({ name: "Notes", parentId: quality.id, sortOrder: 3 }).returning();
    const [extraAgain] = await db.insert(documentFolders).values({ name: "Notes", parentId: quality.id, sortOrder: 4 }).returning();
    const again = await tree();
    expect(again.filter((folder) => folder.parentId === quality.id && folder.name === "Notes").map((folder) => folder.id).sort()).toEqual([extra!.id, extraAgain!.id].sort());

    const facility = childNamed(again, iso.id, "Facility Records")!;
    const removed = await request(app).delete(`/document-folders/${facility.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(removed.status).toBe(204);
    const afterDelete = await tree();
    expect(afterDelete.some((folder) => folder.name === "Facility Records")).toBe(false);
  });

  it("moves a library pool item, a saved form, and a folder into Quality Manual, and blocks a move into a descendant", async () => {
    const folders = await tree();
    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents")!;
    const manual = childNamed(folders, iso.id, "Quality Manual")!;
    const pool = folders.find((folder) => folder.parentId === null && folder.name === "Library Pool")!;
    const logs = childNamed(folders, iso.id, "Quality Logs")!;
    const [pooled] = await db.insert(documentFolders).values({ name: "Pool spec", parentId: pool.id, linkedPath: "/validation-reports/41", sortOrder: 0 }).returning();
    const [saved] = await db.insert(documentFolders).values({ name: "FRM-NCR-001 saved", parentId: logs.id, linkedPath: "/iso-forms/record/41", sortOrder: 0 }).returning();

    const movedPool = await request(app).patch(`/document-folders/${pooled!.id}`).set("Authorization", `Bearer ${qualityToken}`).send({ parentId: manual.id });
    expect(movedPool.status).toBe(200);
    expect(movedPool.body.parentId).toBe(manual.id);
    expect(movedPool.body.linkedPath).toBe("/validation-reports/41");

    const movedForm = await request(app).patch(`/document-folders/${saved!.id}`).set("Authorization", `Bearer ${qualityToken}`).send({ parentId: manual.id });
    expect(movedForm.status).toBe(200);
    expect(movedForm.body.parentId).toBe(manual.id);

    const movedFolder = await request(app).patch(`/document-folders/${logs.id}`).set("Authorization", `Bearer ${qualityToken}`).send({ parentId: manual.id });
    expect(movedFolder.status).toBe(200);
    expect(movedFolder.body.parentId).toBe(manual.id);

    const cycle = await request(app).patch(`/document-folders/${iso.id}`).set("Authorization", `Bearer ${qualityToken}`).send({ parentId: manual.id });
    expect(cycle.status).toBe(400);

    const after = await tree();
    expect(after.find((folder) => folder.id === pooled!.id)?.parentId).toBe(manual.id);
    expect(after.some((folder) => folder.parentId === pool.id && folder.id === pooled!.id)).toBe(false);
    expect(after.find((folder) => folder.id === saved!.id)?.parentId).toBe(manual.id);
    expect(after.find((folder) => folder.id === logs.id)?.parentId).toBe(manual.id);
  });

  it("removes a linked pool item without deleting the record, and deletes an upload that exists only in the pool", async () => {
    const folders = await tree();
    const pool = folders.find((folder) => folder.parentId === null && folder.name === "Library Pool")!;
    const [linked] = await db.insert(documentFolders).values({ name: "Linked report", parentId: pool.id, linkedPath: "/validation-reports/88", sortOrder: 1 }).returning();
    const dir = await mkdtemp(path.join(tmpdir(), "accuqual-pool-"));
    const filePath = path.join(dir, "orphan.pdf");
    await writeFile(filePath, "%PDF-1.4 orphan");
    const [orphan] = await db.insert(documentFolders).values({ name: "Orphan upload", parentId: pool.id, pdfPath: filePath, pdfMimeType: "application/pdf", sortOrder: 2 }).returning();

    const denied = await request(app).delete(`/document-folders/${linked!.id}/pool`).set("Authorization", `Bearer ${productionToken}`);
    expect(denied.status).toBe(403);

    const unassigned = await request(app).delete(`/document-folders/${linked!.id}/pool`).set("Authorization", `Bearer ${qualityToken}`);
    expect(unassigned.status).toBe(204);
    const deletedUpload = await request(app).delete(`/document-folders/${orphan!.id}/pool`).set("Authorization", `Bearer ${qualityToken}`);
    expect(deletedUpload.status).toBe(204);

    const after = await tree();
    expect(after.some((folder) => folder.id === linked!.id || folder.id === orphan!.id)).toBe(false);

    const linkedHistory = await request(app).get(`/audit-trail/DocumentFolder/${linked!.id}`).set("Authorization", `Bearer ${qualityToken}`);
    const linkedLine = (linkedHistory.body as { performedByName?: string; changes?: { summary?: string; keptRecord?: boolean } }[]).find((row) => row.changes?.keptRecord === true);
    expect(linkedLine?.performedByName).toContain("Shawn Parnell");
    expect(linkedLine?.changes?.summary).toMatch(/^Deleted "Linked report" from the Library Pool\./);
    expect(linkedLine?.changes?.summary).toMatch(/left in place/);
    const orphanHistory = await request(app).get(`/audit-trail/DocumentFolder/${orphan!.id}`).set("Authorization", `Bearer ${qualityToken}`);
    const orphanLine = (orphanHistory.body as { performedByName?: string; changes?: { summary?: string; keptRecord?: boolean } }[]).find((row) => row.changes?.keptRecord === false);
    expect(orphanLine?.performedByName).toContain("Shawn Parnell");
    expect(orphanLine?.changes?.summary).toMatch(/^Deleted the uploaded file "Orphan upload" from the Library Pool\./);
  });

  it("does not recreate a deleted main folder, and folds a second nested copy into the one that is left", async () => {
    const before = await tree();
    const iso = before.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents")!;
    const standards = childNamed(before, iso.id, "Engineering Standards")!;
    const removed = await request(app).delete(`/document-folders/${standards.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(removed.status).toBe(204);

    const quality = childNamed(before, iso.id, "Quality")!;
    const engineering = childNamed(before, iso.id, "Engineering")!;
    const specs = childNamed(before, engineering.id, "Specifications & Standards");
    const parentId = specs?.id ?? engineering.id;
    await clearMergeFlag();
    const [keptHome] = await db.insert(documentFolders).values({ name: "Engineering Standards", parentId, sortOrder: 0 }).returning();
    const [drawing] = await db.insert(documentFolders).values({ name: "GD&T note", parentId: keptHome!.id, sortOrder: 0 }).returning();
    const [extraHome] = await db.insert(documentFolders).values({ name: "Engineering Standards", parentId: quality.id, sortOrder: 0 }).returning();

    const after = await tree();
    const homes = after.filter((folder) => folder.name === "Engineering Standards");
    expect(homes).toHaveLength(1);
    expect(homes[0]?.parentId).not.toBe(iso.id);
    expect(homes[0]?.id).toBe(keptHome!.id);
    expect(after.find((folder) => folder.id === drawing!.id)?.parentId).toBe(keptHome!.id);
    expect(after.some((folder) => folder.id === extraHome!.id || folder.id === standards.id)).toBe(false);
    expect(after.some((folder) => folder.parentId === iso.id && folder.name === "Engineering Standards")).toBe(false);
  });

  it("renames a clashing blank topic, puts blanks back after an earlier fold, and then leaves a later move or rename alone", async () => {
    await clearMergeFlag();
    const opened = await tree();
    const iso = opened.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents")!;
    const shelf = childNamed(opened, iso.id, "Blank Forms Templates")!;
    const engineering = childNamed(opened, iso.id, "Engineering")!;
    const forms = childNamed(opened, shelf.id, "Engineering Forms");
    expect(forms).toBeTruthy();
    expect(childNamed(opened, shelf.id, "Engineering")).toBeUndefined();
    expect(childNamed(opened, shelf.id, "Training Forms")).toBeTruthy();
    expect(childNamed(opened, shelf.id, "Document Control Forms")).toBeTruthy();
    expect(childNamed(opened, shelf.id, "Validation")?.name).toBe("Validation");
    const shortcuts = opened.filter((folder) => folder.parentId === forms!.id && folder.linkedPath?.startsWith("/blank-forms/start/"));
    expect(shortcuts.length).toBeGreaterThan(0);
    expect(opened.filter((folder) => folder.linkedPath?.startsWith("/blank-forms/start/")).every((folder) => {
      const byId = new Map(opened.map((row) => [row.id, row]));
      let current: FolderRow | undefined = folder;
      const seen = new Set<number>();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        if (current.id === shelf.id) return true;
        current = current.parentId == null ? undefined : byId.get(current.parentId);
      }
      return false;
    })).toBe(true);

    await clearMergeFlag();
    await db.update(documentFolders).set({ name: "Engineering" }).where(eq(documentFolders.id, forms!.id));
    const renamed = await tree();
    const shelfAfter = childNamed(renamed, iso.id, "Blank Forms Templates")!;
    expect(childNamed(renamed, shelfAfter.id, "Engineering")).toBeUndefined();
    expect(childNamed(renamed, shelfAfter.id, "Engineering Forms")?.id).toBe(forms!.id);
    expect(childNamed(renamed, iso.id, "Engineering")?.id).toBe(engineering.id);
    const history = await request(app).get(`/audit-trail/DocumentFolder/${forms!.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(history.status).toBe(200);
    const line = (history.body as { changes?: { summary?: string; event?: string } }[]).find((row) => row.changes?.event === "renamed" && row.changes.summary?.includes("Engineering Forms"));
    expect(line?.changes?.summary).toBe('Renamed the folder from "ISO Compliance Documents / Blank Forms Templates / Engineering" to "ISO Compliance Documents / Blank Forms Templates / Engineering Forms".');

    const engineeringForms = childNamed(renamed, shelfAfter.id, "Engineering Forms")!;
    const movedOut = renamed.filter((folder) => folder.parentId === engineeringForms.id && folder.linkedPath?.startsWith("/blank-forms/start/"));
    expect(movedOut.length).toBeGreaterThan(0);
    for (const shortcut of movedOut) {
      await db.update(documentFolders).set({ parentId: engineering.id }).where(eq(documentFolders.id, shortcut.id));
    }
    await db.update(controlledFormTemplates).set({ folderId: engineering.id }).where(eq(controlledFormTemplates.folderId, engineeringForms.id));
    await db.delete(documentFolders).where(eq(documentFolders.id, engineeringForms.id));
    const [flagged] = await db.select({ profile: company.profile }).from(company);
    expect(flagged?.profile?.folderNamesUnified).toBe(true);

    const restored = await tree();
    const shelfRestored = childNamed(restored, iso.id, "Blank Forms Templates")!;
    const home = childNamed(restored, shelfRestored.id, "Engineering Forms");
    expect(home).toBeTruthy();
    expect(childNamed(restored, iso.id, "Engineering")?.id).toBe(engineering.id);
    for (const shortcut of movedOut) {
      expect(restored.find((folder) => folder.id === shortcut.id)?.parentId).toBe(home!.id);
    }
    const moveHistory = await request(app).get(`/audit-trail/DocumentFolder/${movedOut[0]!.id}`).set("Authorization", `Bearer ${qualityToken}`);
    const moveLine = (moveHistory.body as { changes?: { summary?: string; event?: string } }[]).find((row) => row.changes?.event === "moved" && row.changes.summary?.includes("blank form template"));
    expect(moveLine?.changes?.summary).toMatch(/Moved the blank form template ".+" from ISO Compliance Documents \/ Engineering → ISO Compliance Documents \/ Blank Forms Templates \/ Engineering Forms\./);

    const logs = restored.find((folder) => folder.name === "Quality Logs")!;
    await db.update(documentFolders).set({ parentId: logs.id }).where(eq(documentFolders.id, movedOut[0]!.id));
    const stayed = await tree();
    expect(stayed.find((folder) => folder.id === movedOut[0]!.id)?.parentId).toBe(logs.id);

    const userRename = await request(app).patch(`/document-folders/${home!.id}`).set("Authorization", `Bearer ${qualityToken}`).send({ name: "Engineering" });
    expect(userRename.status).toBe(200);
    const stuck = await tree();
    expect(stuck.find((folder) => folder.id === home!.id)?.name).toBe("Engineering");
    expect(childNamed(stuck, shelfRestored.id, "Engineering Forms")).toBeUndefined();
    expect(childNamed(stuck, iso.id, "Engineering")?.id).toBe(engineering.id);
  });
});
