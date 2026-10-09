import { ensureTestCompany } from "../helpers/company.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { documentFolders } from "../../src/drizzle/schema/documentFolders.js";
import { formFilings } from "../../src/drizzle/schema/formFilings.js";
import { validationReports } from "../../src/drizzle/schema/validationReport.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

let adminToken: string;

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function filingFor(recordId: number) {
  const [row] = await db.select().from(formFilings).where(and(eq(formFilings.formKey, "frm-val-001"), eq(formFilings.recordId, recordId)));
  return row;
}

describe("folder listing and search do not delete a saved form", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [admin] = await db.insert(users).values({ email: `listing-repair-${suffix}@test.local`, passwordHash: "unused", name: "Listing Repair" }).returning();
    adminToken = signAccessToken({ sub: String(admin!.id), roleId: null, roleName: "admin", department: null });
    const seeded = await request(app).get("/document-folders").set(auth(adminToken));
    expect(seeded.status).toBe(200);
  });

  it("keeps a valid filing when the folder is listed and searched", async () => {
    const created = await request(app).post("/validation-reports").set(auth(adminToken)).send({ data: { formType: "csa", cells: { B6: "PN-KEEP" } } });
    expect(created.status).toBe(201);
    const recordId = created.body.id as number;
    const filed = await request(app).post("/document-folders/form-filings").set(auth(adminToken)).send({ formKey: "frm-val-001", recordId, formFolderKey: "frm-val-001" });
    expect(filed.status).toBe(201);
    const before = await filingFor(recordId);
    expect(before?.id).toBeTruthy();
    expect(before?.folderNodeId).toBeTruthy();
    await db.update(documentFolders).set({ name: "CSA", linkedPath: "/validation-reports/999999" }).where(eq(documentFolders.id, before!.folderNodeId!));

    const folder = await request(app).get("/document-folders/form-folders/frm-val-001").set(auth(adminToken));
    expect(folder.status).toBe(200);
    const fills = folder.body.fills as { recordId: number; openPath: string; fileName: string }[];
    expect(fills.some((fill) => fill.recordId === recordId && fill.openPath === `/validation-reports/${recordId}` && fill.fileName === "CSA")).toBe(true);

    const found = await request(app).get("/search").query({ q: "CSA" }).set(auth(adminToken));
    expect(found.status).toBe(200);
    expect((found.body.results as { path: string }[]).some((row) => row.path === `/validation-reports/${recordId}`)).toBe(true);

    const after = await filingFor(recordId);
    expect(after?.id).toBe(before?.id);
    expect(after?.folderNodeId).toBe(before?.folderNodeId);
    const [node] = await db.select().from(documentFolders).where(eq(documentFolders.id, before!.folderNodeId!));
    expect(node?.linkedPath).toBe(`/validation-reports/${recordId}`);
    const [report] = await db.select().from(validationReports).where(eq(validationReports.id, recordId));
    expect(report?.id).toBe(recordId);

    const again = await request(app).get("/document-folders/form-folders/frm-val-001").set(auth(adminToken));
    const againSearch = await request(app).get("/search").query({ q: "CSA" }).set(auth(adminToken));
    expect(again.status).toBe(200);
    expect(againSearch.status).toBe(200);
    expect((await filingFor(recordId))?.id).toBe(before?.id);
  });

  it("files an existing validation report back into the folder after the filing was removed", async () => {
    const created = await request(app).post("/validation-reports").set(auth(adminToken)).send({ data: { formType: "csa", cells: { B6: "PN-RESTORE" } } });
    expect(created.status).toBe(201);
    const recordId = created.body.id as number;
    const openPath = `/validation-reports/${recordId}`;
    const existing = await filingFor(recordId);
    if (existing?.folderNodeId != null) await db.delete(documentFolders).where(eq(documentFolders.id, existing.folderNodeId));
    if (existing) await db.delete(formFilings).where(eq(formFilings.id, existing.id));
    await db.insert(auditTrail).values({
      entityType: "DocumentFolder",
      entityId: 0,
      action: "delete",
      changes: { event: "orphan_removed", name: "CSA", linkedPath: openPath },
    });

    const folder = await request(app).get("/document-folders/form-folders/frm-val-001").set(auth(adminToken));
    expect(folder.status).toBe(200);
    const listed = await request(app).get("/document-folders/form-folders").set(auth(adminToken));
    const csa = (listed.body as { formKey: string; savedCount: number }[]).find((row) => row.formKey === "frm-val-001");
    expect(csa?.savedCount).toBeGreaterThan(0);
    const fills = folder.body.fills as { recordId: number; openPath: string; fileName: string }[];
    const mine = fills.find((fill) => fill.recordId === recordId);
    expect(mine?.openPath).toBe(openPath);
    expect(mine?.fileName).toBe("CSA");

    const found = await request(app).get("/search").query({ q: "CSA" }).set(auth(adminToken));
    expect((found.body.results as { path: string }[]).some((row) => row.path === openPath)).toBe(true);

    const restored = await filingFor(recordId);
    expect(restored?.folderNodeId).toBeTruthy();
    const [report] = await db.select().from(validationReports).where(eq(validationReports.id, recordId));
    expect(report?.id).toBe(recordId);

    const reload = await request(app).get("/document-folders/form-folders/frm-val-001").set(auth(adminToken));
    const copies = (reload.body.fills as { recordId: number }[]).filter((fill) => fill.recordId === recordId);
    expect(copies).toHaveLength(1);
    const rows = await db.select().from(formFilings).where(and(eq(formFilings.formKey, "frm-val-001"), eq(formFilings.recordId, recordId)));
    expect(rows).toHaveLength(1);
  });

  it("hides a filing whose record is missing and leaves that filing row in place", async () => {
    const [node] = await db.insert(documentFolders).values({ name: "Ghost CSA", linkedPath: "/validation-reports/999999", sortOrder: 0 }).returning();
    const [ghost] = await db.insert(formFilings).values({ formKey: "frm-val-001", recordId: 999999, folderNodeId: node!.id, formNumber: "FRM-VAL-001" }).returning();

    const folder = await request(app).get("/document-folders/form-folders/frm-val-001").set(auth(adminToken));
    expect(folder.status).toBe(200);
    expect((folder.body.fills as { recordId: number }[]).some((fill) => fill.recordId === 999999)).toBe(false);
    const found = await request(app).get("/search").query({ q: "Ghost CSA" }).set(auth(adminToken));
    expect((found.body.results as { path: string }[]).some((row) => row.path === "/validation-reports/999999")).toBe(false);

    const [still] = await db.select().from(formFilings).where(eq(formFilings.id, ghost!.id));
    expect(still?.id).toBe(ghost!.id);
    const [kept] = await db.select().from(documentFolders).where(eq(documentFolders.id, node!.id));
    expect(kept?.id).toBe(node!.id);
  });

  it("does not file a validation report back after it is deleted", async () => {
    const created = await request(app).post("/validation-reports").set(auth(adminToken)).send({ data: { formType: "csa", cells: {} } });
    expect(created.status).toBe(201);
    const recordId = created.body.id as number;
    const removed = await request(app).delete(`/validation-reports/${recordId}`).set(auth(adminToken));
    expect(removed.status).toBe(204);
    const folder = await request(app).get("/document-folders/form-folders/frm-val-001").set(auth(adminToken));
    expect((folder.body.fills as { recordId: number }[]).some((fill) => fill.recordId === recordId)).toBe(false);
    expect(await filingFor(recordId)).toBeUndefined();
    const [report] = await db.select().from(validationReports).where(eq(validationReports.id, recordId));
    expect(report).toBeUndefined();
  });
});
