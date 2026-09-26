import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Covers the two forms reported as real gaps in the "ACCUQUAL Forms" batch
// review (see accuqual-qms-forms-batch memory) — SCAR (fixed-row CAPA/
// sign-off columns, no child table) and Quality Inspection Report (a real
// child table for its Inspection Checklist). SCAR was originally
// deliberately ungated but got a real RBAC gate (the new "scar"
// ResourceKey, all-departments-edit default — see defaultPermissions.ts)
// in a later security-audit pass, once QMS Forms' own identical "no gate"
// convention was fixed first and left SCAR's justification stale. Quality
// Inspection Reports got a real RBAC gate in Phase 8 (the new
// "quality_inspection" ResourceKey — quality: edit, purchasing/
// material_management: read) after that gap was flagged as a genuine
// zero-enforcement issue, not a deliberate design — see
// qualityInspectionReports.routes.ts's own comment.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { scarForms } from "../../src/drizzle/schema/scarForms.js";
import { qualityInspectionReports, qualityInspectionItems } from "../../src/drizzle/schema/qualityInspectionReports.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
const app = createApp();
const suffix = Date.now();

let companyId: number;
let scarId: number;
let reportId: number;
let itemId: number;
const userIds: number[] = [];

let productionToken: string;
let qualityToken: string;

async function makeUser(department: string | null) {
  const [user] = await db.insert(users).values({ email: `scar-insp-test-${department ?? "none"}-${suffix}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

describe("SCAR + Quality Inspection Report (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;

    await seedDefaultPermissions(companyId);
    productionToken = await makeUser("production"); // "scar"'s default grants every department edit access
    qualityToken = await makeUser("quality"); // quality_inspection's real edit-level department (Phase 8)
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("blocks a user with no department at all — the real RBAC gate, not just the all-departments default", async () => {
    const noDeptToken = await makeUser(null);
    const res = await request(app).post("/scar-forms").set("Authorization", `Bearer ${noDeptToken}`).send({ scarNumber: "SCAR-BLOCKED", supplierName: "Acme Metals" });
    expect(res.status).toBe(403);
  });

  it("creates a SCAR (production has real edit access under scar's all-departments default) and defaults to open", async () => {
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

  it("blocks a department with no quality_inspection access (Phase 8 RBAC gate)", async () => {
    const res = await request(app).post("/quality-inspection-reports").set("Authorization", `Bearer ${productionToken}`).send({ inspectionType: "incoming" });
    expect(res.status).toBe(403);
  });

  it("creates a Quality Inspection Report", async () => {
    const res = await request(app).post("/quality-inspection-reports").set("Authorization", `Bearer ${qualityToken}`).send({ inspectionType: "incoming" });
    expect(res.status).toBe(201);
    expect(res.body.inspectionType).toBe("incoming");
    reportId = res.body.id;
  });

  it("adds a real, freely-addable checklist row", async () => {
    const res = await request(app)
      .post(`/quality-inspection-reports/${reportId}/items`)
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ itemNumber: 1, parameter: "Visual Appearance", specification: "Free of scratches/defects" });
    expect(res.status).toBe(201);
    itemId = res.body.id;

    const detail = await request(app).get(`/quality-inspection-reports/${reportId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(detail.body.items.length).toBe(1);
  });

  it("records the result on that row", async () => {
    const res = await request(app).patch(`/quality-inspection-reports/${reportId}/items/${itemId}`).set("Authorization", `Bearer ${qualityToken}`).send({ actualFinding: "No defects observed", result: "pass" });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("pass");
  });

  it("sets the final disposition and sign-off", async () => {
    const res = await request(app).patch(`/quality-inspection-reports/${reportId}`).set("Authorization", `Bearer ${qualityToken}`).send({ finalStatus: "accepted", inspectorSignature: "R. Chen" });
    expect(res.status).toBe(200);
    expect(res.body.finalStatus).toBe("accepted");
  });

  it("removes the checklist row", async () => {
    const res = await request(app).delete(`/quality-inspection-reports/${reportId}/items/${itemId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(204);
    const [gone] = await db.select().from(qualityInspectionItems).where(eq(qualityInspectionItems.id, itemId));
    expect(gone).toBeUndefined();
  });

  it("deletes the report, cascading any remaining items, logged before it disappears", async () => {
    const res = await request(app).delete(`/quality-inspection-reports/${reportId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(204);
    const [gone] = await db.select().from(qualityInspectionReports).where(eq(qualityInspectionReports.id, reportId));
    expect(gone).toBeUndefined();
    reportId = 0;
  });
});
