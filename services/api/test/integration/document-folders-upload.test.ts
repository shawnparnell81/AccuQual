import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Covers the real "upload your own policy/procedure into the library"
// feature: the one-step POST /document-folders/upload (create a leaf +
// attach a file in one request) and generalized file-type support (any
// real document type, not just PDF — a real Quality Manual or procedure is
// just as often a .docx or .xlsx).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { documentFolders } from "../../src/drizzle/schema/documentFolders.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
const app = createApp();
const suffix = Date.now();

let companyId: number;
let userId: number;
let token: string;
let departmentId: number;
let uploadedId: number;

describe("Document Folders — real file upload into the library (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;

    await seedDefaultPermissions(companyId);
    const [user] = await db.insert(users).values({ email: `doc-upload-test-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userId = user!.id;
    // "quality" has real edit access to the "documents" ResourceKey this
    // router is now gated on (see the security-audit fix that added
    // requireDepartmentAccess("documents") here, matching its sibling
    // documents.routes.ts) — department: null would no longer have any
    // access to this router at all, unlike before that fix.
    token = signAccessToken({ sub: String(userId), roleId: null, roleName: "operator", department: "quality" });

    const [dept] = await db.insert(documentFolders).values({ name: `Quality Test ${suffix}`, parentId: null }).returning();
    departmentId = dept!.id;
  });

  it("a department with zero access to documents (e.g. no department at all) CANNOT upload — previously anyone could", async () => {
    const [noDeptUser] = await db.insert(users).values({ email: `doc-upload-nodept-${suffix}@test.local`, passwordHash: "unused" }).returning();
    const noDeptToken = signAccessToken({ sub: String(noDeptUser!.id), roleId: null, roleName: "operator", department: null });
    const res = await request(app)
      .post("/document-folders/upload")
      .set("Authorization", `Bearer ${noDeptToken}`)
      .field("parentId", String(departmentId))
      .attach("file", Buffer.from("x"), "sneaky.pdf");
    expect(res.status).toBe(403);
    await db.delete(users).where(eq(users.id, noDeptUser!.id));
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("uploads a real .docx file, creating a new leaf under the chosen folder in one request", async () => {
    const res = await request(app)
      .post("/document-folders/upload")
      .set("Authorization", `Bearer ${token}`)
      .field("parentId", String(departmentId))
      .attach("file", Buffer.from("fake docx bytes"), { filename: "Quality Manual v3.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Quality Manual v3");
    expect(res.body.parentId).toBe(departmentId);
    expect(res.body.pdfPath).toBeTruthy();
    expect(res.body.pdfMimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    uploadedId = res.body.id;

    const [row] = await db.select().from(documentFolders).where(and(eq(documentFolders.id, uploadedId)));
    expect(row).toBeTruthy();
    expect(row!.parentId).toBe(departmentId);
  });

  it("downloads the real file back with its original content type and a .docx filename", async () => {
    const res = await request(app).get(`/document-folders/${uploadedId}/template`).set("Authorization", `Bearer ${token}`).responseType("blob");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(res.headers["content-disposition"]).toMatch(/\.docx"/);
    expect((res.body as Buffer).toString("utf8")).toBe("fake docx bytes");
  });

  it("rejects an upload with no real target folder", async () => {
    const res = await request(app)
      .post("/document-folders/upload")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from("x"), "notes.txt");
    expect(res.status).toBe(400);
  });

  it("an explicit name overrides the file's own name", async () => {
    const res = await request(app)
      .post("/document-folders/upload")
      .set("Authorization", `Bearer ${token}`)
      .field("parentId", String(departmentId))
      .field("name", "SOP-014 Incoming Inspection")
      .attach("file", Buffer.from("x"), "scan.pdf");
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("SOP-014 Incoming Inspection");
  });
});
