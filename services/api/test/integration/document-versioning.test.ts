// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Controlled-document versioning through its real HTTP endpoints: draft -> review -> publish, the database version freeze,
// four-eyes review, rollback, diffs (content / metadata / files / links), attachments and signed links, links to other
// records, RBAC, tenant isolation, audit trail, legacy (pre-versioning) documents, and the retired one-step endpoints.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { env } from "../../src/config/env.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { documents, documentFiles, documentVersions } from "../../src/drizzle/schema/documents.js";
import { controlledVersions } from "../../src/drizzle/schema/versioning.js";
import { equipment } from "../../src/drizzle/schema/calibration.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { auditRowChanges } from "../../src/drizzle/schema/auditRowChanges.js";
import { notificationLog } from "../../src/drizzle/schema/notifications.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let otherTenantId: number;
const userIds: number[] = [];
type Who = { id: number; email: string; token: string };
let author: Who; // quality, ordinary role: can edit, cannot review or publish
let reviewer: Who; // quality, quality_manager
let admin: Who;
let engineer: Who; // engineering: can edit documents, cannot review
let production: Who; // production: read-only on documents
let customer: Who;
let otherAdmin: Who;
let caliperId: number;
let acmeId: number;
let otherCaliperId: number;

async function makeUser(tenant: number, label: string, roleName: string, department: string | null): Promise<Who> {
  const email = `docver-${label}-${suffix}@test.local`;
  const [u] = await db.insert(users).values({ tenantId: tenant, email, passwordHash: "unused", department }).returning();
  userIds.push(u!.id);
  return { id: u!.id, email, token: await signAccessToken({ sub: String(u!.id), tenantId: tenant, roleId: null, roleName, department }) };
}
const as = (w: Who) => ({ Authorization: `Bearer ${w.token}` });

const PDF = Buffer.from("%PDF-1.4\n%AccuQual test document\n1 0 obj<<>>endobj\n");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const events = async (docId: number) =>
  (await db.select().from(auditTrail).where(and(eq(auditTrail.tenantId, tenantId), eq(auditTrail.entityType, "DocumentVersion"), eq(auditTrail.entityId, docId)))).map((r) => r.changes as Record<string, unknown> | null);
const hasEvent = async (docId: number, event: string) => (await events(docId)).some((c) => c?.event === event);

async function newDocument(who: Who, title: string) {
  const res = await request(app).post("/documents").set(as(who)).send({ title, category: "Procedures" });
  expect(res.status).toBe(201);
  return { id: res.body.id as number, draftId: res.body.openVersionId as number, body: res.body };
}
const save = (docId: number, versionId: number, who: Who, payload: Record<string, unknown>) => request(app).patch(`/documents/${docId}/draft/${versionId}`).set(as(who)).send({ payload });
const current = async (docId: number, who: Who) => (await request(app).get(`/documents/${docId}/current`).set(as(who))).body;

