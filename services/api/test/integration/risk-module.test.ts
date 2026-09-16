// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Covers the Risk Management module rebuild: full CRUD (the previous
// risk.routes.ts only had GET/POST/GET-by-id/fmea), the open -> mitigation
// -> monitoring -> closed workflow with department gating, mitigation
// actions, admin-only delete, computed riskScore/riskLevel, and that every
// action now writes a real audit_trail row (there were none before).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { riskAssessments, riskMitigations, fmeaItems } from "../../src/drizzle/schema/risk.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { aiSuggestions } from "../../src/drizzle/schema/ai.js";
import { signAccessToken } from "../../src/utils/jwt.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
const app = createApp();
const suffix = Date.now();

let tenantId: number;
let ncrId: number;
let riskId: number;
const userIds: number[] = [];

let qualityToken: string;
let engineeringToken: string;
let productionToken: string;
let customerServiceToken: string;
let adminToken: string;

async function makeUser(department: string | null, roleName = "operator") {
  const [user] = await db.insert(users).values({ tenantId, email: `risk-test-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName, department });
}

describe("Risk Management module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Risk Test Tenant ${suffix}`, code: `risk-test-${suffix}` }).returning();
    tenantId = tenant!.id;

    await seedDefaultPermissions(tenantId);

    const [ncrRow] = await db.insert(ncr).values({ tenantId, title: "Risk test NCR", description: "x" }).returning();
    ncrId = ncrRow!.id;

    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering");
    productionToken = await makeUser("production");
    customerServiceToken = await makeUser("customer_service"); // not in risk's PERMISSION_MATRIX at all
    adminToken = await makeUser(null, "admin");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(inArray(auditTrail.performedBy, userIds));
    await db.delete(aiSuggestions).where(inArray(aiSuggestions.createdBy, userIds));
    if (riskId) {
      await db.delete(riskMitigations).where(eq(riskMitigations.riskAssessmentId, riskId));
      await db.delete(fmeaItems).where(eq(fmeaItems.riskAssessmentId, riskId));
      await db.delete(riskAssessments).where(eq(riskAssessments.id, riskId));
    }
    await db.delete(ncr).where(eq(ncr.id, ncrId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));

    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("customer_service (no matrix entry for risk at all) cannot create a risk", async () => {
    const res = await request(app).post("/risk").set("Authorization", `Bearer ${customerServiceToken}`).send({ title: "x" });
    expect(res.status).toBe(403);
  });

  it("quality can create a risk linked to a real NCR, with severity/probability computing a real riskScore + riskLevel", async () => {
    const res = await request(app)
      .post("/risk")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ title: "Supplier plating defect", category: "supplier", sourceType: "NCR", sourceId: ncrId, severity: 4, probability: 4, department: "quality" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("open");
    expect(res.body.riskScore).toBe(16);
    expect(res.body.riskLevel).toBe("critical");
    riskId = res.body.id;

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "RiskAssessment"), eq(auditTrail.entityId, riskId), eq(auditTrail.action, "create")));
    expect(row).toBeTruthy();
  });

  it("production cannot update the risk record itself — only quality/engineering can", async () => {
    const res = await request(app).put(`/risk/${riskId}`).set("Authorization", `Bearer ${productionToken}`).send({ severity: 2 });
    expect(res.status).toBe(403);
  });

  it("engineering can update it, and a severity/probability change is logged as its own flagged audit entry", async () => {
    const res = await request(app).put(`/risk/${riskId}`).set("Authorization", `Bearer ${engineeringToken}`).send({ severity: 2, probability: 2 });
    expect(res.status).toBe(200);
    expect(res.body.riskScore).toBe(4);
    expect(res.body.riskLevel).toBe("low");

    const [row] = await db
      .select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityType, "RiskAssessment"), eq(auditTrail.entityId, riskId), eq(auditTrail.action, "update")));
    expect((row?.changes as { subAction?: string })?.subAction).toBe("severity_probability_change");
  });

  it("cannot skip the workflow — open straight to closed is rejected", async () => {
    const res = await request(app).post(`/risk/${riskId}/close`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(400);
  });

  it("production cannot drive the workflow forward — quality only", async () => {
    const res = await request(app).post(`/risk/${riskId}/start-mitigation`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(403);
  });

  it("production can propose a mitigation action even though it can't edit the risk record or its status", async () => {
    const res = await request(app).post(`/risk/${riskId}/mitigation`).set("Authorization", `Bearer ${productionToken}`).send({ action: "Add incoming inspection checkpoint" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("planned");

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "RiskMitigation"), eq(auditTrail.entityId, res.body.id)));
    expect(row?.action).toBe("create");
  });

  it("quality drives the real workflow: open -> mitigation -> monitoring -> closed", async () => {
    const toMitigation = await request(app).post(`/risk/${riskId}/start-mitigation`).set("Authorization", `Bearer ${qualityToken}`);
    expect(toMitigation.status).toBe(200);
    expect(toMitigation.body.status).toBe("mitigation");

    const toMonitoring = await request(app).post(`/risk/${riskId}/start-monitoring`).set("Authorization", `Bearer ${qualityToken}`);
    expect(toMonitoring.status).toBe(200);
    expect(toMonitoring.body.status).toBe("monitoring");

    const closed = await request(app).post(`/risk/${riskId}/close`).set("Authorization", `Bearer ${qualityToken}`);
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
    expect(closed.body.closedAt).toBeTruthy();

    const statusChanges = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "RiskAssessment"), eq(auditTrail.entityId, riskId), eq(auditTrail.action, "status_change")));
    expect(statusChanges.length).toBe(3);
  });

  it("the existing FMEA quick-entry still works and now writes a real audit trail entry", async () => {
    const res = await request(app)
      .post(`/risk/${riskId}/fmea`)
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ failureMode: "Coating thickness out of spec", severity: 8, occurrence: 3, detection: 5 });
    expect(res.status).toBe(201);
    expect(res.body.rpn).toBe("120");

    const [row] = await db
      .select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityType, "RiskAssessment"), eq(auditTrail.entityId, riskId), eq(auditTrail.action, "update")));
    expect(row).toBeTruthy();
  });

  it("the AI analysis endpoint runs (honest no-key stub in this test env) and logs a real AiSuggestion", async () => {
    const res = await request(app).post(`/risk/${riskId}/ai-analysis`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.suggestionId).toBeTruthy();

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "AiSuggestion"), eq(auditTrail.entityId, res.body.suggestionId)));
    expect((row?.changes as { pipeline?: string })?.pipeline).toBe("risk_analysis");
  });

  it("production cannot delete — admin only", async () => {
    const res = await request(app).delete(`/risk/${riskId}`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(403);
  });

  it("admin can delete, and it's logged before the row disappears", async () => {
    const res = await request(app).delete(`/risk/${riskId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(204);

    const [gone] = await db.select().from(riskAssessments).where(eq(riskAssessments.id, riskId));
    expect(gone).toBeUndefined();

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "RiskAssessment"), eq(auditTrail.entityId, riskId), eq(auditTrail.action, "delete")));
    expect(row).toBeTruthy();
    riskId = 0; // afterAll already handled via this delete — skip its own cleanup for this id
  });
});
