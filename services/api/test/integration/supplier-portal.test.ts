import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Covers the Supplier Portal's two real audiences: an external supplier
// login (roleName:"supplier", auto-scoped server-side to its own
// supplierId — the actual "strict RBAC isolation" the module needs) and
// internal staff (Quality/Purchasing edit, Engineering read). Exercises
// onboarding uploads + review, PPAP submit + per-document attach + review,
// Corrective Action + 8D responses + review, threaded messaging with real
// read receipts, scorecard/performance reads, derived NCR/CAPA visibility,
// settings, the real POST /suppliers/:id/portal-account login-creation
// endpoint, and the one rule that matters most: supplier A can never see
// supplier B's data.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { suppliers, supplierScorecards } from "../../src/drizzle/schema/supplier.js";
import { ensureSupplierRole } from "../../src/modules/supplier/supplier.controller.js";
import { rma } from "../../src/drizzle/schema/rma.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import {
  supplierOnboardingDocuments,
  supplierDocuments,
  supplierPpapSubmissions,
  supplierCorrectiveActions,
  supplier8dResponses,
  supplierMessages,
} from "../../src/drizzle/schema/supplierPortal.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
const app = createApp();
const suffix = Date.now();

let companyId: number;
let supplierAId: number;
let supplierBId: number;
let supplierAToken: string;
let supplierBToken: string;
let qualityToken: string;
let purchasingToken: string;
let engineeringToken: string;
let ncrId: number;
let ppapId: number;
let carId: number;
let eightDResponseId: number;
let onboardingDocId: number;