describe("Controlled documents: draft -> review -> publish (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [t] = await db.insert(tenants).values({ name: `DocVer ${suffix}`, code: `docver-${suffix}` }).returning();
    const [o] = await db.insert(tenants).values({ name: `DocVer Other ${suffix}`, code: `docver-other-${suffix}` }).returning();
    tenantId = t!.id;
    otherTenantId = o!.id;
    await seedDefaultPermissions(tenantId);
    await seedDefaultPermissions(otherTenantId);
    author = await makeUser(tenantId, "author", "operator", "quality");
    reviewer = await makeUser(tenantId, "reviewer", "quality_manager", "quality");
    admin = await makeUser(tenantId, "admin", "admin", null);
    engineer = await makeUser(tenantId, "engineer", "operator", "engineering");
    production = await makeUser(tenantId, "production", "operator", "production");
    customer = await makeUser(tenantId, "customer", "customer", null);
    otherAdmin = await makeUser(otherTenantId, "other", "admin", null);
    // Real role rows, so the reviewer picker (which lists people by their stored role) has someone to show.
    await db.insert(roles).values([{ name: "quality_manager" }, { name: "admin" }]).onConflictDoNothing();
    const roleId = async (name: string) => (await db.select().from(roles).where(eq(roles.name, name)))[0]!.id;
    await db.update(users).set({ roleId: await roleId("quality_manager") }).where(eq(users.id, reviewer.id));
    await db.update(users).set({ roleId: await roleId("admin") }).where(inArray(users.id, [admin.id, otherAdmin.id]));
    caliperId = (await db.insert(equipment).values({ tenantId, name: "Digital caliper", serialNumber: "DC-100" }).returning())[0]!.id;
    acmeId = (await db.insert(suppliers).values({ tenantId, name: "Acme Fasteners" }).returning())[0]!.id;
    otherCaliperId = (await db.insert(equipment).values({ tenantId: otherTenantId, name: "Other tenant caliper" }).returning())[0]!.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    for (const t of [tenantId, otherTenantId]) {
      await db.delete(auditRowChanges).where(eq(auditRowChanges.tenantId, t));
      await db.delete(auditTrail).where(eq(auditTrail.tenantId, t));
      await db.delete(notificationLog).where(eq(notificationLog.tenantId, t));
      await db.delete(documentFiles).where(eq(documentFiles.tenantId, t));
      await db.delete(documentVersions).where(eq(documentVersions.tenantId, t));
      await db.delete(documents).where(eq(documents.tenantId, t));
      // Published versions are frozen by a trigger; this is a test-database teardown, so lift it for the cleanup only.
      await pool.query("ALTER TABLE controlled_versions DISABLE TRIGGER controlled_versions_freeze");
      await db.delete(controlledVersions).where(eq(controlledVersions.tenantId, t));
      await pool.query("ALTER TABLE controlled_versions ENABLE TRIGGER controlled_versions_freeze");
      await db.delete(equipment).where(eq(equipment.tenantId, t));
      await db.delete(suppliers).where(eq(suppliers.tenantId, t));
      await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, t));
      await rm(path.join(env.STORAGE_LOCAL_PATH, "tenants", String(t)), { recursive: true, force: true });
    }
    await db.delete(users).where(inArray(users.id, userIds));
    for (const t of [tenantId, otherTenantId]) {
      await db.delete(tenants).where(eq(tenants.id, t));
      await db.delete(auditRowChanges).where(eq(auditRowChanges.tenantId, t));
    }
    await pool.end();
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("the whole lifecycle of one document", () => {
    let docId: number;
    let v1: number;
    let v2: number;
    let v3: number;
    let fileA: { id: number; sha256: string };

    it("creates the document with an empty first draft (Rev A) and nothing in force", async () => {
      const d = await newDocument(author, "Torque wrench calibration procedure");
      docId = d.id;
      v1 = d.draftId;
      expect(d.body).toMatchObject({ status: "draft", currentVersion: 0, category: "Procedures" });
      const c = await current(docId, author);
      expect(c.published).toBeNull();
      expect(c.open).toMatchObject({ id: v1, status: "draft", versionNumber: 1 });
      expect(c.open.payload).toMatchObject({ title: "Torque wrench calibration procedure", revisionCode: "Rev A", attachments: [], links: [] });
      expect(await hasEvent(docId, "draft_created")).toBe(true);
    });

    it("won't send an empty draft for review", async () => {
      const res = await request(app).post(`/documents/${docId}/draft/${v1}/review`).set(as(author)).send({});
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/empty/i);
    });

    it("saves content and metadata to the draft (autosave shape) — through both the alias and the engine URL", async () => {
      const first = await save(docId, v1, author, { title: "Torque wrench calibration procedure", category: "Procedures", content: "1. Zero the wrench.\n2. Apply 50 Nm.", revisionCode: "Rev A", effectiveDate: "2026-10-01", expirationDate: "2027-10-01", retentionPeriodDays: 730, attachments: [], links: [] });
      expect(first.status).toBe(200);
      const viaEngine = await request(app).put(`/documents/${docId}/versions/${v1}`).set(as(author)).send({ payload: { ...first.body.payload, content: "1. Zero the wrench.\n2. Apply 50 Nm.\n3. Record the reading." } });
      expect(viaEngine.status).toBe(200);
      expect(viaEngine.body.payload.content).toContain("Record the reading");
    });

    it("only accepts links to records that exist in this organization", async () => {
      const payload = (await current(docId, author)).open.payload;
      const foreign = await save(docId, v1, author, { ...payload, links: [{ type: "equipment", id: otherCaliperId, label: "x" }] });
      expect(foreign.status).toBe(422);
      const missing = await save(docId, v1, author, { ...payload, links: [{ type: "supplier", id: 99999999, label: "x" }] });
      expect(missing.status).toBe(422);
      const ok = await save(docId, v1, author, { ...payload, links: [{ type: "equipment", id: caliperId, label: "Digital caliper (DC-100)" }] });
      expect(ok.status).toBe(200);
    });

    it("accepts a real PDF, records its checksum, and refuses a disguised or unsupported file", async () => {
      const ok = await request(app).post(`/documents/${docId}/version/${v1}/attachments`).set(as(author)).attach("file", PDF, "calibration-form.pdf");
      expect(ok.status).toBe(201);
      fileA = ok.body.attachment;
      expect(ok.body.attachment).toMatchObject({ fileName: "calibration-form.pdf", mimeType: "application/pdf", sizeBytes: PDF.length, sha256: sha(PDF) });
      expect((await current(docId, author)).open.payload.attachments).toHaveLength(1);
      expect(await hasEvent(docId, "attachment_added")).toBe(true);

      const disguised = await request(app).post(`/documents/${docId}/version/${v1}/attachments`).set(as(author)).attach("file", Buffer.from("MZ\u0090\u0000 not a pdf"), "invoice.pdf");
      expect(disguised.status).toBe(400);
      const unsupported = await request(app).post(`/documents/${docId}/version/${v1}/attachments`).set(as(author)).attach("file", Buffer.from("<script>1</script>"), "page.html");
      expect(unsupported.status).toBe(400);
    });

    it("refuses a file reference that belongs to another document or organization", async () => {
      const other = await newDocument(author, "A different document");
      const up = await request(app).post(`/documents/${other.id}/version/${other.draftId}/attachments`).set(as(author)).attach("file", PDF, "other.pdf");
      expect(up.status).toBe(201);
      const payload = (await current(docId, author)).open.payload;
      const res = await save(docId, v1, author, { ...payload, attachments: [...payload.attachments, up.body.attachment] });
      expect(res.status).toBe(422);
      const forged = await save(docId, v1, author, { ...payload, attachments: [{ ...payload.attachments[0], sha256: "0".repeat(64) }] });
      expect(forged.status).toBe(422);
    });

    it("sends for review with a named reviewer, tells that reviewer, and locks the draft", async () => {
      const res = await request(app).post(`/documents/${docId}/draft/${v1}/review`).set(as(author)).send({ notes: "Ready for your review", reviewerId: reviewer.id });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "in_review", submittedBy: author.id });
      expect(res.body.metadata.assignedReviewerId).toBe(reviewer.id);
      expect((await db.select().from(documents).where(eq(documents.id, docId)))[0]!.status).toBe("in_review");
      const mail = await db.select().from(notificationLog).where(and(eq(notificationLog.tenantId, tenantId), eq(notificationLog.recipient, reviewer.email)));
      expect(mail.some((m) => /waiting for your review/i.test(m.subject))).toBe(true);
      const locked = await save(docId, v1, author, (await current(docId, author)).open.payload);
      expect(locked.status).toBe(409);
      const noFiles = await request(app).post(`/documents/${docId}/version/${v1}/attachments`).set(as(author)).attach("file", PDF, "late.pdf");
      expect(noFiles.status).toBe(409);
    });

    it("lists who can be asked to review — only reviewers in this organization, never the person asking", async () => {
      const list = (await request(app).get("/documents/reviewers").set(as(author))).body as { id: number }[];
      expect(list.map((r) => r.id).sort()).toEqual([reviewer.id, admin.id].sort());
      const forReviewer = (await request(app).get("/documents/reviewers").set(as(reviewer))).body as { id: number }[];
      expect(forReviewer.map((r) => r.id)).toEqual([admin.id]);
      expect((await request(app).get("/documents/reviewers").set(as(otherAdmin))).body.map((r: { id: number }) => r.id)).toEqual([]); // the other admin is asking, and is the only reviewer there
    });

    it("won't accept a reviewer who isn't in this organization or is the author", async () => {
      const d = await newDocument(author, "Reviewer checks");
      await save(d.id, d.draftId, author, { ...(await current(d.id, author)).open.payload, content: "Body" });
      expect((await request(app).post(`/documents/${d.id}/draft/${d.draftId}/review`).set(as(author)).send({ reviewerId: otherAdmin.id })).status).toBe(400);
      expect((await request(app).post(`/documents/${d.id}/draft/${d.draftId}/review`).set(as(author)).send({ reviewerId: author.id })).status).toBe(400);
    });

    it("refuses approval and publication from someone without reviewing rights, and records the refusal", async () => {
      const approve = await request(app).post(`/documents/${docId}/version/${v1}/review/approve`).set(as(author)).send({});
      expect(approve.status).toBe(403);
      const publish = await request(app).post(`/documents/${docId}/version/${v1}/publish`).set(as(author));
      expect(publish.status).toBe(403);
      const denied = (await events(docId)).filter((c) => c?.permission);
      expect(denied.map((c) => c!.permission)).toEqual(expect.arrayContaining(["document.review", "document.publish"]));
      // An engineer can draft documents but is not a reviewer either.
      expect((await request(app).post(`/documents/${docId}/version/${v1}/review/approve`).set(as(engineer)).send({})).status).toBe(403);
    });

    it("can't be published before a reviewer approves it", async () => {
      const res = await request(app).post(`/documents/${docId}/version/${v1}/publish`).set(as(reviewer));
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/approve/i);
    });

    it("approves, then publishes: the document record now mirrors the released revision", async () => {
      const approve = await request(app).post(`/documents/${docId}/version/${v1}/review/approve`).set(as(reviewer)).send({ notes: "Checked against the wrench manual." });
      expect(approve.status).toBe(200);
      expect(approve.body).toMatchObject({ reviewDecision: "approved", reviewedBy: reviewer.id });
      const pub = await request(app).post(`/documents/${docId}/version/${v1}/publish`).set(as(reviewer));
      expect(pub.status).toBe(200);
      expect(pub.body).toMatchObject({ status: "published", publishedBy: reviewer.id });

      const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
      expect(doc).toMatchObject({ status: "approved", currentVersion: 1, currentVersionId: v1, revisionCode: "Rev A", retentionPeriodDays: 730, linkedModules: ["equipment"] });
      expect(doc!.effectiveDate!.toISOString().slice(0, 10)).toBe("2026-10-01");
      expect(doc!.expirationDate!.toISOString().slice(0, 10)).toBe("2027-10-01");

      // The long-standing revision ledger stays true (history, retention, legacy file download).
      const ledger = await db.select().from(documentVersions).where(eq(documentVersions.documentId, docId));
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ version: 1, approvedBy: reviewer.id, approvalNotes: "Checked against the wrench manual." });
      expect(ledger[0]!.fileUrl).toBeTruthy();
      const history = await request(app).get(`/documents/${docId}/history`).set(as(author));
      expect(history.body).toHaveLength(1);
      expect(await hasEvent(docId, "published")).toBe(true);
    });

    it("freezes the published revision — in the application and in the database itself", async () => {
      const app409 = await save(docId, v1, author, (await current(docId, author)).published.payload);
      expect(app409.status).toBe(409);
      const discard = await request(app).delete(`/documents/${docId}/versions/${v1}`).set(as(author));
      expect(discard.status).toBe(409);
      // Straight at the database, as if a bug or an injected query tried to rewrite history:
      await expect(pool.query(`UPDATE controlled_versions SET payload = '{"title":"tampered"}'::jsonb WHERE id = $1`, [v1])).rejects.toThrow(/frozen/i);
      await expect(pool.query(`DELETE FROM controlled_versions WHERE id = $1`, [v1])).rejects.toThrow(/cannot be deleted/i);
      // ...and the file registry is immutable too.
      await expect(pool.query(`UPDATE document_files SET sha256 = 'x' WHERE id = $1`, [fileA.id])).rejects.toThrow(/cannot be edited/i);
    });

    it("starts the next revision as Rev B, carrying content, files and links forward — one open revision at a time", async () => {
      const res = await request(app).post(`/documents/${docId}/draft`).set(as(author)).send({ summary: "Add supplier reference and new step" });
      expect(res.status).toBe(201);
      v2 = res.body.id;
      expect(res.body).toMatchObject({ versionNumber: 2, status: "draft", basedOnVersion: 1 });
      expect(res.body.payload).toMatchObject({ revisionCode: "Rev B", effectiveDate: null, content: expect.stringContaining("Apply 50 Nm"), links: [{ type: "equipment", id: caliperId }] });
      expect(res.body.payload.attachments).toHaveLength(1);
      expect((await request(app).post(`/documents/${docId}/draft`).set(as(author)).send({})).status).toBe(409);
      // The released revision stays in force, and the document is still "approved", while the revision is being worked on.
      expect((await db.select().from(documents).where(eq(documents.id, docId)))[0]).toMatchObject({ status: "approved", currentVersion: 1 });
    });

    it("edits the revision: content, title, a replaced file, links — and keeps the earlier revision's file", async () => {
      const draft = (await current(docId, author)).open.payload;
      const removed = await request(app).delete(`/documents/${docId}/version/${v2}/attachments/${fileA.id}`).set(as(author));
      expect(removed.status).toBe(204);
      // Rev A still needs that file, so the stored file must not have been deleted.
      const [stillThere] = await db.select().from(documentFiles).where(eq(documentFiles.id, fileA.id));
      expect(stillThere).toBeTruthy();
      expect(existsSync(stillThere!.filePath)).toBe(true);

      const newPdf = Buffer.concat([PDF, Buffer.from("% revised\n")]);
      const up = await request(app).post(`/documents/${docId}/version/${v2}/attachments`).set(as(author)).attach("file", newPdf, "calibration-form.pdf");
      expect(up.status).toBe(201);
      const withLinks = (await current(docId, author)).open.payload;
      const res = await save(docId, v2, author, {
        ...withLinks,
        title: "Torque wrench calibration procedure (updated)",
        content: `${draft.content}\n4. Sign the calibration sticker.`,
        links: [{ type: "supplier", id: acmeId, label: "Acme Fasteners" }],
      });
      expect(res.status).toBe(200);
      expect(await hasEvent(docId, "attachment_removed")).toBe(true);
    });

    it("tells the department when a revision is sent for review, and the author when it is sent back", async () => {
      const submit = await request(app).post(`/documents/${docId}/draft/${v2}/review`).set(as(author)).send({ notes: "Please review" });
      expect(submit.status).toBe(200);
      const deptMail = await db.select().from(notificationLog).where(and(eq(notificationLog.tenantId, tenantId), eq(notificationLog.recipient, reviewer.email)));
      expect(deptMail.filter((m) => /waiting for your review/i.test(m.subject)).length).toBeGreaterThanOrEqual(2); // named for v1, department-wide for v2

      const noReason = await request(app).post(`/documents/${docId}/version/${v2}/review/reject`).set(as(reviewer)).send({});
      expect(noReason.status).toBe(400);
      const back = await request(app).post(`/documents/${docId}/version/${v2}/review/reject`).set(as(reviewer)).send({ notes: "Step 4 needs the sticker colour." });
      expect(back.status).toBe(200);
      expect(back.body).toMatchObject({ status: "draft", reviewDecision: "rejected" });
      const authorMail = await db.select().from(notificationLog).where(and(eq(notificationLog.tenantId, tenantId), eq(notificationLog.recipient, author.email)));
      expect(authorMail.some((m) => /sent back/i.test(m.subject) && /sticker colour/.test(m.body))).toBe(true);
      expect((await request(app).post(`/documents/${docId}/draft/${v2}/review`).set(as(author)).send({ notes: "Fixed" })).status).toBe(200);
    });

    it("publishes Rev B: the previous revision is archived, and the release is summarised in the audit trail", async () => {
      expect((await request(app).post(`/documents/${docId}/version/${v2}/review/approve`).set(as(reviewer)).send({})).status).toBe(200);
      expect((await request(app).post(`/documents/${docId}/version/${v2}/publish`).set(as(reviewer))).status).toBe(200);
      const c = await current(docId, author);
      expect(c.published).toMatchObject({ id: v2, versionNumber: 2 });
      expect(c.open).toBeNull();
      const versions = (await request(app).get(`/documents/${docId}/versions`).set(as(author))).body as { versionNumber: number; status: string }[];
      expect(versions.map((v) => `${v.versionNumber}:${v.status}`)).toEqual(["2:published", "1:archived"]);
      const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
      expect(doc).toMatchObject({ currentVersion: 2, revisionCode: "Rev B", title: "Torque wrench calibration procedure (updated)", linkedModules: ["supplier"] });
      const published = (await events(docId)).filter((c) => c?.event === "published" && c.version === 2)[0]!;
      expect(published.changes).toMatchObject({ added: expect.any(Number), removed: expect.any(Number), changed: expect.any(Number) });
      expect(await db.select().from(documentVersions).where(eq(documentVersions.documentId, docId))).toHaveLength(2);
    });

    it("compares any two revisions: content, metadata, files and links, each marked added / removed / changed", async () => {
      const res = await request(app).get(`/documents/${docId}/version/${v2}/diff?against=${v1}`).set(as(author));
      expect(res.status).toBe(200);
      expect(res.body.from.versionNumber).toBe(1);
      expect(res.body.to.versionNumber).toBe(2);
      const byScope = (scope: string) => res.body.entries.filter((e: { scope: string }) => e.scope === scope);
      expect(byScope("metadata").map((e: { key: string }) => e.key)).toEqual(expect.arrayContaining(["title", "revisionCode", "effectiveDate"]));
      expect(byScope("content")[0].lines.some((l: { op: string; text: string }) => l.op === "add" && l.text.startsWith("4. Sign"))).toBe(true);
      expect(byScope("attachment")).toEqual([expect.objectContaining({ change: "changed", label: "calibration-form.pdf" })]); // same name, new bytes
      expect(byScope("link").map((e: { change: string; key: string }) => `${e.change}:${e.key}`).sort()).toEqual([`added:supplier:${acmeId}`, `removed:equipment:${caliperId}`]);
      expect(res.body.summary.changed + res.body.summary.added + res.body.summary.removed).toBeGreaterThan(4);
      // The default comparison is with the revision just before.
      const dflt = await request(app).get(`/documents/${docId}/version/${v2}/diff`).set(as(author));
      expect(dflt.body.from.versionNumber).toBe(1);
      expect(await hasEvent(docId, "versions_compared")).toBe(true);
    });

    it("keeps link history across revisions and can list the documents linked to a record", async () => {
      const hist = (await request(app).get(`/documents/${docId}/link-history`).set(as(author))).body;
      const equip = hist.links.find((l: { type: string }) => l.type === "equipment");
      const sup = hist.links.find((l: { type: string }) => l.type === "supplier");
      expect(equip).toMatchObject({ firstVersion: 1, lastVersion: 1, inForce: false });
      expect(sup).toMatchObject({ firstVersion: 2, lastVersion: 2, inForce: true });
      const bySupplier = await request(app).get(`/documents/linked?type=supplier&id=${acmeId}`).set(as(author));
      expect(bySupplier.body.map((d: { id: number }) => d.id)).toEqual([docId]);
      const byEquipment = await request(app).get(`/documents/linked?type=equipment&id=${caliperId}`).set(as(author));
      expect(byEquipment.body).toEqual([]); // no longer linked in the released revision
      const picker = await request(app).get(`/documents/link-targets?type=equipment&q=caliper`).set(as(author));
      expect(picker.body.map((r: { id: number }) => r.id)).toEqual([caliperId]); // never the other organization's caliper
    });

    it("rolls back by restoring an earlier revision as a NEW draft that still has to be reviewed and published", async () => {
      const res = await request(app).post(`/documents/${docId}/version/${v1}/rollback`).set(as(author));
      expect(res.status).toBe(201);
      v3 = res.body.id;
      expect(res.body).toMatchObject({ versionNumber: 3, status: "draft", isRollback: true, basedOnVersion: 1 });
      expect(res.body.payload).toMatchObject({ title: "Torque wrench calibration procedure", revisionCode: "Rev C", links: [{ type: "equipment", id: caliperId }] });
      expect(res.body.payload.content).not.toContain("Sign the calibration sticker");
      expect((await db.select().from(documents).where(eq(documents.id, docId)))[0]!.currentVersion).toBe(2); // nothing changed in force yet
      expect((await request(app).post(`/documents/${docId}/version/${v1}/rollback`).set(as(author))).status).toBe(409); // one open revision at a time
      expect(await hasEvent(docId, "rollback_draft_created")).toBe(true);

      await request(app).post(`/documents/${docId}/draft/${v3}/review`).set(as(author)).send({});
      await request(app).post(`/documents/${docId}/version/${v3}/review/approve`).set(as(reviewer)).send({});
      const pub = await request(app).post(`/documents/${docId}/version/${v3}/publish`).set(as(reviewer));
      expect(pub.status).toBe(200);
      expect((await db.select().from(documents).where(eq(documents.id, docId)))[0]).toMatchObject({ currentVersion: 3, revisionCode: "Rev C" });
      expect((await events(docId)).some((c) => c?.event === "published" && c.rollbackTo === 1)).toBe(true);
    });

    it("gives short-lived signed links to a revision's files, and audits their use", async () => {
      const files = (await current(docId, author)).published.payload.attachments as { id: number; fileName: string }[];
      const link = await request(app).get(`/documents/${docId}/version/${v3}/attachments/${files[0]!.id}/url`).set(as(author));
      expect(link.status).toBe(200);
      expect(link.body.expiresInSeconds).toBeLessThanOrEqual(300);
      // No Authorization header at all: the link itself is the credential, exactly as an <img> or <iframe> would use it.
      const dl = await request(app).get(link.body.url);
      expect(dl.status).toBe(200);
      expect(dl.headers["content-type"]).toBe("application/pdf");
      expect(dl.headers["x-content-type-options"]).toBe("nosniff");
      expect(Buffer.compare(dl.body as Buffer, PDF)).toBe(0);
      expect(await hasEvent(docId, "file_downloaded")).toBe(true);

      expect((await request(app).get("/documents/files/download?token=garbage")).status).toBe(401);
      expect((await request(app).get(link.body.url.replace(/.$/, "x"))).status).toBe(401); // tampered signature
      expect((await request(app).get("/documents/files/download")).status).toBe(401);
      // A file that isn't in this revision can't be linked.
      expect((await request(app).get(`/documents/${docId}/version/${v3}/attachments/${fileA.id + 9999}/url`).set(as(author))).status).toBe(404);
    });

    it("returns one revision by the specification's URL as well as the engine's", async () => {
      const a = await request(app).get(`/documents/${docId}/version/${v2}`).set(as(author));
      const b = await request(app).get(`/documents/${docId}/versions/${v2}`).set(as(author));
      expect(a.status).toBe(200);
      expect(a.body).toEqual(b.body);
    });

    it("won't retire a document while a revision is still being worked on, and can't revise a retired one", async () => {
      const draft = await request(app).post(`/documents/${docId}/draft`).set(as(author)).send({});
      expect(draft.status).toBe(201);
      const blocked = await request(app).post(`/documents/${docId}/obsolete`).set(as(author));
      expect(blocked.status).toBe(409);
      expect((await request(app).delete(`/documents/${docId}/versions/${draft.body.id}`).set(as(author))).status).toBe(204);
      const ok = await request(app).post(`/documents/${docId}/obsolete`).set(as(author));
      expect(ok.status).toBe(200);
      const revise = await request(app).post(`/documents/${docId}/draft`).set(as(author)).send({});
      expect(revise.status).toBe(409);
      expect(revise.body.message).toMatch(/obsolete/i);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("who may do what", () => {
    let docId: number;
    let draftId: number;

    it("lets everyone with documents access read the released revision, but only editors change it", async () => {
      const d = await newDocument(author, "RBAC check");
      docId = d.id;
      draftId = d.draftId;
      expect((await request(app).get(`/documents/${docId}/current`).set(as(production))).status).toBe(200);
      expect((await request(app).get(`/documents/${docId}/versions`).set(as(production))).status).toBe(200);
      expect((await request(app).post(`/documents/${docId}/draft`).set(as(production)).send({})).status).toBe(403);
      expect((await request(app).post("/documents").set(as(production)).send({ title: "Nope" })).status).toBe(403);
      expect((await request(app).post(`/documents/${docId}/version/${draftId}/attachments`).set(as(production)).attach("file", PDF, "x.pdf")).status).toBe(403);
    });

    it("keeps customers out entirely", async () => {
      for (const res of [
        await request(app).get(`/documents/${docId}/current`).set(as(customer)),
        await request(app).get(`/documents/${docId}/versions`).set(as(customer)),
        await request(app).post("/documents").set(as(customer)).send({ title: "Customer doc" }),
        await request(app).post(`/documents/${docId}/draft`).set(as(customer)).send({}),
        await request(app).post(`/documents/${docId}/version/${draftId}/review/approve`).set(as(customer)).send({}),
      ]) expect(res.status).toBe(403);
    });

    it("needs authentication", async () => {
      expect((await request(app).get(`/documents/${docId}/current`)).status).toBe(401);
    });

    it("requires someone other than the author to review — an admin excepted, and that is recorded", async () => {
      await save(docId, draftId, author, { ...(await current(docId, author)).open.payload, content: "Body text" });
      // A reviewer who submits their own revision cannot approve it.
      const own = await newDocument(reviewer, "Reviewer's own document");
      await save(own.id, own.draftId, reviewer, { ...(await current(own.id, reviewer)).open.payload, content: "Body" });
      await request(app).post(`/documents/${own.id}/draft/${own.draftId}/review`).set(as(reviewer)).send({});
      const self = await request(app).post(`/documents/${own.id}/version/${own.draftId}/review/approve`).set(as(reviewer)).send({});
      expect(self.status).toBe(403);
      expect(self.body.message).toMatch(/someone else/i);
      // A one-person organization's admin is not stuck.
      const solo = await newDocument(admin, "Admin's document");
      await save(solo.id, solo.draftId, admin, { ...(await current(solo.id, admin)).open.payload, content: "Body" });
      await request(app).post(`/documents/${solo.id}/draft/${solo.draftId}/review`).set(as(admin)).send({});
      expect((await request(app).post(`/documents/${solo.id}/version/${solo.draftId}/review/approve`).set(as(admin)).send({})).status).toBe(200);
      expect((await events(solo.id)).some((c) => c?.event === "review_approved" && c.selfReviewed === true)).toBe(true);
    });

    it("keeps organizations apart", async () => {
      expect((await request(app).get(`/documents/${docId}/versions`).set(as(otherAdmin))).status).toBe(404);
      expect((await request(app).get(`/documents/${docId}/current`).set(as(otherAdmin))).status).toBe(404);
      expect((await request(app).get(`/documents/${docId}/version/${draftId}`).set(as(otherAdmin))).status).toBe(404);
      expect((await request(app).post(`/documents/${docId}/draft`).set(as(otherAdmin)).send({})).status).toBe(404);
      expect((await request(app).post(`/documents/${docId}/version/${draftId}/attachments`).set(as(otherAdmin)).attach("file", PDF, "x.pdf")).status).toBe(404);
      const mine = (await request(app).get("/documents").set(as(otherAdmin))).body as { id: number }[];
      expect(mine.find((d) => d.id === docId)).toBeUndefined();
      expect((await request(app).get(`/documents/link-targets?type=equipment&q=caliper`).set(as(otherAdmin))).body.map((r: { id: number }) => r.id)).toEqual([otherCaliperId]);
      expect((await request(app).get(`/documents/linked?type=equipment&id=${caliperId}`).set(as(otherAdmin))).body).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("documents that pre-date versioning, and the retired one-step endpoints", () => {
    it("answers the old one-step revise and approve endpoints with 410 instead of bypassing review", async () => {
      const d = await newDocument(author, "Old API check");
      for (const url of [`/documents/${d.id}/version`, `/documents/${d.id}/version/upload`, `/documents/${d.id}/approve`]) {
        const res = await request(app).post(url).set(as(admin)).send({ fileUrl: "/etc/passwd" });
        expect(res.status, url).toBe(410);
        expect(res.body.message).toMatch(/draft/i);
      }
    });

    it("no longer lets the record's controlled fields be edited directly", async () => {
      const d = await newDocument(author, "Direct edit check");
      for (const body of [{ title: "Sneaky rename" }, { status: "approved" }, { expirationDate: "2030-01-01T00:00:00Z" }, { category: "x" }]) {
        expect((await request(app).patch(`/documents/${d.id}`).set(as(admin)).send(body)).status, JSON.stringify(body)).toBe(400);
      }
      const ok = await request(app).patch(`/documents/${d.id}`).set(as(admin)).send({ tags: ["calibration", "quality"], expirationWarningDays: 45 });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ tags: ["calibration", "quality"], expirationWarningDays: 45, title: "Direct edit check", status: "draft" });
    });

    it("turns a released legacy document into version N, with its uploaded PDF registered as the file", async () => {
      const dir = path.join(env.STORAGE_LOCAL_PATH, "tenants", String(tenantId), "forms", "custom", "document-versions");
      await mkdir(dir, { recursive: true });
      const legacyPath = path.join(dir, `legacy-${suffix}.pdf`);
      await writeFile(legacyPath, PDF);
      const [doc] = await db.insert(documents).values({ tenantId, title: "Legacy SOP", category: "SOP", status: "approved", currentVersion: 2, ownerId: author.id }).returning();
      const [ver] = await db.insert(documentVersions).values({ tenantId, documentId: doc!.id, version: 2, fileUrl: legacyPath, approvedBy: reviewer.id, approvedAt: new Date(), createdBy: author.id }).returning();

      const c = await current(doc!.id, author);
      expect(c.published).toMatchObject({ versionNumber: 2, status: "published" });
      expect(c.published.payload).toMatchObject({ title: "Legacy SOP", revisionCode: "Rev B" });
      expect(c.published.payload.attachments).toEqual([expect.objectContaining({ mimeType: "application/pdf", sizeBytes: PDF.length, sha256: sha(PDF) })]);

      const draft = await request(app).post(`/documents/${doc!.id}/draft`).set(as(author)).send({});
      expect(draft.status).toBe(201);
      expect(draft.body.versionNumber).toBe(3);
      expect(draft.body.payload.revisionCode).toBe("Rev C");
      expect(draft.body.payload.attachments).toHaveLength(1);

      // The legacy file download still works for a file inside the organization's own storage...
      const file = await request(app).get(`/documents/version/${ver!.id}/file`).set(as(author));
      expect(file.status).toBe(200);
      expect(file.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("bootstraps a legacy document that was never released as an open draft, not as a released version", async () => {
      const [doc] = await db.insert(documents).values({ tenantId, title: "Never released", status: "draft", ownerId: author.id }).returning();
      const c = await current(doc!.id, author);
      expect(c.published).toBeNull();
      expect(c.open).toMatchObject({ status: "draft", versionNumber: 1 });
    });

    it("refuses to stream any file outside the organization's own storage folder (an old endpoint accepted any path)", async () => {
      const outside = path.join(os.tmpdir(), `outside-${suffix}.pdf`);
      await writeFile(outside, PDF);
      try {
        const [doc] = await db.insert(documents).values({ tenantId, title: "Hostile path", status: "approved" }).returning();
        const [ver] = await db.insert(documentVersions).values({ tenantId, documentId: doc!.id, version: 1, fileUrl: outside }).returning();
        expect((await request(app).get(`/documents/version/${ver!.id}/file`).set(as(author))).status).toBe(404);
        const [ver2] = await db.insert(documentVersions).values({ tenantId, documentId: doc!.id, version: 2, fileUrl: "/etc/hosts" }).returning();
        expect((await request(app).get(`/documents/version/${ver2!.id}/file`).set(as(author))).status).toBe(404);
        // ...and such a path is never adopted as a controlled file either.
        expect((await current(doc!.id, author)).published.payload.attachments).toEqual([]);
      } finally {
        await rm(outside, { force: true });
      }
    });
  });
});
