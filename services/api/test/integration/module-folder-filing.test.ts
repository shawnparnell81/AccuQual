import { ensureTestCompany } from "../helpers/company.js";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { documentFolders } from "../../src/drizzle/schema/documentFolders.js";
import { formFilings } from "../../src/drizzle/schema/formFilings.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { FORM_TEMPLATES } from "../../src/modules/document-folders/formFiling.js";

const app = createApp();
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

let adminToken: string;

function auth() {
  return { Authorization: `Bearer ${adminToken}` };
}

const MODULE_KEYS = [
  "ncr",
  "supplier-ncr",
  "complaint",
  "capa",
  "8d",
  "dcr",
  "risk",
  "ecr",
  "eco",
  "audit-plan",
  "audit-report",
  "training-record",
  "cal-register",
  "cal-record",
] as const;

const SIBLINGS: Record<string, string[]> = {
  ncr: ["supplier-ncr", "complaint"],
  "supplier-ncr": ["ncr", "complaint"],
  complaint: ["ncr", "supplier-ncr"],
  ecr: ["eco"],
  eco: ["ecr"],
  "audit-plan": ["audit-report"],
  "audit-report": ["audit-plan"],
  "cal-register": ["cal-record"],
  "cal-record": ["cal-register"],
};

function write(createPath: string, id: number) {
  if (createPath === "/risk") return request(app).put(`${createPath}/${id}`);
  return request(app).patch(`${createPath}/${id}`);
}

function numberBody(createPath: string, token: string): Record<string, unknown> | null {
  if (createPath === "/equipment" || createPath === "/training") return null;
  if (createPath === "/document-change-requests") return { formNo: token };
  return { recordNumber: token };
}

function contentBody(createPath: string, body: Record<string, unknown>, marker: string): Record<string, unknown> {
  if (createPath === "/capa") return { rootCause: marker };
  if (createPath === "/8d") return { problemDescriptionD2: { D2: marker } };
  if (createPath === "/document-change-requests") return { preparedBy: marker };
  if (createPath === "/audits") return { name: `${String(body.name ?? "Audit")} ${marker}` };
  if (createPath === "/equipment") return { location: marker };
  return { description: marker };
}

async function fillsFor(formKey: string, recordId: number) {
  const folder = await request(app).get(`/document-folders/form-folders/${encodeURIComponent(formKey)}`).set(auth());
  expect(folder.status, formKey).toBe(200);
  return (folder.body.fills as { recordId: number }[]).filter((fill) => fill.recordId === recordId);
}

