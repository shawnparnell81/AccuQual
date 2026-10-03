import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { ensureTestCompany } from "../helpers/company.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { documents, documentComments, documentVersions } from "../../src/drizzle/schema/documents.js";
import { documentFolders } from "../../src/drizzle/schema/documentFolders.js";
import { formTemplates, formData } from "../../src/drizzle/schema/forms.js";
import { controlledVersions } from "../../src/drizzle/schema/versioning.js";
import { workflowDefinitions } from "../../src/drizzle/schema/workflow.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";

const app = createApp();
const migrationSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/drizzle/migrations/0101_clear_published_versions.sql"),
  "utf8",
);

const suffix = Date.now();
const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const node = (id: string, type: string, kind: string, config: Record<string, unknown> = {}) => ({ id, type, kind, config });
const edge = (from: string, to: string, branch?: string) => ({ from, to, ...(branch ? { branch } : {}) });
const ncrGraph = () => ({
  nodes: [node("t", "trigger", "ncr_created"), node("c", "condition", "sev", { field: "severity", equals: "high" }), node("m", "action", "assign_user", { department: "quality" }), node("end", "end", "end")],
  edges: [edge("t", "c"), edge("c", "m", "true"), edge("m", "end")],
  metadata: { name: "NCR routing", module: "ncr" },
});

