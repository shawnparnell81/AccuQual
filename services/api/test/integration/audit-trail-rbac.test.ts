import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Regression coverage for Full-System Audit finding H1: GET
// /audit-trail/:entityType/:entityId had NO RBAC gate at all — any
// authenticated company user could read any other department's full
// change/decision history just by knowing or guessing an entityId. Company
// scoping itself was already correct; this was an intra-company
// information-disclosure gap.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { audits, auditItems } from "../../src/drizzle/schema/audits.js";
import { sites } from "../../src/drizzle/schema/sites.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;
let ncrId: number;
const userIds: number[] = [];
let qualityToken: string;
let engineeringToken: string;
let adminToken: string;

async function makeUser(department: string | null, roleName = "operator") {
  const [user] = await db.insert(users).values({ email: `audit-rbac-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department });
}

describe("Audit trail read RBAC — GET /audit-trail/:entityType/:entityId (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    await seedDefaultPermissions(companyId);

    qualityToken = await makeUser("quality");
    // ncr's own default permission entry is quality-only ({ quality: "edit" }) —
    // engineering has zero rows for it, the real "no access whatsoever" case.
    engineeringToken = await makeUser("engineering");
    adminToken = await makeUser(null, "admin");

    const [created] = await db.insert(ncr).values({ title: `Audit RBAC test NCR ${suffix}` }).returning();
    ncrId = created!.id;
    await db.insert(auditTrail).values({ entityType: "NCR", entityId: ncrId, action: "create", changes: { title: created!.title } });

    // training/qms_forms both default every department to at least "read"
    // (training) or "edit" (qms_forms) — see defaultPermissions.ts's own
    // comments — so engineering needs an explicit downgrade here to get a
    // real "no access" case for these two, unlike ncr above where
    // engineering already has zero rows by default.
    await db
      .update(departmentPermissions)
      .set({ accessLevel: "none" })
      .where(and(eq(departmentPermissions.departmentName, "engineering"), inArray(departmentPermissions.moduleName, ["training", "qms_forms"])));

    await db.insert(auditTrail).values({ entityType: "TrainingAssignment", entityId: 424242, action: "create", changes: {} });
    await db.insert(auditTrail).values({ entityType: "QmsForm", entityId: 424242, action: "create", changes: {} });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("quality (owns the ncr ResourceKey) can read this NCR's audit history", async () => {
    const res = await request(app).get(`/audit-trail/NCR/${ncrId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("engineering (zero access to ncr) CANNOT read this NCR's audit history — previously anyone could", async () => {
    const res = await request(app).get(`/audit-trail/NCR/${ncrId}`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(403);
  });

  it("admin bypasses the gate, same as every other module", async () => {
    const res = await request(app).get(`/audit-trail/NCR/${ncrId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("a genuinely admin-only entity type (Company) blocks a non-admin outright", async () => {
    const res = await request(app).get(`/audit-trail/Company/${companyId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(403);
  });

  it("rejects a record type that is not on the allow-list, including for an admin", async () => {
    const res = await request(app).get(`/audit-trail/DigitalTwinSimulation/999999`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(400);
    const admin = await request(app).get(`/audit-trail/DigitalTwinSimulation/999999`).set("Authorization", `Bearer ${adminToken}`);
    expect(admin.status).toBe(400);
  });

  // Regression coverage: TrainingAssignment/QmsForm were missing from
  // ENTITY_TYPE_TO_RESOURCE even after Training (C2) and QMS Forms (C3)
  // each gained a real requireDepartmentAccess gate on their own routes —
  // silently re-opening the exact disclosure gap H1 exists to close.
  it("quality (edit access to training) can read a TrainingAssignment's audit history", async () => {
    const res = await request(app).get("/audit-trail/TrainingAssignment/424242").set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("engineering (downgraded to no training access) CANNOT read a TrainingAssignment's audit history", async () => {
    const res = await request(app).get("/audit-trail/TrainingAssignment/424242").set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(403);
  });

  it("quality (edit access to qms_forms) can read a QmsForm's audit history", async () => {
    const res = await request(app).get("/audit-trail/QmsForm/424242").set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("engineering (downgraded to no qms_forms access) CANNOT read a QmsForm's audit history", async () => {
    const res = await request(app).get("/audit-trail/QmsForm/424242").set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(403);
  });

  it("hides an NCR and an audit finding that live at a plant the caller is not assigned to", async () => {
    const [west] = await db.insert(sites).values({ name: "West plant", code: `west-${suffix}`, status: "active", isDefault: false }).returning();
    const [westNcr] = await db.insert(ncr).values({ title: "West issue", siteId: west!.id }).returning();
    await db.insert(auditTrail).values({ entityType: "NCR", entityId: westNcr!.id, action: "create", changes: { title: westNcr!.title } });
    const [westAudit] = await db.insert(audits).values({ name: "West audit", siteId: west!.id }).returning();
    const [finding] = await db.insert(auditItems).values({ auditId: westAudit!.id, finding: "West finding" }).returning();
    await db.insert(auditTrail).values({ entityType: "Audit Finding", entityId: finding!.id, action: "create", changes: {} });

    const hiddenNcr = await request(app).get(`/audit-trail/NCR/${westNcr!.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(hiddenNcr.status).toBe(404);
    const hiddenFinding = await request(app).get(`/audit-trail/${encodeURIComponent("Audit Finding")}/${finding!.id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(hiddenFinding.status).toBe(404);

    const visibleNcr = await request(app).get(`/audit-trail/NCR/${westNcr!.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(visibleNcr.status).toBe(200);
    const visibleFinding = await request(app).get(`/audit-trail/${encodeURIComponent("Audit Finding")}/${finding!.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(visibleFinding.status).toBe(200);

    const list = await request(app).get("/audit-trail").set("Authorization", `Bearer ${qualityToken}`);
    expect(list.status).toBe(200);
    const listed = list.body as { entityType: string; entityId: number }[];
    expect(listed.some((row) => row.entityType === "NCR" && row.entityId === westNcr!.id)).toBe(false);
    expect(listed.some((row) => row.entityType === "Audit Finding" && row.entityId === finding!.id)).toBe(false);
    expect(listed.some((row) => row.entityType === "NCR" && row.entityId === ncrId)).toBe(true);

    const adminList = await request(app).get("/audit-trail").set("Authorization", `Bearer ${adminToken}`);
    expect(adminList.status).toBe(200);
    const adminRows = adminList.body as { entityType: string; entityId: number }[];
    expect(adminRows.some((row) => row.entityType === "NCR" && row.entityId === westNcr!.id)).toBe(true);
  });
});
