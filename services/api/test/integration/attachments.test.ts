import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test. Listing or downloading a file requires access
// to the parent record (department, and plant when that record has one).
// Supplier logins cannot use this route. Uploads are sniffed, and only an
// image or PDF is shown in the browser.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { attachments } from "../../src/drizzle/schema/attachments.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { ppapPackages } from "../../src/drizzle/schema/ppap.js";
import { sites } from "../../src/drizzle/schema/sites.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const PDF = Buffer.from("%PDF-1.4 fake evidence scan");
const DOCX = Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.from("word/document.xml")]);

let uploaderToken: string;
let otherUserToken: string;
let engineeringToken: string;
let supplierToken: string;
let adminToken: string;
let generalUploadId: number;
let evidenceUploadId: number;
let docxUploadId: number;
let ncrId: number;

async function makeUser(roleName: string, department: string | null) {
  const [user] = await db
    .insert(users)
    .values({ email: `attach-test-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department })
    .returning();
  return { id: user!.id, token: signAccessToken({ sub: String(user!.id), roleId: null, roleName, department }) };
}

describe("Attachments module — access, sniffing, and download (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);

    const uploader = await makeUser("operator", "quality");
    uploaderToken = uploader.token;
    otherUserToken = (await makeUser("operator", "quality")).token;
    engineeringToken = (await makeUser("operator", "engineering")).token;
    supplierToken = (await makeUser("supplier", null)).token;
    adminToken = (await makeUser("admin", null)).token;

    const [created] = await db.insert(ncr).values({ title: `Attachment access NCR ${suffix}`, createdBy: uploader.id }).returning();
    ncrId = created!.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("refuses a file whose contents are not on the allow-list", async () => {
    const text = await request(app).post("/attachments").set("Authorization", `Bearer ${uploaderToken}`).attach("file", Buffer.from("hello world"), "notes.txt");
    expect(text.status).toBe(400);
    const html = await request(app).post("/attachments").set("Authorization", `Bearer ${uploaderToken}`).attach("file", Buffer.from("<html></html>"), "page.html");
    expect(html.status).toBe(400);
  });

  it("uploads a general image into the shared bin", async () => {
    const res = await request(app).post("/attachments").set("Authorization", `Bearer ${uploaderToken}`).attach("file", PNG, "notes.png");
    expect(res.status).toBe(201);
    expect(res.body.fileName).toBe("notes.png");
    expect(res.body.entityType).toBeNull();
    expect(res.body.mimeType).toBe("image/png");
    generalUploadId = res.body.id;

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Attachment"), eq(auditTrail.entityId, generalUploadId), eq(auditTrail.action, "create")));
    expect(row).toBeTruthy();
  });

  it("uploads a file attached to a real NCR", async () => {
    const res = await request(app)
      .post("/attachments")
      .set("Authorization", `Bearer ${uploaderToken}`)
      .field("entityType", "ncr")
      .field("entityId", String(ncrId))
      .attach("file", PDF, "evidence.pdf");
    expect(res.status).toBe(201);
    expect(res.body.entityType).toBe("ncr");
    expect(res.body.entityId).toBe(ncrId);
    evidenceUploadId = res.body.id;
  });

  it("lists only the general bin when no entityType/entityId is given", async () => {
    const res = await request(app).get("/attachments").set("Authorization", `Bearer ${uploaderToken}`);
    expect(res.status).toBe(200);
    expect(res.body.map((a: { id: number }) => a.id)).toContain(generalUploadId);
    expect(res.body.map((a: { id: number }) => a.id)).not.toContain(evidenceUploadId);
  });

  it("lists only that record's own evidence when entityType/entityId are given", async () => {
    const res = await request(app).get("/attachments").query({ entityType: "ncr", entityId: ncrId }).set("Authorization", `Bearer ${uploaderToken}`);
    expect(res.status).toBe(200);
    expect(res.body.map((a: { id: number }) => a.id)).toEqual([evidenceUploadId]);
  });

  it("shows an image inline and forces a Word file to download", async () => {
    const image = await request(app).get(`/attachments/${generalUploadId}/download`).set("Authorization", `Bearer ${uploaderToken}`).responseType("blob");
    expect(image.status).toBe(200);
    expect(Buffer.compare(image.body as Buffer, PNG)).toBe(0);
    expect(String(image.headers["content-disposition"])).toContain("inline");
    expect(String(image.headers["content-security-policy"])).toBe("sandbox");

    const uploaded = await request(app).post("/attachments").set("Authorization", `Bearer ${uploaderToken}`).attach("file", DOCX, "notes.docx");
    expect(uploaded.status).toBe(201);
    docxUploadId = uploaded.body.id;
    const word = await request(app).get(`/attachments/${docxUploadId}/download`).set("Authorization", `Bearer ${uploaderToken}`).responseType("blob");
    expect(word.status).toBe(200);
    expect(String(word.headers["content-disposition"])).toContain("attachment");
    expect(String(word.headers["content-security-policy"])).toBe("sandbox");
    expect(String(word.headers["x-content-type-options"])).toBe("nosniff");
  });

  it("refuses a department that cannot open the parent record", async () => {
    const listed = await request(app).get("/attachments").query({ entityType: "ncr", entityId: ncrId }).set("Authorization", `Bearer ${engineeringToken}`);
    expect(listed.status).toBe(403);
    const downloaded = await request(app).get(`/attachments/${evidenceUploadId}/download`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(downloaded.status).toBe(403);
  });

  it("refuses a supplier login on this route", async () => {
    const listed = await request(app).get("/attachments").set("Authorization", `Bearer ${supplierToken}`);
    expect(listed.status).toBe(403);
    const downloaded = await request(app).get(`/attachments/${evidenceUploadId}/download`).set("Authorization", `Bearer ${supplierToken}`);
    expect(downloaded.status).toBe(403);
  });

  it("refuses a quality user and a supplier download of another module's file by id", async () => {
    // PPAP is engineering-only. Quality can open NCRs and still must not open this file by guessing its id.
    const [pkg] = await db.insert(ppapPackages).values({ partNumber: `PPAP-${suffix}` }).returning();
    const uploaded = await request(app)
      .post("/attachments")
      .set("Authorization", `Bearer ${adminToken}`)
      .field("entityType", "ppap")
      .field("entityId", String(pkg!.id))
      .attach("file", PDF, "ppap-evidence.pdf");
    expect(uploaded.status).toBe(201);

    const qualityList = await request(app).get("/attachments").query({ entityType: "ppap", entityId: pkg!.id }).set("Authorization", `Bearer ${uploaderToken}`);
    expect(qualityList.status).toBe(403);
    const qualityDownload = await request(app).get(`/attachments/${uploaded.body.id}/download`).set("Authorization", `Bearer ${uploaderToken}`);
    expect(qualityDownload.status).toBe(403);

    const supplierDownload = await request(app).get(`/attachments/${uploaded.body.id}/download`).set("Authorization", `Bearer ${supplierToken}`);
    expect(supplierDownload.status).toBe(403);

    const engineeringDownload = await request(app).get(`/attachments/${uploaded.body.id}/download`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(engineeringDownload.status).toBe(200);
  });

  it("hides an NCR that lives at a plant the caller is not assigned to", async () => {
    const [west] = await db.insert(sites).values({ name: "West plant", code: `west-${suffix}`, status: "active", isDefault: false }).returning();
    const [westNcr] = await db.insert(ncr).values({ title: "West issue", siteId: west!.id }).returning();
    const uploaded = await request(app)
      .post("/attachments")
      .set("Authorization", `Bearer ${adminToken}`)
      .field("entityType", "ncr")
      .field("entityId", String(westNcr!.id))
      .attach("file", PDF, "west.pdf");
    expect(uploaded.status).toBe(201);

    const hidden = await request(app).get("/attachments").query({ entityType: "ncr", entityId: westNcr!.id }).set("Authorization", `Bearer ${uploaderToken}`);
    expect(hidden.status).toBe(404);
    const visible = await request(app).get("/attachments").query({ entityType: "ncr", entityId: westNcr!.id }).set("Authorization", `Bearer ${adminToken}`);
    expect(visible.status).toBe(200);
    expect(visible.body.map((a: { id: number }) => a.id)).toContain(uploaded.body.id);
  });

  it("rejects an unknown record type and a missing parent", async () => {
    const unknown = await request(app).get("/attachments").query({ entityType: "not_a_record", entityId: 1 }).set("Authorization", `Bearer ${uploaderToken}`);
    expect(unknown.status).toBe(400);
    const missing = await request(app).get("/attachments").query({ entityType: "ncr", entityId: 999999 }).set("Authorization", `Bearer ${uploaderToken}`);
    expect(missing.status).toBe(404);
  });

  it("a different user cannot delete someone else's upload", async () => {
    const res = await request(app).delete(`/attachments/${generalUploadId}`).set("Authorization", `Bearer ${otherUserToken}`);
    expect(res.status).toBe(403);
  });

  it("an admin CAN delete someone else's upload", async () => {
    const res = await request(app).delete(`/attachments/${generalUploadId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
    const [gone] = await db.select().from(attachments).where(eq(attachments.id, generalUploadId));
    expect(gone).toBeUndefined();
    generalUploadId = 0;
  });

  it("the uploader can delete their own remaining upload", async () => {
    const res = await request(app).delete(`/attachments/${evidenceUploadId}`).set("Authorization", `Bearer ${uploaderToken}`);
    expect(res.status).toBe(204);
    evidenceUploadId = 0;
  });
});
