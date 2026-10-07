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
  await db.update(company).set({ profile }).where(eq(company.id, row!.id));
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

  it("merges same-parent duplicates once, keeps Quality Manual in both of its homes, and does not bring back a deleted main folder", async () => {
    const first = await tree();
    const iso = first.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents")!;
    const quality = childNamed(first, iso.id, "Quality")!;
    const manuals = first.filter((folder) => folder.name === "Quality Manual");
    expect(manuals.length).toBeGreaterThan(1);
    expect(new Set(manuals.map((folder) => folder.parentId)).size).toBe(manuals.length);

    await clearMergeFlag();
    const [copy] = await db.insert(documentFolders).values({ name: "Quality", parentId: iso.id, sortOrder: 80 }).returning();
    const [kept] = await db.insert(documentFolders).values({ name: "Kept notes", parentId: copy!.id, sortOrder: 0 }).returning();

    const merged = await tree();
    const qualities = merged.filter((folder) => folder.name === "Quality" && folder.parentId === iso.id);
    expect(qualities).toHaveLength(1);
    expect(qualities[0]?.id).toBe(quality.id);
    expect(merged.find((folder) => folder.id === kept!.id)?.parentId).toBe(quality.id);
    expect(merged.some((folder) => folder.id === copy!.id)).toBe(false);
    const stillManuals = merged.filter((folder) => folder.name === "Quality Manual");
    expect(stillManuals.map((folder) => folder.parentId).sort()).toEqual(manuals.map((folder) => folder.parentId).sort());

    const history = await request(app).get(`/audit-trail/DocumentFolder/${quality.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(history.status).toBe(200);
    const line = (history.body as { performedByName?: string; changes?: { summary?: string; event?: string } }[]).find((row) => row.changes?.event === "merged");
    expect(line?.performedByName).toContain("Shawn Parnell");
    expect(line?.changes?.summary).toMatch(/Merged the duplicate folder "Quality" from .+ → .+/);

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
    const linkedLine = (linkedHistory.body as { changes?: { summary?: string; keptRecord?: boolean } }[]).find((row) => row.changes?.keptRecord === true);
    expect(linkedLine?.changes?.summary).toMatch(/left in place/);
    const orphanHistory = await request(app).get(`/audit-trail/DocumentFolder/${orphan!.id}`).set("Authorization", `Bearer ${qualityToken}`);
    const orphanLine = (orphanHistory.body as { changes?: { summary?: string; keptRecord?: boolean } }[]).find((row) => row.changes?.keptRecord === false);
    expect(orphanLine?.changes?.summary).toMatch(/uploaded file/);
  });
});
