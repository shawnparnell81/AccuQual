// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Covers the ONE generic attachments system (see attachments.ts's own
// schema comment) — real disk upload/download/delete, evidence attached to
// an existing record vs. the shared "General Uploads" bin, and the
// uploader-or-admin delete rule.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { attachments } from "../../src/drizzle/schema/attachments.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let uploaderToken: string;
let otherUserToken: string;
let adminToken: string;
let generalUploadId: number;
let evidenceUploadId: number;

async function makeUser(roleName = "operator") {
  const [user] = await db.insert(users).values({ tenantId, email: `attach-test-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  return { id: user!.id, token: signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName, department: null }) };
}

describe("Attachments module — generic upload/list/download/delete (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Attachments Test Tenant ${suffix}`, code: `attach-test-${suffix}` }).returning();
    tenantId = tenant!.id;

    const uploader = await makeUser();
    uploaderToken = uploader.token;
    otherUserToken = (await makeUser()).token;
    adminToken = (await makeUser("admin")).token;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(attachments).where(eq(attachments.tenantId, tenantId));
    await db.delete(users).where(eq(users.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("uploads a general file (no entityType/entityId) into the shared bin", async () => {
    const res = await request(app).post("/attachments").set("Authorization", `Bearer ${uploaderToken}`).attach("file", Buffer.from("hello world"), "notes.txt");
    expect(res.status).toBe(201);
    expect(res.body.fileName).toBe("notes.txt");
    expect(res.body.entityType).toBeNull();
    generalUploadId = res.body.id;

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Attachment"), eq(auditTrail.entityId, generalUploadId), eq(auditTrail.action, "create")));
    expect(row).toBeTruthy();
  });

  it("uploads a file attached to a specific record (evidence on NCR #42)", async () => {
    const res = await request(app)
      .post("/attachments")
      .set("Authorization", `Bearer ${uploaderToken}`)
      .field("entityType", "ncr")
      .field("entityId", "42")
      .attach("file", Buffer.from("%PDF-1.4 fake evidence scan"), "evidence.pdf");
    expect(res.status).toBe(201);
    expect(res.body.entityType).toBe("ncr");
    expect(res.body.entityId).toBe(42);
    evidenceUploadId = res.body.id;
  });

  it("lists only the general bin when no entityType/entityId is given", async () => {
    const res = await request(app).get("/attachments").set("Authorization", `Bearer ${uploaderToken}`);
    expect(res.status).toBe(200);
    expect(res.body.map((a: { id: number }) => a.id)).toContain(generalUploadId);
    expect(res.body.map((a: { id: number }) => a.id)).not.toContain(evidenceUploadId);
  });

  it("lists only that record's own evidence when entityType/entityId are given", async () => {
    const res = await request(app).get("/attachments").query({ entityType: "ncr", entityId: 42 }).set("Authorization", `Bearer ${uploaderToken}`);
    expect(res.status).toBe(200);
    expect(res.body.map((a: { id: number }) => a.id)).toEqual([evidenceUploadId]);
  });

  it("downloads a real file with the original bytes intact", async () => {
    const res = await request(app).get(`/attachments/${generalUploadId}/download`).set("Authorization", `Bearer ${uploaderToken}`).responseType("blob");
    expect(res.status).toBe(200);
    expect((res.body as Buffer).toString("utf8")).toBe("hello world");
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