describe("module records land in their own form folder after the first real save", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [admin] = await db.insert(users).values({ email: `folder-admin-${suffix}@test.local`, passwordHash: "unused", name: "Folder Auditor" }).returning();
    adminToken = signAccessToken({ sub: String(admin!.id), roleId: null, roleName: "admin", department: null });
  });

  it("files each module type once, in its own folder, and repairs a numbered copy", async () => {
    for (const formKey of MODULE_KEYS) {
      const seed = FORM_TEMPLATES.find((item) => item.formKey === formKey);
      expect(seed?.start, formKey).toBeTruthy();
      const start = seed!.start!;
      const created = await request(app).post(start.createPath).set(auth()).send(start.body);
      expect(created.status, `${formKey} create ${JSON.stringify(created.body)}`).toBe(201);
      const id = created.body.id as number;

      expect(await fillsFor(formKey, id), `${formKey} before save`).toHaveLength(0);

      const token = `FILE-${formKey}-${suffix}`.slice(0, 40);
      const numbered = numberBody(start.createPath, token);
      if (numbered) {
        const numberedSave = await write(start.createPath, id).set(auth()).send(numbered);
        expect(numberedSave.status, `${formKey} number ${JSON.stringify(numberedSave.body)}`).toBe(200);
        expect(await fillsFor(formKey, id), `${formKey} after number`).toHaveLength(1);
        for (const sibling of SIBLINGS[formKey] ?? []) {
          expect(await fillsFor(sibling, id), `${formKey} must not file under ${sibling}`).toHaveLength(0);
        }
      }

      const marker = `SAVED-${formKey}`;
      const saved = await write(start.createPath, id).set(auth()).send(contentBody(start.createPath, start.body, marker));
      expect(saved.status, `${formKey} save ${JSON.stringify(saved.body)}`).toBe(200);
      expect(await fillsFor(formKey, id), `${formKey} after save`).toHaveLength(1);
      for (const sibling of SIBLINGS[formKey] ?? []) {
        expect(await fillsFor(sibling, id), `${formKey} stays out of ${sibling}`).toHaveLength(0);
      }

      const again = await write(start.createPath, id).set(auth()).send(contentBody(start.createPath, start.body, `${marker}-2`));
      expect(again.status, formKey).toBe(200);
      expect(await fillsFor(formKey, id), `${formKey} second save`).toHaveLength(1);

      await request(app).delete(`${start.createPath}/${id}`).set(auth());
    }
  });

  it("puts a supplier NCR in its own folder when a generic ncr pin already exists", async () => {
    const created = await request(app).post("/ncr").set(auth()).send({ title: "Supplier NCR", recordNumber: `PIN-${suffix}` });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as number;
    await db.insert(formFilings).values({ formKey: "ncr", recordId: id, formNumber: "" }).onConflictDoNothing();
    const saved = await request(app).patch(`/ncr/${id}`).set(auth()).send({ description: "Supplier defect" });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(await fillsFor("supplier-ncr", id)).toHaveLength(1);
    expect(await fillsFor("ncr", id)).toHaveLength(0);
    expect(await fillsFor("complaint", id)).toHaveLength(0);
    await request(app).delete(`/ncr/${id}`).set(auth());
  });

  it("audits an audit item add, edit, and remove on the audit itself", async () => {
    const created = await request(app).post("/audits").set(auth()).send({ name: "Internal Audit Plan", type: "internal" });
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    expect(await fillsFor("audit-plan", id)).toHaveLength(0);

    const added = await request(app).post(`/audits/${id}/item`).set(auth()).send({ question: "Is the gauge labeled?", finding: "Label missing", severity: "observation" });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(await fillsFor("audit-plan", id)).toHaveLength(1);
    expect(await fillsFor("audit-report", id)).toHaveLength(0);

    const addedHistory = await request(app).get(`/workflow/history/audit/${id}`).set(auth());
    expect(JSON.stringify(addedHistory.body)).toContain("Is the gauge labeled?");
    expect(JSON.stringify(addedHistory.body)).toContain("item_added");

    const edited = await request(app).patch(`/audits/${id}/item/${added.body.id}`).set(auth()).send({ finding: "Label replaced" });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const editedHistory = await request(app).get(`/workflow/history/audit/${id}`).set(auth());
    const editedText = JSON.stringify(editedHistory.body);
    expect(editedText).toContain("item_updated");
    expect(editedText).toContain("Label missing");
    expect(editedText).toContain("Label replaced");

    const removed = await request(app).delete(`/audits/${id}/item/${added.body.id}`).set(auth());
    expect(removed.status).toBe(204);
    const removedHistory = await request(app).get(`/workflow/history/audit/${id}`).set(auth());
    expect(JSON.stringify(removedHistory.body)).toContain("item_removed");
    expect(await fillsFor("audit-plan", id)).toHaveLength(1);

    await request(app).delete(`/audits/${id}`).set(auth());
  });

  it("records an ECR description change from the old text to the new text", async () => {
    const created = await request(app).post("/change").set(auth()).send({ title: "Engineering Change Request" });
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    expect(await fillsFor("ecr", id)).toHaveLength(0);
    const saved = await request(app).patch(`/change/${id}`).set(auth()).send({ description: "Update the bore note", impactAssessment: "No tooling change" });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(await fillsFor("ecr", id)).toHaveLength(1);
    expect(await fillsFor("eco", id)).toHaveLength(0);
    const history = await request(app).get(`/workflow/history/change/${id}`).set(auth());
    const text = JSON.stringify(history.body);
    expect(text).toContain("Description");
    expect(text).toContain("Update the bore note");
    expect(text).toContain("Impact Assessment");
    expect(text).toContain("No tooling change");
    await request(app).delete(`/change/${id}`).set(auth());
  });

  it("leaves a Supplier NCR saved into a custom Documents folder untouched", async () => {
    const custom = await request(app).post("/document-folders").set(auth()).send({ name: `Receiving ${suffix}` });
    expect(custom.status, JSON.stringify(custom.body)).toBe(201);
    const customId = custom.body.id as number;

    const created = await request(app).post("/ncr").set(auth()).send({ title: "Supplier NCR", recordNumber: `SAVEAS-${suffix}`.slice(0, 40) });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as number;

    const [node] = await db
      .insert(documentFolders)
      .values({ name: `Supplier NCR ${suffix}`, parentId: customId, sortOrder: 0, linkedPath: `/ncr/${id}` })
      .returning();
    await db.insert(formFilings).values({ formKey: "ncr", recordId: id, formNumber: "", folderNodeId: node!.id });

    const before = await db.select({ id: documentFolders.id }).from(documentFolders);
    const beforeIds = new Set(before.map((row) => row.id));

    for (let pass = 0; pass < 3; pass += 1) {
      const listed = await request(app).get("/document-folders/form-folders/ncr").set(auth());
      expect(listed.status, `repair ${pass}`).toBe(200);
    }

    const filings = await db.select().from(formFilings).where(eq(formFilings.recordId, id));
    expect(filings.map((row) => ({ formKey: row.formKey, folderNodeId: row.folderNodeId }))).toEqual([{ formKey: "ncr", folderNodeId: node!.id }]);
    const [kept] = await db.select().from(documentFolders).where(eq(documentFolders.id, node!.id));
    expect(kept?.parentId).toBe(customId);
    expect(kept?.name).toBe(`Supplier NCR ${suffix}`);
    const copies = await db.select({ id: documentFolders.id }).from(documentFolders).where(eq(documentFolders.linkedPath, `/ncr/${id}`));
    expect(copies.map((row) => row.id)).toEqual([node!.id]);

    const after = await db.select({ id: documentFolders.id }).from(documentFolders);
    const afterIds = new Set(after.map((row) => row.id));
    for (const folderId of beforeIds) expect(afterIds.has(folderId), `folder ${folderId} was deleted`).toBe(true);

    await request(app).delete(`/ncr/${id}`).set(auth());
  });

  it("shows a Supplier NCR filed in the default NCR folder under supplier-ncr once", async () => {
    const folders = await db.select().from(documentFolders);
    let iso = folders.find((folder) => folder.parentId == null && folder.name === "ISO Compliance Documents");
    if (!iso) {
      const [createdIso] = await db.insert(documentFolders).values({ name: "ISO Compliance Documents", sortOrder: 0 }).returning();
      iso = createdIso!;
    }
    let root = folders.find((folder) => folder.parentId === iso.id && folder.name === "Saved Form Folders");
    if (!root) {
      const [createdRoot] = await db.insert(documentFolders).values({ name: "Saved Form Folders", parentId: iso.id, sortOrder: 0 }).returning();
      root = createdRoot!;
    }
    let generic = folders.find((folder) => folder.parentId === root.id && folder.linkedPath === "/form-folders/ncr");
    if (!generic) {
      const [createdGeneric] = await db
        .insert(documentFolders)
        .values({ name: "Nonconformance Report", parentId: root.id, sortOrder: 0, linkedPath: "/form-folders/ncr" })
        .returning();
      generic = createdGeneric!;
    }

    const created = await request(app).post("/ncr").set(auth()).send({ title: "Supplier NCR", recordNumber: `GEN-${suffix}`.slice(0, 40) });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as number;
    const [node] = await db
      .insert(documentFolders)
      .values({ name: `Generic supplier ${suffix}`, parentId: generic.id, sortOrder: 0, linkedPath: `/ncr/${id}` })
      .returning();
    await db.insert(formFilings).values({ formKey: "ncr", recordId: id, formNumber: "", folderNodeId: node!.id });

    const listed = await request(app).get("/document-folders/form-folders/supplier-ncr").set(auth());
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect((listed.body.fills as { recordId: number }[]).filter((fill) => fill.recordId === id)).toHaveLength(1);
    const genericList = await request(app).get("/document-folders/form-folders/ncr").set(auth());
    expect((genericList.body.fills as { recordId: number }[]).filter((fill) => fill.recordId === id)).toHaveLength(0);

    const filings = await db.select().from(formFilings).where(and(eq(formFilings.recordId, id), eq(formFilings.formKey, "ncr")));
    expect(filings).toHaveLength(1);
    expect(filings[0]?.folderNodeId).toBe(node!.id);
    const [kept] = await db.select().from(documentFolders).where(eq(documentFolders.id, node!.id));
    expect(kept?.parentId).toBe(generic.id);

    await request(app).delete(`/ncr/${id}`).set(auth());
  });
});
