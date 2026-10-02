import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Covers the Document Change Request module — a real, ungated QMS-document
// revision-control record (deliberately NOT built through the shared
// FormLayout engine, see documentChangeRequests.ts's schema comment): the
// header CRUD, the repeatable "Change Request" items sub-resource, the
// repeatable "Review & Approval" reviews sub-resource (whose reviewDate is
// always server-stamped, never client-supplied — same pattern as Work
// Order's operation signOffDate), and full delete (no department gate at
// all, same convention as Document Control itself).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { documentChangeRequests, documentChangeItems, documentChangeReviews } from "../../src/drizzle/schema/documentChangeRequests.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { setTestPin, TEST_PIN } from "../helpers/signaturePin.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
const app = createApp();
const suffix = Date.now();

let companyId: number;
let dcrId: number;
let itemId: number;
let reviewId: number;
let productionUserId: number;
const userIds: number[] = [];

let productionToken: string; // no department gate at all — any authenticated user should work

async function makeUser(department: string | null) {
  const [user] = await db.insert(users).values({ email: `dcr-test-${department ?? "none"}-${suffix}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return { id: user!.id, token: signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department }) };
}

describe("Document Change Request (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;

    await seedDefaultPermissions(companyId);
    const production = await makeUser("production"); // deliberately a department NOT in most PERMISSION_MATRIX entries — proves this module really is ungated
    productionUserId = production.id;
    productionToken = production.token;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("any authenticated user can create one — no department gate at all", async () => {
    const res = await request(app)
      .post("/document-change-requests")
      .set("Authorization", `Bearer ${productionToken}`)
      .send({ formNo: "SOP-014", revision: "REV C", preparedBy: "J. Smith" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.revision).toBe("B");
    expect(res.body.actionNew).toBe(false);
    expect(res.body.requesterApprovalSignature).toBeNull();
    dcrId = res.body.id;

    const [row] = await db.select().from(auditTrail).where(eq(auditTrail.entityType, "DocumentChangeRequest"));
    expect(row).toBeTruthy();
    expect(row!.action).toBe("create");
  });

  it("updates the header, including the status checkboxes", async () => {
    const res = await request(app).patch(`/document-change-requests/${dcrId}`).set("Authorization", `Bearer ${productionToken}`).send({ status: "active", approvedBy: "R. Lee", revision: "REV Z" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
    expect(res.body.approvedBy).toBe("R. Lee");
    expect(res.body.revision).toBe("B");
  });

  it("saves the DCR-F-001 requester fields and ignores a forged signature", async () => {
    const res = await request(app)
      .patch(`/document-change-requests/${dcrId}`)
      .set("Authorization", `Bearer ${productionToken}`)
      .send({
        requesterName: "J. Smith",
        requesterTitle: "Quality Tech",
        actionRevision: true,
        docTypeSop: true,
        documentProcessName: "Welding SOP",
        currentDocNumber: "SOP-014",
        currentDocRev: "B",
        changeDescription: "New torque spec",
        newDocRev: "C",
        requestExecutedBy: "A. Nguyen",
        requestExecutedTitle: "Document Control",
        requesterApprovalSignature: "forged",
        vpApprovalSignature: "forged",
      });
    expect(res.status).toBe(200);
    expect(res.body.requesterName).toBe("J. Smith");
    expect(res.body.actionRevision).toBe(true);
    expect(res.body.docTypeSop).toBe(true);
    expect(res.body.documentProcessName).toBe("Welding SOP");
    expect(res.body.currentDocNumber).toBe("SOP-014");
    expect(res.body.changeDescription).toBe("New torque spec");
    expect(res.body.requestExecutedBy).toBe("A. Nguyen");
    expect(res.body.requesterApprovalSignature).toBeNull();
    expect(res.body.vpApprovalSignature).toBeNull();
  });

  it("adds a Change Request row", async () => {
    const res = await request(app)
      .post(`/document-change-requests/${dcrId}/items`)
      .set("Authorization", `Bearer ${productionToken}`)
      .send({ changeId: "DCR-1", documentProcess: "Welding SOP", currentRevision: "B", proposedRevision: "C", reason: "New torque spec", requestedBy: "J. Smith" });
    expect(res.status).toBe(201);
    itemId = res.body.id;

    const detail = await request(app).get(`/document-change-requests/${dcrId}`).set("Authorization", `Bearer ${productionToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.items.length).toBe(1);
    expect(detail.body.items[0].documentProcess).toBe("Welding SOP");
  });

  it("adds a Review & Approval row — reviewDate is only stamped once a decision is recorded", async () => {
    const created = await request(app).post(`/document-change-requests/${dcrId}/reviews`).set("Authorization", `Bearer ${productionToken}`).send({ reviewer: "M. Torres" });
    expect(created.status).toBe(201);
    expect(created.body.reviewDate).toBeNull();
    reviewId = created.body.id;

    const decided = await request(app).patch(`/document-change-requests/${dcrId}/reviews/${reviewId}`).set("Authorization", `Bearer ${productionToken}`).send({ decision: "Approved" });
    expect(decided.status).toBe(200);
    expect(decided.body.decision).toBe("Approved");
    expect(decided.body.reviewDate).toBeTruthy();
  });

  it("re-editing a decided review's other fields does not re-stamp reviewDate", async () => {
    const first = await request(app).get(`/document-change-requests/${dcrId}`).set("Authorization", `Bearer ${productionToken}`);
    const firstStamp = first.body.reviews.find((r: { id: number }) => r.id === reviewId).reviewDate;

    const res = await request(app).patch(`/document-change-requests/${dcrId}/reviews/${reviewId}`).set("Authorization", `Bearer ${productionToken}`).send({ comments: "No further impact identified." });
    expect(res.status).toBe(200);
    expect(res.body.reviewDate).toBe(firstStamp);
  });

  it("stamps a SIGN cell only through the PIN certification flow", async () => {
    await setTestPin(productionUserId);
    const refused = await request(app)
      .post(`/document-change-requests/${dcrId}/sign`)
      .set("Authorization", `Bearer ${productionToken}`)
      .send({ field: "cpio", pin: TEST_PIN, certified: true });
    expect(refused.status).toBe(400);

    const missingBox = await request(app)
      .post(`/document-change-requests/${dcrId}/sign`)
      .set("Authorization", `Bearer ${productionToken}`)
      .send({ field: "requester", pin: TEST_PIN, certified: false });
    expect(missingBox.status).toBe(400);

    const signed = await request(app)
      .post(`/document-change-requests/${dcrId}/sign`)
      .set("Authorization", `Bearer ${productionToken}`)
      .send({ field: "requester", pin: TEST_PIN, certified: true });
    expect(signed.status).toBe(200);
    expect(signed.body.requesterApprovalSignature).toContain("dcr-test-production-");
    expect(signed.body.requesterApprovalSignature.length).toBeGreaterThan(3);
    expect(signed.body.requesterApprovalDate).toBeTruthy();
    expect(signed.body.vpApprovalSignature).toBeNull();

    const kept = await request(app)
      .patch(`/document-change-requests/${dcrId}`)
      .set("Authorization", `Bearer ${productionToken}`)
      .send({ requesterTitle: "Quality Technician", requesterApprovalSignature: "forged" });
    expect(kept.status).toBe(200);
    expect(kept.body.requesterTitle).toBe("Quality Technician");
    expect(kept.body.requesterApprovalSignature).toBe(signed.body.requesterApprovalSignature);
  });

  it("removes the Change Request row", async () => {
    const res = await request(app).delete(`/document-change-requests/${dcrId}/items/${itemId}`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(204);
    const [gone] = await db.select().from(documentChangeItems).where(eq(documentChangeItems.id, itemId));
    expect(gone).toBeUndefined();
  });

  it("deletes the whole record, cascading its rows, logged before it disappears", async () => {
    const res = await request(app).delete(`/document-change-requests/${dcrId}`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(204);

    const [gone] = await db.select().from(documentChangeRequests).where(eq(documentChangeRequests.id, dcrId));
    expect(gone).toBeUndefined();
    const remainingReviews = await db.select().from(documentChangeReviews).where(eq(documentChangeReviews.documentChangeRequestId, dcrId));
    expect(remainingReviews.length).toBe(0);

    const [row] = await db.select().from(auditTrail).where(eq(auditTrail.action, "delete"));
    expect(row).toBeTruthy();
    dcrId = 0; // already cleaned up — skip afterAll's own cleanup for this id
  });
});
