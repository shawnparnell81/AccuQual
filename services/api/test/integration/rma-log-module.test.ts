import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Covers the real, manually-maintained RMA Log register (module-specific
// RBAC build, 2026-09-16) — NOT the automated Supplier RMA Request event
// trail, which was renamed to rma_activity_log at the same time (see
// supplier-rma-request.test.ts for that). Covers the "Add New" endpoint's
// auto-generated rmaNumber/dateIssued, the full 17-column field list, the
// fixed status workflow (with auto-stamped dateReceived/dateClosed), the
// separate rma_log.status.write / rma_log.linkage.write sub-permissions
// layered on top of the base rma_log.read/write level, warranty/supplier-
// request/quality linkage, filters/search, and permission_denied audit
// logging.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { rmaLogRecords } from "../../src/drizzle/schema/rmaLog.js";
import { warrantyClaims } from "../../src/drizzle/schema/warranty.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;
let qualityToken: string;
let customerServiceToken: string;
let engineeringToken: string;
let productionToken: string;
let adminToken: string;
let warrantyClaimId: number;
let recordId: number;

async function makeUser(department: string | null, roleName = "operator") {
  const [user] = await db.insert(users).values({ email: `rmalog-test-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department }).returning();
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department });
}

describe("RMA Log module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    await seedDefaultPermissions(companyId);

    qualityToken = await makeUser("quality");
    customerServiceToken = await makeUser("customer_service");
    engineeringToken = await makeUser("engineering");
    productionToken = await makeUser("production");
    adminToken = await makeUser(null, "admin");

    const [claim] = await db.insert(warrantyClaims).values({ claimNumber: `WC-RMALOGTEST-${suffix}`, status: "new" }).returning();
    warrantyClaimId = claim!.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("production (no rma_log access at all by default) cannot list", async () => {
    const res = await request(app).get("/rma-log").set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(403);
  });

  it("engineering (read-only by default) can list but not create", async () => {
    const list = await request(app).get("/rma-log").set("Authorization", `Bearer ${engineeringToken}`);
    expect(list.status).toBe(200);
    const create = await request(app).post("/rma-log").set("Authorization", `Bearer ${engineeringToken}`).send({ customerName: "Should be blocked" });
    expect(create.status).toBe(403);
  });

  it("\"Add New\": quality creates an entry with just a customer name — rmaNumber and dateIssued are auto-generated", async () => {
    const res = await request(app).post("/rma-log").set("Authorization", `Bearer ${qualityToken}`).send({ customerName: "Acme Co", partNumber: "PN-100", customerReasonForReturn: "Cracked housing" });
    expect(res.status).toBe(201);
    expect(res.body.rmaNumber).toMatch(/^RMA-\d{4}-\d{4}$/);
    expect(res.body.dateIssued).toBeTruthy();
    expect(res.body.status).toBe("open");
    recordId = res.body.id;
  });

  it("the create was recorded in the audit trail", async () => {
    const rows = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "RmaLog"), eq(auditTrail.action, "create")));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("GET /rma-log/:id returns the full record", async () => {
    const res = await request(app).get(`/rma-log/${recordId}`).set("Authorization", `Bearer ${customerServiceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.customerName).toBe("Acme Co");
    expect(res.body.warranty).toBeNull();
  });

  it("customer service edits content fields (base rma_log.write)", async () => {
    const res = await request(app).patch(`/rma-log/${recordId}`).set("Authorization", `Bearer ${customerServiceToken}`).send({ trackingNumber: "1Z999AA10123456784", quantityReturned: 2 });
    expect(res.status).toBe(200);
    expect(res.body.trackingNumber).toBe("1Z999AA10123456784");
  });

  describe("rma_log.linkage.write is a separate, narrower permission than rma_log.write", () => {
    it("admin elevates engineering to rma_log edit — but NOT rma_log_linkage", async () => {
      const res = await request(app).patch("/permissions/department-permissions").set("Authorization", `Bearer ${adminToken}`).send({ departmentName: "engineering", moduleName: "rma_log", accessLevel: "edit" });
      expect(res.status).toBe(200);
    });

    it("engineering can now edit content fields...", async () => {
      const res = await request(app).patch(`/rma-log/${recordId}`).set("Authorization", `Bearer ${engineeringToken}`).send({ qualityTeamFindings: "Root cause: injection mold defect" });
      expect(res.status).toBe(200);
    });

    it("...but is blocked from touching linkage fields, and it's logged as permission_denied", async () => {
      const res = await request(app).patch(`/rma-log/${recordId}`).set("Authorization", `Bearer ${engineeringToken}`).send({ warrantyId: warrantyClaimId });
      expect(res.status).toBe(403);

      const rows = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "RmaLog"), eq(auditTrail.action, "permission_denied")));
      expect(rows.some((r) => (r.changes as Record<string, unknown>).attemptedAction === "update_linkage")).toBe(true);
    });

    it("quality (which DOES have rma_log_linkage by default) can link it to the real warranty claim", async () => {
      const res = await request(app).patch(`/rma-log/${recordId}`).set("Authorization", `Bearer ${qualityToken}`).send({ warrantyId: warrantyClaimId });
      expect(res.status).toBe(200);
      expect(res.body.warrantyId).toBe(warrantyClaimId);

      const get = await request(app).get(`/rma-log/${recordId}`).set("Authorization", `Bearer ${qualityToken}`);
      expect(get.body.warranty.id).toBe(warrantyClaimId);
    });

    it("linking to a nonexistent warranty claim is rejected", async () => {
      const res = await request(app).patch(`/rma-log/${recordId}`).set("Authorization", `Bearer ${qualityToken}`).send({ warrantyId: 999999999 });
      expect(res.status).toBe(400);
    });
  });

  describe("status workflow: rma_log.status.write, separate again from rma_log.write", () => {
    it("cannot skip straight from open to closed", async () => {
      const res = await request(app).post(`/rma-log/${recordId}/status`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "closed" });
      expect(res.status).toBe(400);
    });

    it("engineering has rma_log edit but NOT rma_log_status — blocked from transitioning, logged as permission_denied", async () => {
      const res = await request(app).post(`/rma-log/${recordId}/status`).set("Authorization", `Bearer ${engineeringToken}`).send({ status: "received" });
      expect(res.status).toBe(403);

      const rows = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "RmaLog"), eq(auditTrail.action, "permission_denied")));
      expect(rows.some((r) => (r.changes as Record<string, unknown>).attemptedAction === "status_change")).toBe(true);
    });

    it("quality moves it to received — dateReceived is server-stamped automatically", async () => {
      const res = await request(app).post(`/rma-log/${recordId}/status`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "received" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("received");
      expect(res.body.dateReceived).toBeTruthy();
    });

    it("walks under_review -> dispositioned -> closed, stamping dateClosed automatically", async () => {
      await request(app).post(`/rma-log/${recordId}/status`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "under_review" });
      const disposition = await request(app).post(`/rma-log/${recordId}/status`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "dispositioned" });
      expect(disposition.status).toBe(200);

      const closed = await request(app).post(`/rma-log/${recordId}/status`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "closed" });
      expect(closed.status).toBe(200);
      expect(closed.body.dateClosed).toBeTruthy();
    });

    it("a closed record can no longer be edited", async () => {
      const res = await request(app).patch(`/rma-log/${recordId}`).set("Authorization", `Bearer ${qualityToken}`).send({ correctiveAction: "Too late" });
      expect(res.status).toBe(400);
    });
  });

  describe("list filters and search", () => {
    it("filters by status and searches by rmaNumber", async () => {
      const byStatus = await request(app).get("/rma-log").set("Authorization", `Bearer ${qualityToken}`).query({ status: "closed" });
      expect(byStatus.body.some((r: { id: number }) => r.id === recordId)).toBe(true);

      const rmaNumber = (await request(app).get(`/rma-log/${recordId}`).set("Authorization", `Bearer ${qualityToken}`)).body.rmaNumber;
      const bySearch = await request(app).get("/rma-log").set("Authorization", `Bearer ${qualityToken}`).query({ q: rmaNumber.slice(-4) });
      expect(bySearch.body.some((r: { id: number }) => r.id === recordId)).toBe(true);
    });
  });
});
