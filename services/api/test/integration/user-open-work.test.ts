import { ensureTestCompany } from "../helpers/company.js";
// Removing a person with open work must hand that work to someone else.
// Records they created or signed stay editable, and their name stays on the history.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { capa } from "../../src/drizzle/schema/capa.js";
import { eightD } from "../../src/drizzle/schema/eightD.js";
import { documents, documentVersions } from "../../src/drizzle/schema/documents.js";
import { controlledVersions } from "../../src/drizzle/schema/versioning.js";
import { complaints } from "../../src/drizzle/schema/complaints.js";
import { trainingAssignments, trainingCourses } from "../../src/drizzle/schema/training.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("open work when removing a user", () => {
  let adminToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    await ensureTestCompany();
    const [admin] = await db.insert(users).values({ email: `open-work-admin-${suffix}@test.local`, passwordHash: "unused", name: "Admin Person" }).returning();
    const [operator] = await db.insert(users).values({ email: `open-work-operator-${suffix}@test.local`, passwordHash: "unused", name: "Operator" }).returning();
    adminToken = signAccessToken({ sub: String(admin!.id), roleId: null, roleName: "admin", department: null });
    operatorToken = signAccessToken({ sub: String(operator!.id), roleId: null, roleName: "operator", department: "production" });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("moves open work to a replacement, keeps signatures, and leaves the records editable", async () => {
    const [jane] = await db.insert(users).values({ email: `jane-${suffix}@test.local`, passwordHash: "unused", name: "Jane Doe" }).returning();
    const [sam] = await db.insert(users).values({ email: `sam-${suffix}@test.local`, passwordHash: "unused", name: "Sam Lee" }).returning();
    const [report] = await db.insert(users).values({ email: `report-${suffix}@test.local`, passwordHash: "unused", name: "Pat Report", managerId: jane!.id }).returning();
    const [inactive] = await db.insert(users).values({ email: `inactive-${suffix}@test.local`, passwordHash: "unused", name: "Already Off", isActive: false }).returning();

    const [openNcr] = await db.insert(ncr).values({ title: "Open scratch", status: "open", assignedTo: jane!.id, createdBy: jane!.id }).returning();
    const [closedNcr] = await db.insert(ncr).values({ title: "Closed dent", status: "closed", assignedTo: jane!.id, createdBy: jane!.id }).returning();
    const [openCapa] = await db.insert(capa).values({ status: "open", ownerId: jane!.id, actionPlan: "Fix the scratch" }).returning();
    const [closedCapa] = await db.insert(capa).values({ status: "closed", ownerId: jane!.id, verifiedBy: jane!.id, actionPlan: "Already checked" }).returning();
    const [openReport] = await db.insert(eightD).values({ ncrId: openNcr!.id, currentStep: 2, data: { d2_problem: "scratch" } }).returning();
    const [closedReport] = await db.insert(eightD).values({ ncrId: closedNcr!.id, currentStep: 8, data: { d8_closure: "Done" } }).returning();
    const [draftDoc] = await db.insert(documents).values({ title: "Draft procedure", status: "in_review", ownerId: jane!.id }).returning();
    const [approvedDoc] = await db.insert(documents).values({ title: "Approved procedure", status: "approved", ownerId: jane!.id }).returning();
    const [approval] = await db.insert(documentVersions).values({ documentId: approvedDoc!.id, version: 1, approvedBy: jane!.id }).returning();
    const [waiting] = await db
      .insert(controlledVersions)
      .values({ subjectType: "document", subjectId: draftDoc!.id, versionNumber: 1, status: "in_review", payload: { title: "Draft procedure" }, metadata: { assignedReviewerId: jane!.id }, createdBy: jane!.id, submittedBy: jane!.id })
      .returning();
    const [published] = await db
      .insert(controlledVersions)
      .values({ subjectType: "document", subjectId: approvedDoc!.id, versionNumber: 1, status: "published", payload: { title: "Approved procedure" }, reviewedBy: jane!.id, publishedBy: jane!.id, createdBy: jane!.id })
      .returning();
    const [openComplaint] = await db.insert(complaints).values({ description: "Open complaint", status: "open", assignedTo: jane!.id }).returning();
    const [closedComplaint] = await db.insert(complaints).values({ description: "Closed complaint", status: "closed", assignedTo: jane!.id }).returning();
    const [course] = await db.insert(trainingCourses).values({ title: "Gauge training" }).returning();
    const [assignment] = await db.insert(trainingAssignments).values({ courseId: course!.id, userId: jane!.id, status: "assigned", assignedBy: jane!.id }).returning();
    await db.insert(auditTrail).values({ entityType: "NCR", entityId: openNcr!.id, action: "create", performedBy: jane!.id, changes: { note: "opened" } });

    expect((await request(app).get(`/users/${jane!.id}/open-work`).set(auth(operatorToken))).status).toBe(403);

    const preview = await request(app).get(`/users/${jane!.id}/open-work`).set(auth(adminToken));
    expect(preview.status).toBe(200);
    const labels = (preview.body.openWork as { key: string; items: { title: string }[] }[]).map((group) => group.key);
    expect(labels).toEqual(expect.arrayContaining(["open_ncrs", "open_capas", "open_eightds", "document_reviews", "pending_reviews", "direct_reports", "complaints", "training"]));
    const ncrGroup = (preview.body.openWork as { key: string; items: { title: string }[] }[]).find((group) => group.key === "open_ncrs");
    expect(ncrGroup!.items.map((item) => item.title)).toContain("Open scratch");
    expect(ncrGroup!.items.map((item) => item.title)).not.toContain("Closed dent");

    const blocked = await request(app).delete(`/users/${jane!.id}`).set(auth(adminToken));
    expect(blocked.status).toBe(409);
    expect(blocked.body.details.requiresReplacement).toBe(true);
    expect(blocked.body.message).toMatch(/open work/);
    expect((await request(app).delete(`/users/${jane!.id}`).set(auth(adminToken)).send({ replacementUserId: inactive!.id })).status).toBe(400);
    expect((await request(app).delete(`/users/${jane!.id}`).set(auth(adminToken)).send({ replacementUserId: jane!.id })).status).toBe(400);

    const removed = await request(app).delete(`/users/${jane!.id}`).set(auth(adminToken)).send({ replacementUserId: sam!.id });
    expect(removed.status).toBe(200);
    expect(removed.body.outcome).toBe("deactivated");
    expect(removed.body.message).toMatch(/Sam Lee/);

    const [stillJane] = await db.select().from(users).where(eq(users.id, jane!.id));
    expect(stillJane).toMatchObject({ isActive: false, name: "Jane Doe" });

    const [movedNcr] = await db.select().from(ncr).where(eq(ncr.id, openNcr!.id));
    expect(movedNcr).toMatchObject({ assignedTo: sam!.id, createdBy: jane!.id, title: "Open scratch" });
    const [oldNcr] = await db.select().from(ncr).where(eq(ncr.id, closedNcr!.id));
    expect(oldNcr).toMatchObject({ assignedTo: jane!.id, createdBy: jane!.id });

    const [movedCapa] = await db.select().from(capa).where(eq(capa.id, openCapa!.id));
    expect(movedCapa!.ownerId).toBe(sam!.id);
    const [oldCapa] = await db.select().from(capa).where(eq(capa.id, closedCapa!.id));
    expect(oldCapa).toMatchObject({ ownerId: jane!.id, verifiedBy: jane!.id });

    const [movedEight] = await db.select().from(eightD).where(eq(eightD.id, openReport!.id));
    expect(movedEight).toMatchObject({ ncrId: openNcr!.id, data: { d2_problem: "scratch" } });
    const [oldEight] = await db.select().from(eightD).where(eq(eightD.id, closedReport!.id));
    expect(oldEight!.data).toMatchObject({ d8_closure: "Done" });

    const [movedDoc] = await db.select().from(documents).where(eq(documents.id, draftDoc!.id));
    expect(movedDoc!.ownerId).toBe(sam!.id);
    const [oldDoc] = await db.select().from(documents).where(eq(documents.id, approvedDoc!.id));
    expect(oldDoc!.ownerId).toBe(jane!.id);
    const [signature] = await db.select().from(documentVersions).where(eq(documentVersions.id, approval!.id));
    expect(signature!.approvedBy).toBe(jane!.id);

    const [movedReview] = await db.select().from(controlledVersions).where(eq(controlledVersions.id, waiting!.id));
    expect(movedReview).toMatchObject({ createdBy: jane!.id, submittedBy: jane!.id, reviewedBy: null });
    expect((movedReview!.metadata as { assignedReviewerId?: number }).assignedReviewerId).toBe(sam!.id);
    const [frozen] = await db.select().from(controlledVersions).where(eq(controlledVersions.id, published!.id));
    expect(frozen).toMatchObject({ reviewedBy: jane!.id, publishedBy: jane!.id, createdBy: jane!.id });

    const [movedComplaint] = await db.select().from(complaints).where(eq(complaints.id, openComplaint!.id));
    expect(movedComplaint!.assignedTo).toBe(sam!.id);
    const [oldComplaint] = await db.select().from(complaints).where(eq(complaints.id, closedComplaint!.id));
    expect(oldComplaint!.assignedTo).toBe(jane!.id);
    const [movedTraining] = await db.select().from(trainingAssignments).where(eq(trainingAssignments.id, assignment!.id));
    expect(movedTraining).toMatchObject({ userId: sam!.id, assignedBy: jane!.id });
    const [movedReport] = await db.select().from(users).where(eq(users.id, report!.id));
    expect(movedReport!.managerId).toBe(sam!.id);

    const editedNcr = await request(app).patch(`/ncr/${openNcr!.id}`).set(auth(adminToken)).send({ title: "Open scratch, updated" });
    expect(editedNcr.status).toBe(200);
    const editedClosed = await request(app).patch(`/ncr/${closedNcr!.id}`).set(auth(adminToken)).send({ description: "Still editable after the author was turned off" });
    expect(editedClosed.status).toBe(200);
    const editedEight = await request(app).patch(`/8d/${openReport!.id}`).set(auth(adminToken)).send({ data: { d2_problem: "scratch", d3_containment: "held" } });
    expect(editedEight.status).toBe(200);
    const editedDoc = await request(app).patch(`/documents/${approvedDoc!.id}`).set(auth(adminToken)).send({ tags: ["still-editable"] });
    expect(editedDoc.status).toBe(200);

    const [ncrAfter] = await db.select().from(ncr).where(eq(ncr.id, openNcr!.id));
    expect(ncrAfter).toMatchObject({ title: "Open scratch, updated", createdBy: jane!.id, assignedTo: sam!.id });
    const [closedAfter] = await db.select().from(ncr).where(eq(ncr.id, closedNcr!.id));
    expect(closedAfter).toMatchObject({ createdBy: jane!.id, assignedTo: jane!.id, description: "Still editable after the author was turned off" });
    const [docAfter] = await db.select().from(documents).where(eq(documents.id, approvedDoc!.id));
    expect(docAfter!.ownerId).toBe(jane!.id);
    expect(docAfter!.tags).toEqual(["still-editable"]);

    const history = await request(app).get(`/audit-trail/NCR/${openNcr!.id}`).set(auth(adminToken));
    expect(history.status).toBe(200);
    const signed = (history.body as { performedBy: number; performedByName: string; action: string; changes?: { action?: string }; fieldChanges?: { changes: Record<string, { from?: unknown; to?: unknown }> }[] }[]).find((row) => row.performedBy === jane!.id);
    expect(signed!.performedByName).toBe("Jane Doe (inactive)");
    const reassigned = (history.body as { changes?: { action?: string }; fieldChanges?: { changes: Record<string, { from?: unknown; to?: unknown }> }[] }[]).find((row) => String(row.changes?.action ?? "").includes("Reassigned from Jane Doe to Sam Lee"));
    expect(reassigned).toBeTruthy();
    const assignedChange = (history.body as { fieldChanges?: { changes: Record<string, { from?: unknown; to?: unknown }> }[] }[])
      .flatMap((row) => row.fieldChanges ?? [])
      .map((change) => change.changes.assigned_to ?? change.changes.assignedTo)
      .find((change) => change && (change.to === "Sam Lee" || change.to === "Sam Lee (inactive)"));
    expect(assignedChange?.to).toBe("Sam Lee");

    const removal = await db.select().from(auditTrail).where(eq(auditTrail.entityId, jane!.id));
    const deactivate = removal.find((row) => row.entityType === "User" && row.action === "status_change");
    expect(deactivate!.changes).toMatchObject({ action: "deactivate", reassignedTo: sam!.id });
  });

  it("reassigns direct reports and then erases an account that has no quality records", async () => {
    const [boss] = await db.insert(users).values({ email: `boss-${suffix}@test.local`, passwordHash: "unused", name: "Boss" }).returning();
    const [next] = await db.insert(users).values({ email: `next-${suffix}@test.local`, passwordHash: "unused", name: "Next" }).returning();
    const [staff] = await db.insert(users).values({ email: `staff-${suffix}@test.local`, passwordHash: "unused", name: "Staff", managerId: boss!.id }).returning();

    const blocked = await request(app).delete(`/users/${boss!.id}`).set(auth(adminToken));
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/1 person who reports to them/);

    const removed = await request(app).delete(`/users/${boss!.id}`).set(auth(adminToken)).send({ replacementUserId: next!.id });
    expect(removed.status).toBe(200);
    expect(removed.body.outcome).toBe("deleted");
    const [gone] = await db.select().from(users).where(eq(users.id, boss!.id));
    expect(gone).toBeUndefined();
    const [staffAfter] = await db.select().from(users).where(eq(users.id, staff!.id));
    expect(staffAfter!.managerId).toBe(next!.id);
  });
});
