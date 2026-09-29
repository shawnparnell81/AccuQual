import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Regression coverage for Full-System Audit finding B1: POST/PATCH
// /forms/:type/:id/* had no per-type RBAC at all — a stale comment on this
// router claimed "most [types] stay gated by their owning record's own
// permissions," which was false. Any authenticated company user could
// rewrite an NCR/CAPA/Audit Plan/etc.'s form content through this one
// generic endpoint, bypassing the department gate enforced on that
// record's own direct route (e.g. quality-only on POST /ncr).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { formData } from "../../src/drizzle/schema/forms.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;
const userIds: number[] = [];
let qualityToken: string;
let engineeringToken: string;
let supplierToken: string;

async function makeUser(department: string | null, roleName = "operator") {
  const [user] = await db.insert(users).values({ email: `forms-rbac-${roleName}-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department });
}

describe("Forms engine RBAC — POST /forms/:type/:id/save (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    await seedDefaultPermissions(companyId);

    // ncr's own default permission entry is quality-only ({ quality: "edit" }) —
    // engineering has zero rows for it, the real bypass this finding covers.
    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering");
    supplierToken = await makeUser(null, "supplier");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("engineering (zero access to ncr) can no longer rewrite an NCR's form content — previously anyone could", async () => {
    const res = await request(app).post("/forms/ncr/999/save").set("Authorization", `Bearer ${engineeringToken}`).send({ data: { rootCause: "hacked via forms engine" } });
    expect(res.status).toBe(403);
  });

  it("quality (real edit access to ncr) can still save an NCR's form content, exactly as before", async () => {
    const res = await request(app).post("/forms/ncr/999/save").set("Authorization", `Bearer ${qualityToken}`).send({ data: { rootCause: "legitimate save" } });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(formData).where(and(eq(formData.formType, "ncr"), eq(formData.entityId, 999)));
    expect(row).toBeTruthy();
  });

  it("the same bypass is closed on a second mapped type (audit_plan -> the real 'audit' ResourceKey)", async () => {
    const res = await request(app).post("/forms/audit_plan/1/save").set("Authorization", `Bearer ${engineeringToken}`).send({ data: {} });
    expect(res.status).toBe(403);
  });

  it("an unknown form type is refused on write", async () => {
    const res = await request(app).post("/forms/not_a_form/1/save").set("Authorization", `Bearer ${engineeringToken}`).send({ data: {} });
    expect(res.status).toBe(403);
  });

  it("staff meeting minutes follow management review: engineering can open them, not rewrite them", async () => {
    const saved = await request(app).post("/forms/staff_meeting_minutes/1/save").set("Authorization", `Bearer ${engineeringToken}`).send({ data: {} });
    expect(saved.status).toBe(403);
    const read = await request(app).get("/forms/staff_meeting_minutes/1").set("Authorization", `Bearer ${engineeringToken}`);
    expect(read.status).toBe(200);
    const qualitySave = await request(app).post("/forms/staff_meeting_minutes/1/save").set("Authorization", `Bearer ${qualityToken}`).send({ data: { notes: "plant meeting" } });
    expect(qualitySave.status).toBe(200);
  });

  it("Management Review is version-controlled now: the generic save refuses it for everyone (see versioning.test.ts)", async () => {
    const res = await request(app).post("/forms/management_review/1/save").set("Authorization", `Bearer ${engineeringToken}`).send({ data: {} });
    expect(res.status).toBe(409);
  });

  it("a supplier and a department without the module cannot read or export another module's form by id", async () => {
    const saved = await request(app).post("/forms/ncr/42/save").set("Authorization", `Bearer ${qualityToken}`).send({ data: { rootCause: "known issue" } });
    expect(saved.status).toBe(200);

    const engineeringRead = await request(app).get("/forms/ncr/42").set("Authorization", `Bearer ${engineeringToken}`);
    expect(engineeringRead.status).toBe(403);
    const engineeringHistory = await request(app).get("/forms/ncr/42/history").set("Authorization", `Bearer ${engineeringToken}`);
    expect(engineeringHistory.status).toBe(403);
    const engineeringExport = await request(app).post("/forms/ncr/42/export").set("Authorization", `Bearer ${engineeringToken}`);
    expect(engineeringExport.status).toBe(403);

    const supplierRead = await request(app).get("/forms/ncr/42").set("Authorization", `Bearer ${supplierToken}`);
    expect(supplierRead.status).toBe(403);
    const supplierHistory = await request(app).get("/forms/ncr/42/history").set("Authorization", `Bearer ${supplierToken}`);
    expect(supplierHistory.status).toBe(403);
    const supplierExport = await request(app).post("/forms/ncr/42/export").set("Authorization", `Bearer ${supplierToken}`);
    expect(supplierExport.status).toBe(403);

    const qualityRead = await request(app).get("/forms/ncr/42").set("Authorization", `Bearer ${qualityToken}`);
    expect(qualityRead.status).toBe(200);
    const qualityHistory = await request(app).get("/forms/ncr/42/history").set("Authorization", `Bearer ${qualityToken}`);
    expect(qualityHistory.status).toBe(200);
    const qualityExport = await request(app).post("/forms/ncr/42/export").set("Authorization", `Bearer ${qualityToken}`);
    expect(qualityExport.status).toBe(200);
    expect(qualityExport.headers["content-type"]).toMatch(/pdf/);
  });

  it("quality cannot read or export a PPAP form; engineering can", async () => {
    const qualityRead = await request(app).get("/forms/apqp_summary/7").set("Authorization", `Bearer ${qualityToken}`);
    expect(qualityRead.status).toBe(403);
    const qualityExport = await request(app).post("/forms/apqp_summary/7/export").set("Authorization", `Bearer ${qualityToken}`);
    expect(qualityExport.status).toBe(403);

    const engineeringRead = await request(app).get("/forms/apqp_summary/7").set("Authorization", `Bearer ${engineeringToken}`);
    expect(engineeringRead.status).toBe(200);
    const engineeringExport = await request(app).post("/forms/apqp_summary/7/export").set("Authorization", `Bearer ${engineeringToken}`);
    expect(engineeringExport.status).toBe(200);
  });
});
