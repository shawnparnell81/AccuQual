// Real-DB integration test (see tenant-isolation.test.ts's header comment).
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
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { suppliers, supplierScorecards } from "../../src/drizzle/schema/supplier.js";
import { roles } from "../../src/drizzle/schema/roles.js";
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

const app = createApp();
const suffix = Date.now();

let tenantId: number;
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
    .values({ tenantId, email: `sp-test-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department })
    .returning();
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName, department });
}

async function getSupplierRoleId(): Promise<number> {
  const [supplierRole] = await db.select().from(roles).where(eq(roles.name, "supplier"));
  if (!supplierRole) throw new Error("'supplier' role is not seeded — check db/seed.ts");
  return supplierRole.id;
}

async function makeSupplierLogin(supplierId: number) {
  const roleId = await getSupplierRoleId();
  const [user] = await db
    .insert(users)
    .values({ tenantId, email: `sp-login-${suffix}-${supplierId}@test.local`, passwordHash: "unused", department: null, roleId, supplierId })
    .returning();
  return signAccessToken({ sub: String(user!.id), tenantId, roleId, roleName: "supplier", department: null, supplierId });
}

describe("Supplier Portal (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Supplier Portal Test Tenant ${suffix}`, code: `sp-test-${suffix}` }).returning();
    tenantId = tenant!.id;

    qualityToken = await makeInternalUser("quality");
    purchasingToken = await makeInternalUser("purchasing");
    engineeringToken = await makeInternalUser("engineering");

    const [supplierA] = await db.insert(suppliers).values({ tenantId, name: `Supplier A ${suffix}`, contactEmail: "a@supplier.test" }).returning();
    const [supplierB] = await db.insert(suppliers).values({ tenantId, name: `Supplier B ${suffix}`, contactEmail: "b@supplier.test" }).returning();
    supplierAId = supplierA!.id;
    supplierBId = supplierB!.id;
    supplierAToken = await makeSupplierLogin(supplierAId);
    supplierBToken = await makeSupplierLogin(supplierBId);

    const [ncrRow] = await db.insert(ncr).values({ tenantId, title: `Supplier Portal Test NCR ${suffix}`, status: "open" }).returning();
    ncrId = ncrRow!.id;
    // Real link: an RMA against Supplier A referencing this NCR — the
    // derivation supplierNcrListHandler reads (see its own comment).
    await db.insert(rma).values({ tenantId, rmaNumber: `RMA-SPTEST-${suffix}`, supplierId: supplierAId, linkedNcrId: ncrId });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(supplierMessages).where(eq(supplierMessages.tenantId, tenantId));
    await db.delete(supplier8dResponses).where(eq(supplier8dResponses.tenantId, tenantId));
    await db.delete(supplierCorrectiveActions).where(eq(supplierCorrectiveActions.tenantId, tenantId));
    await db.delete(supplierPpapSubmissions).where(eq(supplierPpapSubmissions.tenantId, tenantId));
    await db.delete(supplierDocuments).where(eq(supplierDocuments.tenantId, tenantId));
    await db.delete(supplierOnboardingDocuments).where(eq(supplierOnboardingDocuments.tenantId, tenantId));
    await db.delete(rma).where(eq(rma.tenantId, tenantId));
    await db.delete(ncr).where(eq(ncr.tenantId, tenantId));
    await db.delete(supplierScorecards).where(eq(supplierScorecards.tenantId, tenantId));
    // users before suppliers — users.supplierId (Supplier Portal logins) FKs into it.
    await db.delete(users).where(eq(users.tenantId, tenantId));
    await db.delete(suppliers).where(eq(suppliers.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
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
    const [orphan] = await db.insert(users).values({ tenantId, email: `orphan-${suffix}@test.local`, passwordHash: "unused", roleId, department: null }).returning();
    const orphanToken = signAccessToken({ sub: String(orphan!.id), tenantId, roleId, roleName: "supplier", department: null, supplierId: null });
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
    await db.insert(supplierScorecards).values({ tenantId, supplierId: supplierAId, period: "2026-Q1", qualityScore: "92", deliveryScore: "88", overallScore: "90" });
    const scorecard = await request(app).get("/supplier-portal/scorecard").set("Authorization", `Bearer ${supplierAToken}`);
    expect(scorecard.status).toBe(200);
    expect(scorecard.body).toHaveLength(1);

    const performance = await request(app).get("/supplier-portal/performance").set("Authorization", `Bearer ${supplierAToken}`);
    expect(performance.status).toBe(200);
    expect(performance.body.ppapApprovalRate).toBe(100);
    expect(performance.body.correctiveActionAcceptedCount).toBe(1);
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
    const rows = await db.select().from(auditTrail).where(and(eq(auditTrail.tenantId, tenantId), eq(auditTrail.action, "status_change")));
    const entityTypes = rows.map((r) => r.entityType);
    expect(entityTypes).toContain("SupplierOnboardingDocument");
    expect(entityTypes).toContain("SupplierPpapSubmission");
    expect(entityTypes).toContain("SupplierCorrectiveAction");
    expect(entityTypes).toContain("Supplier8dResponse");
  });
});
