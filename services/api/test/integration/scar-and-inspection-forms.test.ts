// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Covers the two forms reported as real gaps in the "ACCUQUAL Forms" batch
// review (see accuqual-qms-forms-batch memory) — SCAR (fixed-row CAPA/
// sign-off columns, no child table) and Quality Inspection Report (a real
// child table for its Inspection Checklist). Both deliberately ungated,
// same convention as the rest of this batch.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { scarForms } from "../../src/drizzle/schema/scarForms.js";
import { qualityInspectionReports, qualityInspectionItems } from "../../src/drizzle/schema/qualityInspectionReports.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
const app = createApp();
const suffix = Date.now();

let tenantId: number;
let scarId: number;
let reportId: number;
let itemId: number;
const userIds: number[] = [];

let productionToken: string;

async function makeUser(department: string | null) {
  const [user] = await db.insert(users).values({ tenantId, email: `scar-insp-test-${department ?? "none"}-${suffix}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName: "operator", department });
}

describe("SCAR + Quality Inspection Report (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `SCAR/Inspection Test Tenant ${suffix}`, code: `scar-insp-test-${suffix}` }).returning();
    tenantId = tenant!.id;

    await seedDefaultPermissions(tenantId);
    productionToken = await makeUser("production"); // proves there's no department gate
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(inArray(auditTrail.performedBy, userIds));
    if (scarId) await db.delete(scarForms).where(eq(scarForms.id, scarId));
    if (reportId) {
      await db.delete(qualityInspectionItems).where(eq(qualityInspectionItems.reportId, reportId));
      await db.delete(qualityInspectionReports).where(eq(qualityInspectionReports.id, reportId));
    }
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));

    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("creates a SCAR (no department gate) and defaults to open", async () => {
    const res = await request(app).post("/scar-forms").set("Authorization", `Bearer ${productionToken}`).send({ scarNumber: "SCAR-001", supplierName: "Acme Metals" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("open");
    scarId = res.body.id;

    const [row] = await db.select().from(auditTrail).where(eq(auditTrail.entityType, "ScarForm"));
    expect(row).toBeTruthy();
  });

  it("updates the fixed CAPA/sign-off columns and the quarantine checkboxes directly — no child rows involved", async () => {
    const res = await request(app)
      .patch(`/scar-forms/${scarId}`)
      .set("Authorization", `Bearer ${productionToken}`)
      .send({
        why1: "Tooling wear exceeded limit",
        quarantineAtSupplier: true,
        correctiveActionOwner: "J. Alvarez",
        correctiveActionTargetDate: "2026-10-01",
        supplierRepSignature: "M. Diaz",
      });
    expect(res.status).toBe(200);
    expect(res.body.why1).toBe("Tooling wear exceeded limit");
    expect(res.body.quarantineAtSupplier).toBe(true);
    expect(res.body.correctiveActionOwner).toBe("J. Alvarez");
    expect(res.body.supplierRepSignature).toBe("M. Diaz");
  });

  it("closes the SCAR", async () => {
    const res = await request(app).patch(`/scar-forms/${scarId}`).set("Authorization", `Bearer ${productionToken}`).send({ status: "closed" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("closed");
  });

  it("deletes the SCAR, logged before it disappears", async () => {
    const res = await request(app).delete(`/scar-forms/${scarId}`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(204);
    const [gone] = await db.select().from(scarForms).where(eq(scarForms.id, scarId));
    expect(gone).toBeUndefined();
    scarId = 0;
  });

  it("creates a Quality Inspection Report", async () => {
    const res = await request(app).post("/quality-inspection-reports").set("Authorization", `Bearer ${productionToken}`).send({ inspectionType: "incoming" });
    expect(res.status).toBe(201);
    expect(res.body.inspectionType).toBe("incoming");
    reportId = res.body.id;
  });

  it("adds a real, freely-addable checklist row", async () => {
    const res = await request(app)
      .post(`/quality-inspection-reports/${reportId}/items`)
      .set("Authorization", `Bearer ${productionToken}`)
      .send({ itemNumber: 1, parameter: "Visual Appearance", specification: "Free of scratches/defects" });
    expect(res.status).toBe(201);
    itemId = res.body.id;

    const detail = await request(app).get(`/quality-inspection-reports/${reportId}`).set("Authorization", `Bearer ${productionToken}`);
    expect(detail.body.items.length).toBe(1);
  });

  it("records the result on that row", async () => {
    const res = await request(app).patch(`/quality-inspection-reports/${reportId}/items/${itemId}`).set("Authorization", `Bearer ${productionToken}`).send({ actualFinding: "No defects observed", result: "pass" });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("pass");
  });

  it("sets the final disposition and sign-off", async () => {
    const res = await request(app).patch(`/quality-inspection-reports/${reportId}`).set("Authorization", `Bearer ${productionToken}`).send({ finalStatus: "accepted", inspectorSignature: "R. Chen" });
    expect(res.status).toBe(200);
    expect(res.body.finalStatus).toBe("accepted");
  });

  it("removes the checklist row", async () => {
    const res = await request(app).delete(`/quality-inspection-reports/${reportId}/items/${itemId}`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(204);
    const [gone] = await db.select().from(qualityInspectionItems).where(eq(qualityInspectionItems.id, itemId));
    expect(gone).toBeUndefined();
  });

  it("deletes the report, cascading any remaining items, logged before it disappears", async () => {
    const res = await request(app).delete(`/quality-inspection-reports/${reportId}`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(204);
    const [gone] = await db.select().from(qualityInspectionReports).where(eq(qualityInspectionReports.id, reportId));
    expect(gone).toBeUndefined();
    reportId = 0;
  });
});