async function makeInternalUser(department: string, roleName = "operator") {
  const [user] = await db
    .insert(users)
    .values({ email: `sp-test-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department })
    .returning();
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department });
}

// Self-heals the role instead of assuming db/seed.ts has run — CI's fresh
// database only runs migrations, never the separate seed step (see
// ensureSupplierRole's own comment). `db` here is the plain, unscoped
// singleton (this file never opens its own company transaction), which
// ensureSupplierRole accepts fine since `roles` isn't company-scoped.
async function getSupplierRoleId(): Promise<number> {
  return (await ensureSupplierRole(db)).id;
}

async function makeSupplierLogin(supplierId: number) {
  const roleId = await getSupplierRoleId();
  const [user] = await db
    .insert(users)
    .values({ email: `sp-login-${suffix}-${supplierId}@test.local`, passwordHash: "unused", department: null, roleId, supplierId })
    .returning();
  return signAccessToken({ sub: String(user!.id), roleId, roleName: "supplier", department: null, supplierId });
}

describe("Supplier Portal (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;

    await seedDefaultPermissions(companyId);

    qualityToken = await makeInternalUser("quality");
    purchasingToken = await makeInternalUser("purchasing");
    engineeringToken = await makeInternalUser("engineering");

    const [supplierA] = await db.insert(suppliers).values({ name: `Supplier A ${suffix}`, contactEmail: "a@supplier.test" }).returning();
    const [supplierB] = await db.insert(suppliers).values({ name: `Supplier B ${suffix}`, contactEmail: "b@supplier.test" }).returning();
    supplierAId = supplierA!.id;
    supplierBId = supplierB!.id;
    supplierAToken = await makeSupplierLogin(supplierAId);
    supplierBToken = await makeSupplierLogin(supplierBId);

    const [ncrRow] = await db.insert(ncr).values({ title: `Supplier Portal Test NCR ${suffix}`, status: "open" }).returning();
    ncrId = ncrRow!.id;
    // Real link: an RMA against Supplier A referencing this NCR — the
    // derivation supplierNcrListHandler reads (see its own comment).
    await db.insert(rma).values({ rmaNumber: `RMA-SPTEST-${suffix}`, supplierId: supplierAId, linkedNcrId: ncrId });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    // users before suppliers — users.supplierId (Supplier Portal logins) FKs into it.
    await pool.end();
  });

  it("quality can create a real external supplier login via POST /suppliers/:id/portal-account", async () => {
    const res = await request(app).post(`/suppliers/${supplierAId}/portal-account`).set("Authorization", `Bearer ${qualityToken}`).send({ email: `new-login-${suffix}@supplier.test` });
    expect(res.status).toBe(201);
    expect(res.body.user.supplierId).toBe(supplierAId);
    expect(res.body.temporaryPassword).toBeTruthy();
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("purchasing (read-only on the suppliers module) cannot create a portal login", async () => {
    const res = await request(app).post(`/suppliers/${supplierAId}/portal-account`).set("Authorization", `Bearer ${purchasingToken}`).send({ email: `blocked-${suffix}@supplier.test` });
    expect(res.status).toBe(403);
  });

  it("a misconfigured supplier login (no supplierId) is rejected by the portal gate", async () => {
    const roleId = await getSupplierRoleId();
    const [orphan] = await db.insert(users).values({ email: `orphan-${suffix}@test.local`, passwordHash: "unused", roleId, department: null }).returning();
    const orphanToken = signAccessToken({ sub: String(orphan!.id), roleId, roleName: "supplier", department: null, supplierId: null });
    const res = await request(app).get("/supplier-portal/documents/list").set("Authorization", `Bearer ${orphanToken}`);
    expect(res.status).toBe(403);
  });

  it("supplier A uploads an onboarding document, scoped to itself with no supplierId needed in the request", async () => {
    const res = await request(app).post("/supplier-portal/onboarding/upload").set("Authorization", `Bearer ${supplierAToken}`).field("documentType", "w9").attach("file", Buffer.from("fake w9"), "w9.pdf");
    expect(res.status).toBe(201);
    expect(res.body.supplierId).toBe(supplierAId);
    onboardingDocId = res.body.id;
  });

  it("supplier B cannot see supplier A's onboarding status", async () => {
    const res = await request(app).get("/supplier-portal/onboarding/status").set("Authorization", `Bearer ${supplierBToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("internal staff sees onboarding status across every supplier when no filter is given", async () => {
    const res = await request(app).get("/supplier-portal/onboarding/status").set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((d: { supplierId: number }) => d.supplierId === supplierAId)).toBe(true);
  });

  it("engineering (read-only on the Supplier Portal) cannot review an onboarding document", async () => {
    const res = await request(app).post(`/supplier-portal/onboarding/${onboardingDocId}/review`).set("Authorization", `Bearer ${engineeringToken}`).send({ status: "approved" });
    expect(res.status).toBe(403);
  });

  it("quality approves the onboarding document", async () => {
    const res = await request(app).post(`/supplier-portal/onboarding/${onboardingDocId}/review`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "approved", reviewNotes: "Looks good" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
  });

  it("supplier A cannot forge another supplier's id onto a document upload — the server always uses their own", async () => {
    const res = await request(app)
      .post("/supplier-portal/documents/upload")
      .set("Authorization", `Bearer ${supplierAToken}`)
      .field("name", "Updated ISO Cert")
      .field("supplierId", String(supplierBId)) // attempted forgery
      .attach("file", Buffer.from("fake cert"), "cert.pdf");
    expect(res.status).toBe(201);
    expect(res.body.supplierId).toBe(supplierAId); // not supplierBId
  });

  it("submits a Level 3 PPAP, attaches a named document (PSW), and internal staff can review it", async () => {
    const submit = await request(app).post("/supplier-portal/ppap/submit").set("Authorization", `Bearer ${supplierAToken}`).send({ level: 3, partNumber: "PN-100" });
    expect(submit.status).toBe(201);
    ppapId = submit.body.id;

    const attach = await request(app).post(`/supplier-portal/ppap/${ppapId}/documents`).set("Authorization", `Bearer ${supplierAToken}`).field("documentType", "psw").attach("file", Buffer.from("fake psw"), "psw.pdf");
    expect(attach.status).toBe(200);
    expect(attach.body.documents.psw.fileName).toBe("psw.pdf");

    const forbiddenReview = await request(app).post(`/supplier-portal/ppap/${ppapId}/review`).set("Authorization", `Bearer ${supplierAToken}`).send({ status: "approved" });
    expect(forbiddenReview.status).toBe(403);

    const review = await request(app).post(`/supplier-portal/ppap/${ppapId}/review`).set("Authorization", `Bearer ${purchasingToken}`).send({ status: "approved", reviewNotes: "Dimensional results acceptable" });
    expect(review.status).toBe(200);
    expect(review.body.status).toBe("approved");
  });

  it("supplier B cannot attach a document to supplier A's PPAP submission", async () => {
    const res = await request(app).post(`/supplier-portal/ppap/${ppapId}/documents`).set("Authorization", `Bearer ${supplierBToken}`).field("documentType", "dfmea").attach("file", Buffer.from("x"), "dfmea.pdf");
    expect(res.status).toBe(403);
  });

  it("supplier A responds to a Corrective Action linked to the real NCR, and quality reviews it", async () => {
    const respond = await request(app)
      .post("/supplier-portal/corrective-actions/respond")
      .set("Authorization", `Bearer ${supplierAToken}`)
      .send({ linkedNcrId: ncrId, problemDescription: "Wrong tolerance on batch 44", rootCause: "Tooling wear", correctiveAction: "Replaced tooling" });
    expect(respond.status).toBe(201);
    carId = respond.body.id;
    expect(respond.body.data.rootCause).toBe("Tooling wear");

    const review = await request(app).post(`/supplier-portal/corrective-actions/${carId}/review`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "accepted" });
    expect(review.status).toBe(200);
    expect(review.body.status).toBe("accepted");
  });

  it("supplier A submits a full 8D response with the D1-D8 fields", async () => {
    const res = await request(app).post("/supplier-portal/8d/submit").set("Authorization", `Bearer ${supplierAToken}`).send({
      linkedNcrId: ncrId,
      d1_team: "J. Smith, quality lead",
      d2_problem: "Out-of-spec dimension",
      d3_containment: "100% sort of remaining stock",
      d4_rootCause: "Fixture drift",
      d5_correctiveAction: "Fixture recalibrated",
      d6_validation: "50-piece run confirmed in spec",
      d7_prevention: "Added fixture check to PM schedule",
      d8_closure: "Team recognized, case closed",
    });
    expect(res.status).toBe(201);
    eightDResponseId = res.body.id;
    expect(res.body.data.d4_rootCause).toBe("Fixture drift");

    const status = await request(app).get("/supplier-portal/8d/status").set("Authorization", `Bearer ${supplierAToken}`);
    expect(status.body).toHaveLength(1);
  });

  it("purchasing reviews the 8D response", async () => {
    const res = await request(app).post(`/supplier-portal/8d/${eightDResponseId}/review`).set("Authorization", `Bearer ${purchasingToken}`).send({ status: "accepted", reviewNotes: "Thorough response" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");
  });

  it("threaded messaging: internal staff sends, supplier reads (marking it read), supplier replies", async () => {
    const fromStaff = await request(app).post("/supplier-portal/messages/send").set("Authorization", `Bearer ${qualityToken}`).send({ supplierId: supplierAId, body: "Please confirm PPAP timeline." });
    expect(fromStaff.status).toBe(201);
    expect(fromStaff.body.senderRole).toBe("internal");

    const supplierReadsThread = await request(app).get("/supplier-portal/messages/thread").set("Authorization", `Bearer ${supplierAToken}`);
    expect(supplierReadsThread.status).toBe(200);
    expect(supplierReadsThread.body).toHaveLength(1);
    expect(supplierReadsThread.body[0].readAt).not.toBeNull();

    const reply = await request(app).post("/supplier-portal/messages/send").set("Authorization", `Bearer ${supplierAToken}`).send({ body: "Confirmed — shipping next week." });
    expect(reply.status).toBe(201);
    expect(reply.body.senderRole).toBe("supplier");
    expect(reply.body.supplierId).toBe(supplierAId);
  });

  it("supplier B's thread is empty — messages are isolated per supplier", async () => {
    const res = await request(app).get("/supplier-portal/messages/thread").set("Authorization", `Bearer ${supplierBToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("scorecard + performance read real data scoped to the caller's own supplier", async () => {
    await db.insert(supplierScorecards).values({ supplierId: supplierAId, period: "2026-Q1", qualityScore: "92", deliveryScore: "88", overallScore: "90" });
    const scorecard = await request(app).get("/supplier-portal/scorecard").set("Authorization", `Bearer ${supplierAToken}`);
    expect(scorecard.status).toBe(200);
    expect(scorecard.body).toHaveLength(1);

    const performance = await request(app).get("/supplier-portal/performance").set("Authorization", `Bearer ${supplierAToken}`);
    expect(performance.status).toBe(200);
    expect(performance.body.ppapApprovalRate).toBe(100);
    expect(performance.body.correctiveActionAcceptedCount).toBe(1);
  });

  // The new Scorecard entry form (SupplierScorecard.tsx) calls this real
  // write path — POST /suppliers/:id/scorecard, on the Suppliers router,
  // not /supplier-portal (that side stays read-only). Quality/admin get
  // edit on "suppliers"; Purchasing/Engineering are read-only there even
  // though they can browse the portal itself.
  it("quality can add a real scorecard entry via POST /suppliers/:id/scorecard, and it's audited", async () => {
    const res = await request(app)
      .post(`/suppliers/${supplierAId}/scorecard`)
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ period: `2026-Q2-${suffix}`, qualityScore: 95, deliveryScore: 85, notes: "Strong quarter." });
    expect(res.status).toBe(201);
    expect(res.body.overallScore).toBe("90");

    const trail = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "SupplierScorecard"), eq(auditTrail.entityId, res.body.id)));
    expect(trail.some((t) => t.action === "create")).toBe(true);

    const portalRead = await request(app).get("/supplier-portal/scorecard").set("Authorization", `Bearer ${supplierAToken}`);
    expect(portalRead.body.some((r: { id: number }) => r.id === res.body.id)).toBe(true);
  });

  it("purchasing (read-only on suppliers) cannot add a scorecard entry", async () => {
    const res = await request(app).post(`/suppliers/${supplierAId}/scorecard`).set("Authorization", `Bearer ${purchasingToken}`).send({ period: "2026-Q3", qualityScore: 50, deliveryScore: 50 });
    expect(res.status).toBe(403);
  });

  it("a scorecard entry added for supplier A never appears in supplier B's own read", async () => {
    const res = await request(app).post(`/suppliers/${supplierAId}/scorecard`).set("Authorization", `Bearer ${qualityToken}`).send({ period: `2026-Q4-${suffix}`, qualityScore: 70, deliveryScore: 70 });
    expect(res.status).toBe(201);

    const bRead = await request(app).get("/supplier-portal/scorecard").set("Authorization", `Bearer ${supplierBToken}`);
    expect(bRead.body.some((r: { id: number }) => r.id === res.body.id)).toBe(false);
  });

  it("derived NCR/CAPA visibility: supplier A sees the real NCR linked via its RMA; supplier B sees none", async () => {
    const aList = await request(app).get("/supplier-portal/ncr/list").set("Authorization", `Bearer ${supplierAToken}`);
    expect(aList.status).toBe(200);
    expect(aList.body.map((n: { id: number }) => n.id)).toContain(ncrId);

    const bList = await request(app).get("/supplier-portal/ncr/list").set("Authorization", `Bearer ${supplierBToken}`);
    expect(bList.body).toHaveLength(0);
  });

  it("settings: supplier A can read and update its own contact email; cannot touch supplier B's", async () => {
    const get = await request(app).get("/supplier-portal/settings").set("Authorization", `Bearer ${supplierAToken}`);
    expect(get.status).toBe(200);
    expect(get.body.contactEmail).toBe("a@supplier.test");

    const update = await request(app).post("/supplier-portal/settings").set("Authorization", `Bearer ${supplierAToken}`).send({ contactEmail: "updated-a@supplier.test" });
    expect(update.status).toBe(200);
    expect(update.body.contactEmail).toBe("updated-a@supplier.test");

    const [row] = await db.select().from(suppliers).where(eq(suppliers.id, supplierBId));
    expect(row!.contactEmail).toBe("b@supplier.test"); // untouched
  });

  it("real audit trail entries exist for the review actions (status_change)", async () => {
    const rows = await db.select().from(auditTrail).where(and(eq(auditTrail.action, "status_change")));
    const entityTypes = rows.map((r) => r.entityType);
    expect(entityTypes).toContain("SupplierOnboardingDocument");
    expect(entityTypes).toContain("SupplierPpapSubmission");
    expect(entityTypes).toContain("SupplierCorrectiveAction");
    expect(entityTypes).toContain("Supplier8dResponse");
  });
});
