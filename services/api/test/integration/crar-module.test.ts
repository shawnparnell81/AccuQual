// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Covers the Customer Return Analysis Report: creation (Quality-only),
// the full new -> quality_review -> warranty_review -> completed
// lifecycle, department gating on each transition, the engineering/
// purchasing "warrantyId-link-only" carve-out, linking to a real warranty
// claim, and the audit trail.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { crarClaims } from "../../src/drizzle/schema/crar.js";
import { warrantyClaims } from "../../src/drizzle/schema/warranty.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
const app = createApp();
const suffix = Date.now();

let tenantId: number;
let qualityToken: string;
let customerServiceToken: string;
let engineeringToken: string;
let purchasingToken: string;
let salesToken: string;
let adminToken: string;
let warrantyClaimId: number;
let crarId: number;

async function makeUser(department: string, roleName = "operator") {
  const [user] = await db.insert(users).values({ tenantId, email: `crar-test-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department }).returning();
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName, department });
}

describe("CRAR module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `CRAR Test Tenant ${suffix}`, code: `crar-test-${suffix}` }).returning();
    tenantId = tenant!.id;

    await seedDefaultPermissions(tenantId);

    qualityToken = await makeUser("quality");
    customerServiceToken = await makeUser("customer_service");
    engineeringToken = await makeUser("engineering");
    purchasingToken = await makeUser("purchasing");
    salesToken = await makeUser("sales_and_marketing");
    adminToken = await makeUser(null as unknown as string, "admin");

    const [claim] = await db.insert(warrantyClaims).values({ tenantId, claimNumber: `WC-CRARTEST-${suffix}`, status: "new" }).returning();
    warrantyClaimId = claim!.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(crarClaims).where(eq(crarClaims.tenantId, tenantId));
    await db.delete(warrantyClaims).where(eq(warrantyClaims.tenantId, tenantId));
    await db.delete(users).where(eq(users.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));

    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("customer_service (read-only) cannot create a CRAR", async () => {
    const res = await request(app).post("/crar").set("Authorization", `Bearer ${customerServiceToken}`).send({ customerName: "Acme Co", partNumber: "PN-1" });
    expect(res.status).toBe(403);
  });

  it("quality creates a CRAR with every one of the form's real fields accepted", async () => {
    const res = await request(app)
      .post("/crar")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({
        customerName: "Acme Co",
        rmaNumber: "RMA-000123",
        customerClaim: "CLM-500",
        partNumber: "PN-9001",
        partDescription: "M6 hex bolt",
        qtyReturned: "50",
        reportInitiatedBy: "J. Smith",
        approvedBy: "M. Jones",
        customerComplaint: "Bolts failed torque spec.",
        assessmentDamage: true,
        warrantyId: warrantyClaimId,
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("new");
    expect(res.body.partDescription).toBe("M6 hex bolt");
    expect(res.body.assessmentDamage).toBe(true);
    expect(res.body.warrantyId).toBe(warrantyClaimId);
    crarId = res.body.id;
  });

  it("GET /crar/:id resolves the real linked warranty claim", async () => {
    const res = await request(app).get(`/crar/${crarId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.warranty).toMatchObject({ id: warrantyClaimId });
  });

  it("customer_service can view (read-only) but cannot PATCH", async () => {
    const view = await request(app).get(`/crar/${crarId}`).set("Authorization", `Bearer ${customerServiceToken}`);
    expect(view.status).toBe(200);
    const patch = await request(app).patch(`/crar/${crarId}`).set("Authorization", `Bearer ${customerServiceToken}`).send({ findings: "x" });
    expect(patch.status).toBe(403);
  });

  it("engineering may PATCH only warrantyId, nothing else", async () => {
    const blocked = await request(app).patch(`/crar/${crarId}`).set("Authorization", `Bearer ${engineeringToken}`).send({ findings: "Root cause identified" });
    expect(blocked.status).toBe(403);

    const allowed = await request(app).patch(`/crar/${crarId}`).set("Authorization", `Bearer ${engineeringToken}`).send({ warrantyId: warrantyClaimId });
    expect(allowed.status).toBe(200);
  });

  it("purchasing may also PATCH only warrantyId (same carve-out)", async () => {
    const res = await request(app).patch(`/crar/${crarId}`).set("Authorization", `Bearer ${purchasingToken}`).send({ warrantyId: warrantyClaimId });
    expect(res.status).toBe(200);
  });

  it("quality can PATCH the real content fields", async () => {
    const res = await request(app).patch(`/crar/${crarId}`).set("Authorization", `Bearer ${qualityToken}`).send({ findings: "Torque spec confirmed out of tolerance.", rootCause: "Fastener supplier process drift." });
    expect(res.status).toBe(200);
    expect(res.body.findings).toBe("Torque spec confirmed out of tolerance.");
  });

  it("cannot skip a status (new -> warranty_review)", async () => {
    const res = await request(app).post(`/crar/${crarId}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "warranty_review" });
    expect(res.status).toBe(400);
  });

  it("engineering cannot move new -> quality_review (Quality's own stage)", async () => {
    const res = await request(app).post(`/crar/${crarId}/transition`).set("Authorization", `Bearer ${engineeringToken}`).send({ status: "quality_review" });
    expect(res.status).toBe(403);
  });

  it("quality moves new -> quality_review -> warranty_review", async () => {
    const first = await request(app).post(`/crar/${crarId}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "quality_review" });
    expect(first.status).toBe(200);
    const second = await request(app).post(`/crar/${crarId}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "warranty_review" });
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("warranty_review");
  });

  it("engineering (a real 'Warranty' department per PERMISSION_MATRIX.warranty) can complete the review", async () => {
    const res = await request(app).post(`/crar/${crarId}/transition`).set("Authorization", `Bearer ${engineeringToken}`).send({ status: "completed" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
  });

  it("a completed CRAR can no longer be edited", async () => {
    const res = await request(app).patch(`/crar/${crarId}`).set("Authorization", `Bearer ${qualityToken}`).send({ findings: "too late" });
    expect(res.status).toBe(400);
  });

  it("every transition is in the audit trail as a status_change", async () => {
    const rows = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Crar"), eq(auditTrail.entityId, crarId), eq(auditTrail.action, "status_change")));
    expect(rows.length).toBe(3); // new->quality_review, quality_review->warranty_review, warranty_review->completed
  });

  it("the create and update actions are also in the audit trail", async () => {
    const created = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Crar"), eq(auditTrail.entityId, crarId), eq(auditTrail.action, "create")));
    const updated = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Crar"), eq(auditTrail.entityId, crarId), eq(auditTrail.action, "update")));
    expect(created.length).toBe(1);
    expect(updated.length).toBeGreaterThan(0);
  });

  describe("module-specific RBAC build (2026-09-16): create/edit is now a live crar.write check, not hardcoded to quality alone", () => {
    it("sales_and_marketing (no crar access at all by default) cannot create a CRAR", async () => {
      const res = await request(app).post("/crar").set("Authorization", `Bearer ${salesToken}`).send({ customerName: "Should be blocked" });
      expect(res.status).toBe(403);
    });

    it("admin grants sales_and_marketing 'edit' on crar via the self-service API", async () => {
      const res = await request(app).patch("/permissions/department-permissions").set("Authorization", `Bearer ${adminToken}`).send({ departmentName: "sales_and_marketing", moduleName: "crar", accessLevel: "edit" });
      expect(res.status).toBe(200);
    });

    it("...and now sales_and_marketing can create AND fully edit a CRAR's content — not just link it", async () => {
      const create = await request(app).post("/crar").set("Authorization", `Bearer ${salesToken}`).send({ customerName: "New Capability Co", partNumber: "PN-NEW" });
      expect(create.status).toBe(201);
      const newId = create.body.id;

      const update = await request(app).patch(`/crar/${newId}`).set("Authorization", `Bearer ${salesToken}`).send({ findings: "sales_and_marketing can edit real content now" });
      expect(update.status).toBe(200);
      expect(update.body.findings).toBe("sales_and_marketing can edit real content now");
    });

    it("engineering/purchasing still stay link-only even with crar edit — the structural carve-out didn't change", async () => {
      const create = await request(app).post("/crar").set("Authorization", `Bearer ${engineeringToken}`).send({ customerName: "Should still be blocked" });
      expect(create.status).toBe(403);
    });

    it("revoking sales_and_marketing's crar access again blocks it", async () => {
      await request(app).delete("/permissions/department-permissions").set("Authorization", `Bearer ${adminToken}`).send({ departmentName: "sales_and_marketing", moduleName: "crar" });
      const res = await request(app).post("/crar").set("Authorization", `Bearer ${salesToken}`).send({ customerName: "Should be blocked again" });
      expect(res.status).toBe(403);
    });
  });

  describe("crar.workflow.write is a separate lever from crar.write", () => {
    let workflowTestId: number;

    it("set up a fresh CRAR through quality_review for this block", async () => {
      const created = await request(app).post("/crar").set("Authorization", `Bearer ${qualityToken}`).send({ customerName: "Workflow Permission Co" });
      workflowTestId = created.body.id;
      const transitioned = await request(app).post(`/crar/${workflowTestId}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "quality_review" });
      expect(transitioned.status).toBe(200);
    });

    it("admin elevates purchasing to crar edit but revokes its crar_workflow — purchasing keeps its link-only carve-out for content, and now can't transition either", async () => {
      const revoke = await request(app).patch("/permissions/department-permissions").set("Authorization", `Bearer ${adminToken}`).send({ departmentName: "purchasing", moduleName: "crar_workflow", accessLevel: "none" });
      expect(revoke.status).toBe(200);

      const transitioned = await request(app).post(`/crar/${workflowTestId}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "warranty_review" });
      expect(transitioned.status).toBe(200);

      const res = await request(app).post(`/crar/${workflowTestId}/transition`).set("Authorization", `Bearer ${purchasingToken}`).send({ status: "completed" });
      expect(res.status).toBe(403);

      const rows = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Crar"), eq(auditTrail.entityId, workflowTestId), eq(auditTrail.action, "permission_denied")));
      expect(rows.length).toBeGreaterThan(0);

      // Restore it explicitly — with no hardcoded fallback left anywhere in
      // this app (see departmentAccess.ts's own comment), DELETE now means
      // "none," full stop, not "revert to whatever the old default was."
      // Setting it back to "edit" is the only way to restore it.
      await request(app).patch("/permissions/department-permissions").set("Authorization", `Bearer ${adminToken}`).send({ departmentName: "purchasing", moduleName: "crar_workflow", accessLevel: "edit" });
    });

    it("with crar_workflow restored, purchasing can complete it", async () => {
      const res = await request(app).post(`/crar/${workflowTestId}/transition`).set("Authorization", `Bearer ${purchasingToken}`).send({ status: "completed" });
      expect(res.status).toBe(200);
    });
  });
});