describe("clear published and archived controlled versions", () => {
  let authorToken: string;
  let reviewerToken: string;
  let authorId: number;
  let reviewerId: number;
  let ownerPermissions: unknown;
  let folderId: number;
  let templateId: number;
  let ncrId: number;
  let workflowId: number;
  let workflowDefinition: unknown;
  let publishedWorkflowVersionId: number;
  let releasedDocumentId: number;
  let archivedVersionId: number;
  let publishedDocumentVersionId: number;
  let ledgerId: number;
  let commentId: number;
  let openDocumentId: number;
  let inReviewVersionId: number;
  let obsoleteDocumentId: number;
  let obsoletePublishedId: number;
  let draftOnlyWorkflowId: number;
  let draftOnlyDefinition: unknown;

  beforeAll(async () => {
    const company = await ensureTestCompany();
    await seedDefaultPermissions(company!.id);
    await db.insert(roles).values([{ name: "quality_manager" }, { name: "admin" }]).onConflictDoNothing();

    const [author] = await db.insert(users).values({ email: `clear-author-${suffix}@test.local`, passwordHash: "unused", department: "quality" }).returning();
    const [reviewer] = await db.insert(users).values({ email: `clear-reviewer-${suffix}@test.local`, passwordHash: "unused", department: "quality" }).returning();
    authorId = author!.id;
    reviewerId = reviewer!.id;
    authorToken = await signAccessToken({ sub: String(authorId), roleId: null, roleName: "operator", department: "quality" });
    reviewerToken = await signAccessToken({ sub: String(reviewerId), roleId: null, roleName: "quality_manager", department: "quality" });

    const [owner] = await db.select().from(roles).where(eq(roles.name, "owner"));
    ownerPermissions = owner!.permissions;

    const [folder] = await db.insert(documentFolders).values({ name: "Procedures" }).returning();
    folderId = folder!.id;
    const [template] = await db.insert(formTemplates).values({ formType: "ncr", pdfPath: "/templates/defaults/ncr.pdf", fieldMap: { title: "title" }, isDefault: "true" }).returning();
    templateId = template!.id;
    const [issue] = await db.insert(ncr).values({ title: "Scratch on housing", status: "contain" }).returning();
    ncrId = issue!.id;

    const graph = ncrGraph();
    const [workflow] = await db.insert(workflowDefinitions).values({ name: "NCR routing", module: "ncr", isActive: "true", definition: graph, version: 2, createdBy: authorId }).returning();
    workflowId = workflow!.id;
    workflowDefinition = workflow!.definition;
    const [publishedWorkflow] = await db
      .insert(controlledVersions)
      .values({ subjectType: "workflow", subjectId: workflowId, versionNumber: 1, status: "published", payload: graph, publishedBy: reviewerId, publishedAt: new Date(), createdBy: authorId })
      .returning();
    publishedWorkflowVersionId = publishedWorkflow!.id;

    const [draftWorkflow] = await db
      .insert(workflowDefinitions)
      .values({ name: "Validation sheet routing", module: "audits", isActive: "false", definition: { nodes: [node("t", "trigger", "closed")], edges: [] }, version: 1, createdBy: authorId })
      .returning();
    draftOnlyWorkflowId = draftWorkflow!.id;
    draftOnlyDefinition = draftWorkflow!.definition;
    await db.insert(controlledVersions).values({
      subjectType: "workflow",
      subjectId: draftOnlyWorkflowId,
      versionNumber: 1,
      status: "draft",
      payload: draftOnlyDefinition as Record<string, unknown>,
      createdBy: authorId,
    });

    const [released] = await db
      .insert(documents)
      .values({ title: "Test procedure", category: "Procedures", status: "approved", currentVersion: 2, revisionCode: "Rev B", ownerId: authorId })
      .returning();
    releasedDocumentId = released!.id;
    const [archived] = await db
      .insert(controlledVersions)
      .values({ subjectType: "document", subjectId: releasedDocumentId, versionNumber: 1, status: "archived", payload: { title: "Test procedure", revisionCode: "Rev A" }, createdBy: authorId })
      .returning();
    const [publishedDoc] = await db
      .insert(controlledVersions)
      .values({
        subjectType: "document",
        subjectId: releasedDocumentId,
        versionNumber: 2,
        status: "published",
        payload: { title: "Test procedure", revisionCode: "Rev B" },
        publishedBy: reviewerId,
        publishedAt: new Date(),
        createdBy: authorId,
      })
      .returning();
    archivedVersionId = archived!.id;
    publishedDocumentVersionId = publishedDoc!.id;
    await db.update(documents).set({ currentVersionId: publishedDocumentVersionId }).where(eq(documents.id, releasedDocumentId));
    const [ledger] = await db.insert(documentVersions).values({ documentId: releasedDocumentId, version: 2, changeNotes: "Released during testing", approvedBy: reviewerId, approvedAt: new Date(), createdBy: authorId }).returning();
    ledgerId = ledger!.id;
    const [comment] = await db.insert(documentComments).values({ documentId: releasedDocumentId, versionId: publishedDocumentVersionId, body: "Looks fine", authorId }).returning();
    commentId = comment!.id;
    await db.insert(auditTrail).values({ entityType: "DocumentVersion", entityId: releasedDocumentId, action: "status_change", changes: { event: "published", version: 2 }, performedBy: reviewerId });

    const [openDoc] = await db.insert(documents).values({ title: "In review procedure", status: "approved", currentVersion: 1, revisionCode: "Rev A", ownerId: authorId }).returning();
    openDocumentId = openDoc!.id;
    const [openPublished] = await db
      .insert(controlledVersions)
      .values({ subjectType: "document", subjectId: openDocumentId, versionNumber: 1, status: "published", payload: { title: "In review procedure", revisionCode: "Rev A" }, createdBy: authorId })
      .returning();
    const [inReview] = await db
      .insert(controlledVersions)
      .values({ subjectType: "document", subjectId: openDocumentId, versionNumber: 2, status: "in_review", payload: { title: "In review procedure", revisionCode: "Rev B" }, createdBy: authorId })
      .returning();
    inReviewVersionId = inReview!.id;
    await db.update(documents).set({ currentVersionId: openPublished!.id }).where(eq(documents.id, openDocumentId));

    const [obsolete] = await db
      .insert(documents)
      .values({ title: "Retired procedure", category: "Procedures", status: "approved", currentVersion: 1, revisionCode: "Rev A", ownerId: authorId })
      .returning();
    obsoleteDocumentId = obsolete!.id;
    const [obsoletePublished] = await db
      .insert(controlledVersions)
      .values({ subjectType: "document", subjectId: obsoleteDocumentId, versionNumber: 1, status: "published", payload: { title: "Retired procedure", revisionCode: "Rev A" }, createdBy: authorId })
      .returning();
    obsoletePublishedId = obsoletePublished!.id;
    await db.update(documents).set({ currentVersionId: obsoletePublishedId, status: "obsolete", category: "obsolete-archive" }).where(eq(documents.id, obsoleteDocumentId));

    await db.insert(formData).values({ formType: "management_review", entityId: 1, data: { chairpersonName: "Ana" }, version: 1, createdBy: authorId });
    await db.insert(controlledVersions).values({
      subjectType: "management_review",
      subjectId: 1,
      versionNumber: 1,
      status: "published",
      payload: { chairpersonName: "Ana" },
      publishedBy: reviewerId,
      publishedAt: new Date(),
      createdBy: authorId,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("removes published and archived versions and the pointers that showed them as in force", async () => {
    await pool.query(migrationSql);
    await pool.query(migrationSql);

    const released = await db
      .select()
      .from(controlledVersions)
      .where(inArray(controlledVersions.status, ["published", "archived"]));
    expect(released).toEqual([]);
    expect(await db.select().from(controlledVersions).where(eq(controlledVersions.id, publishedWorkflowVersionId))).toEqual([]);
    expect(await db.select().from(controlledVersions).where(eq(controlledVersions.id, publishedDocumentVersionId))).toEqual([]);
    expect(await db.select().from(controlledVersions).where(eq(controlledVersions.id, archivedVersionId))).toEqual([]);
    expect(await db.select().from(controlledVersions).where(eq(controlledVersions.id, obsoletePublishedId))).toEqual([]);

    const [workflow] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, workflowId));
    expect(workflow!.definition).toEqual(workflowDefinition);
    expect(workflow!.name).toBe("NCR routing");
    expect(workflow!.isActive).toBe("true");
    const workflowCurrent = await request(app).get(`/workflow/${workflowId}`).set(as(authorToken));
    expect(workflowCurrent.status).toBe(200);
    expect(workflowCurrent.body.published).toBeNull();
    expect(workflowCurrent.body.open).toMatchObject({ status: "draft", versionNumber: 1 });
    expect(workflowCurrent.body.open.id).not.toBe(publishedWorkflowVersionId);

    const [draftWorkflow] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, draftOnlyWorkflowId));
    expect(draftWorkflow!.definition).toEqual(draftOnlyDefinition);
    const draftVersions = await db.select().from(controlledVersions).where(and(eq(controlledVersions.subjectType, "workflow"), eq(controlledVersions.subjectId, draftOnlyWorkflowId)));
    expect(draftVersions).toHaveLength(1);
    expect(draftVersions[0]).toMatchObject({ status: "draft", versionNumber: 1 });

    const [doc] = await db.select().from(documents).where(eq(documents.id, releasedDocumentId));
    expect(doc).toMatchObject({ status: "draft", currentVersion: 0, currentVersionId: null, revisionCode: null, title: "Test procedure" });
    expect(await db.select().from(documentVersions).where(eq(documentVersions.id, ledgerId))).toEqual([]);
    const [comment] = await db.select().from(documentComments).where(eq(documentComments.id, commentId));
    expect(comment).toMatchObject({ body: "Looks fine", versionId: null });
    const documentCurrent = await request(app).get(`/documents/${releasedDocumentId}/current`).set(as(authorToken));
    expect(documentCurrent.status).toBe(200);
    expect(documentCurrent.body.published).toBeNull();
    expect(documentCurrent.body.open.status).not.toBe("published");
    expect(documentCurrent.body.open.status).not.toBe("archived");

    const [openDoc] = await db.select().from(documents).where(eq(documents.id, openDocumentId));
    expect(openDoc).toMatchObject({ status: "in_review", currentVersion: 0, currentVersionId: null, revisionCode: null });
    const [keptReview] = await db.select().from(controlledVersions).where(eq(controlledVersions.id, inReviewVersionId));
    expect(keptReview).toMatchObject({ status: "in_review", versionNumber: 2 });

    const [obsolete] = await db.select().from(documents).where(eq(documents.id, obsoleteDocumentId));
    expect(obsolete).toMatchObject({ status: "obsolete", category: "obsolete-archive", currentVersion: 0, currentVersionId: null, revisionCode: null, title: "Retired procedure" });
    const obsoleteCurrent = await request(app).get(`/documents/${obsoleteDocumentId}/current`).set(as(authorToken));
    expect(obsoleteCurrent.status).toBe(200);
    expect(obsoleteCurrent.body.published).toBeNull();
    expect(obsoleteCurrent.body.open).toBeNull();
    const obsoleteVersions = await db.select().from(controlledVersions).where(and(eq(controlledVersions.subjectType, "document"), eq(controlledVersions.subjectId, obsoleteDocumentId)));
    expect(obsoleteVersions).toEqual([]);

    const [review] = await db.select().from(formData).where(eq(formData.formType, "management_review"));
    expect(review!.data).toEqual({ chairpersonName: "Ana" });
    const management = await request(app).get("/management-review/1").set(as(authorToken));
    expect(management.status).toBe(200);
    expect(management.body.published).toBeNull();
    expect(management.body.open.status).toBe("draft");

    const publishAudits = await db.select().from(auditTrail).where(eq(auditTrail.entityType, "DocumentVersion"));
    expect(publishAudits.filter((row) => (row.changes as { event?: string } | null)?.event === "published")).toEqual([]);

    const [folder] = await db.select().from(documentFolders).where(eq(documentFolders.id, folderId));
    expect(folder!.name).toBe("Procedures");
    const [template] = await db.select().from(formTemplates).where(eq(formTemplates.id, templateId));
    expect(template).toMatchObject({ formType: "ncr", pdfPath: "/templates/defaults/ncr.pdf" });
    const [issue] = await db.select().from(ncr).where(eq(ncr.id, ncrId));
    expect(issue).toMatchObject({ title: "Scratch on housing", status: "contain" });
    const [author] = await db.select().from(users).where(eq(users.id, authorId));
    expect(author!.email).toBe(`clear-author-${suffix}@test.local`);
    const [owner] = await db.select().from(roles).where(eq(roles.name, "owner"));
    expect(owner!.permissions).toEqual(ownerPermissions);

    const freeze = await pool.query("SELECT tgenabled FROM pg_trigger WHERE tgname = 'controlled_versions_freeze'");
    expect(freeze.rows[0].tgenabled).toBe("O");
  });

  it("still freezes a version published after the migration", async () => {
    const created = await request(app).post("/workflow").set(as(authorToken)).send({ name: "After the clean slate", module: "ncr" });
    expect(created.status).toBe(201);
    const workflowId = created.body.id as number;
    const draftId = created.body.draftVersionId as number;
    const payload = { ...ncrGraph(), metadata: { name: "After the clean slate", module: "ncr" } };
    expect((await request(app).put(`/workflow/${workflowId}/versions/${draftId}`).set(as(authorToken)).send({ payload })).status).toBe(200);
    expect((await request(app).post(`/workflow/${workflowId}/review`).set(as(authorToken)).send({ versionId: draftId, action: "request" })).status).toBe(200);
    expect((await request(app).post(`/workflow/${workflowId}/review`).set(as(reviewerToken)).send({ versionId: draftId, action: "approve", notes: "Ready" })).status).toBe(200);
    const published = await request(app).post(`/workflow/${workflowId}/publish`).set(as(reviewerToken)).send({ versionId: draftId });
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ status: "published", id: draftId });

    await expect(pool.query("UPDATE controlled_versions SET payload = '{}'::jsonb WHERE id = $1", [draftId])).rejects.toThrow(/frozen/i);
    await expect(pool.query("DELETE FROM controlled_versions WHERE id = $1", [draftId])).rejects.toThrow(/cannot be deleted/i);
    const [row] = await db.select().from(controlledVersions).where(eq(controlledVersions.id, draftId));
    expect(row).toMatchObject({ status: "published", versionNumber: 1 });
  });
});
