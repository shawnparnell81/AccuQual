import { and, desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { builtFormFills, builtFormRevisions, builtForms } from "../../src/drizzle/schema/builtForms.js";
import { documentFolders } from "../../src/drizzle/schema/documentFolders.js";
import { BLANK_FORMS_FOLDER } from "../../src/modules/document-folders/formFiling.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { users } from "../../src/drizzle/schema/users.js";
import { FORM_BUILDER_APPROVE_PERMISSION, FORM_BUILDER_PERMISSION } from "../../src/modules/roles/roleAccess.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { ensureTestCompany } from "../helpers/company.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { setTestPin, TEST_PIN } from "../helpers/signaturePin.js";

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type Structure = { sheets: Array<{ cells: Array<Array<{ value: string } | null>> }> };
type Revision = { id: number; revision: string; status: string; summary: string; description: string; savedByName: string | null; approvedByName: string | null; decisionNote: string | null };

let editor: string;
let approver: string;
let selfApprover: string;
let formId: number;
let fillId: number;

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const message = (body: { error?: { message?: string } | string; message?: string }) => body.message ?? (typeof body.error === "object" ? (body.error?.message ?? "") : "");

async function makeUser(label: string, permissions: string[], name: string) {
  const roleName = `fb-${label}-${suffix}`;
  await db.insert(roles).values({ name: roleName, description: label, hierarchyLevel: 80, isProtected: false, permissions });
  const [user] = await db.insert(users).values({ email: `fb-${label}-${suffix}@test.local`, passwordHash: "unused", name }).returning();
  await setTestPin(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department: null });
}

async function load(token = editor) {
  const res = await request(app).get(`/form-builder/${formId}`).set(as(token));
  expect(res.status).toBe(200);
  return res.body as { revision: string; status: string; structure: Structure; publishedStructure: Structure | null; pendingRevision: string | null; pendingRevisionId: number | null; canApprove: boolean };
}

function withText(structure: Structure, text: string): Structure {
  const copy = JSON.parse(JSON.stringify(structure)) as Structure;
  copy.sheets[0]!.cells[0]![0]!.value = text;
  return copy;
}

const patch = (token: string, body: Record<string, unknown>) => request(app).patch(`/form-builder/${formId}`).set(as(token)).send(body);
const revisions = async (token = editor) => (await request(app).get(`/form-builder/${formId}/revisions`).set(as(token))).body as Revision[];
const approve = (token: string, revId: number, note?: string, pin: string = TEST_PIN) =>
  request(app).post(`/form-builder/${formId}/revisions/${revId}/approve`).set(as(token)).send({ note, pin, certified: true });
const reject = (token: string, revId: number, note?: string) => request(app).post(`/form-builder/${formId}/revisions/${revId}/reject`).set(as(token)).send({ note });
const latestAudit = async (action: string) =>
  (
    await db
      .select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityType, "BuiltForm"), eq(auditTrail.entityId, formId), eq(auditTrail.action, action)))
      .orderBy(desc(auditTrail.id))
      .limit(1)
  )[0]!;

describe("form builder: manual revisions, approval and change history", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    editor = await makeUser("editor", [FORM_BUILDER_PERMISSION], "Rev Tester");
    approver = await makeUser("approver", [FORM_BUILDER_PERMISSION, FORM_BUILDER_APPROVE_PERMISSION], "Approver One");
    selfApprover = await makeUser("both", [FORM_BUILDER_PERMISSION, FORM_BUILDER_APPROVE_PERMISSION], "Both Roles");
    const created = await request(app).post("/form-builder").set(as(editor)).send({ kind: "grid", title: "Rev Test Form" });
    expect(created.status).toBe(201);
    formId = created.body.id;
  });

  it("starts at REV A and a draft save or autosave keeps it", async () => {
    const form = await load();
    expect(form.revision).toBe("A");
    const autosave = await patch(editor, { structure: withText(form.structure, "draft one"), mode: "autosave" });
    expect(autosave.status).toBe(200);
    expect(autosave.body.revision).toBe("A");
    const save = await patch(editor, { formNumber: "FRM-TEST-1", structure: withText(form.structure, "draft two"), mode: "save" });
    expect(save.status).toBe(200);
    expect(save.body.revision).toBe("A");
    expect(save.body.status).toBe("draft");
  });

  it("sends the first publish to approval and keeps it hidden from fillers", async () => {
    const form = await load();
    const typed = await patch(editor, { newRevision: "A", structure: form.structure, mode: "save" });
    expect(typed.status).toBe(200);
    const submitted = await patch(editor, { structure: form.structure, mode: "publish" });
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("draft");
    expect(submitted.body.revision).toBe("A");
    expect(submitted.body.pendingRevision).toBe("A");

    const after = await load();
    expect(after.publishedStructure).toBeNull();
    const list = await revisions();
    expect(list[0]).toMatchObject({ revision: "A", status: "pending", savedByName: "Rev Tester" });
    expect(list[0]!.summary).toMatch(/^Rev Tester submitted FRM-TEST-1 Rev Test Form REV A for approval on /);

    const opened = await request(app).post(`/form-builder/${formId}/fills`).set(as(editor)).send({});
    expect(opened.status).toBe(400);
    expect(message(opened.body)).toContain("REV A is waiting for approval");
    const rows = await request(app).get("/form-builder").set(as(editor));
    expect(rows.body.find((row: { id: number }) => row.id === formId).pendingRevision).toBe("A");
  });

  it("blocks a second pending revision with a 409", async () => {
    const form = await load();
    const again = await patch(editor, { structure: withText(form.structure, "more"), mode: "publish" });
    expect(again.status).toBe(409);
    expect(message(again.body)).toBe("REV A is waiting for approval. Approve or reject it before submitting another revision.");
    expect((await revisions()).filter((row) => row.status === "pending")).toHaveLength(1);
  });

  it("requires the approve permission, and the permission alone is enough", async () => {
    const pending = (await load()).pendingRevisionId!;
    const denied = await approve(editor, pending, "Looks good");
    expect(denied.status).toBe(403);
    const deniedReject = await reject(editor, pending, "No");
    expect(deniedReject.status).toBe(403);
    expect((await load()).canApprove).toBe(false);
    expect((await load(approver)).canApprove).toBe(true);
    expect((await revisions()).find((row) => row.id === pending)!.status).toBe("pending");
  });

  it("approves the first revision: it goes live at the typed REV and the approver is told to update the master list", async () => {
    const pending = (await load()).pendingRevisionId!;
    const wrongPin = await approve(approver, pending, "Checked", "0000");
    expect(wrongPin.status).toBe(403);
    const unchecked = await request(app).post(`/form-builder/${formId}/revisions/${pending}/approve`).set(as(approver)).send({ pin: TEST_PIN });
    expect(unchecked.status).toBe(400);
    expect(message(unchecked.body)).toBe("Check the certification box before approving.");
    expect((await load()).pendingRevisionId).toBe(pending);
    const res = await approve(approver, pending, "Checked against the paper form");
    expect(res.status).toBe(200);
    expect(res.body.notice).toBe("Update the Master Document List with the new revision.");
    const form = await load();
    expect(form.status).toBe("published");
    expect(form.revision).toBe("A");
    expect(form.publishedStructure).not.toBeNull();
    expect(form.pendingRevision).toBeNull();

    const row = (await revisions())[0]!;
    expect(row).toMatchObject({ status: "approved", approvedByName: "Approver One", decisionNote: "Checked against the paper form" });
    expect((row as Revision & { approvalSignature: string }).approvalSignature).toMatch(/Approver One/);
    const audit = await latestAudit("status_change");
    expect((audit.changes as { summary: string }).summary).toMatch(/^Approver One approved FRM-TEST-1 Rev Test Form REV A on .+: Checked against the paper form\.$/);

    const again = await approve(approver, pending, "Twice");
    expect(again.status).toBe(409);
  });

  it("opens a copy at REV A", async () => {
    const opened = await request(app).post(`/form-builder/${formId}/fills`).set(as(editor)).send({});
    expect(opened.status).toBe(201);
    expect(opened.body.templateRevision).toBe("A");
    fillId = opened.body.id;
  });

  it("rejects a structural change to a live form without a new REV, a description, or a different REV, and saves nothing", async () => {
    const form = await load();
    const historyBefore = (await revisions()).length;
    const next = withText(form.structure, "changed");
    const missing = await patch(editor, { structure: next, mode: "save", changeDescription: "Edited a label" });
    expect(missing.status).toBe(400);
    expect(message(missing.body)).toContain("Enter the new revision. It must be different from REV A.");
    expect((await patch(editor, { structure: next, mode: "save", newRevision: "a", changeDescription: "Edited a label" })).status).toBe(400);
    expect((await patch(editor, { structure: next, mode: "save", newRevision: "B" })).status).toBe(400);
    expect((await patch(editor, { structure: next, mode: "save", newRevision: "B".repeat(11), changeDescription: "x" })).status).toBe(400);
    const [row] = await db.select().from(builtForms).where(eq(builtForms.id, formId));
    expect(row!.revision).toBe("A");
    expect(JSON.stringify(row!.publishedStructure)).not.toContain("changed");
    expect((await revisions()).length).toBe(historyBefore);
  });

  it("sends a valid new REV to approval and leaves the live version, its REV and the filled copy alone", async () => {
    const form = await load();
    const saved = await patch(editor, { structure: withText(form.structure, "changed"), mode: "save", newRevision: " B ", changeDescription: "Added a title" });
    expect(saved.status).toBe(200);
    expect(saved.body.revision).toBe("A");
    expect(saved.body.pendingRevision).toBe("B");

    const list = await revisions();
    expect(list[0]).toMatchObject({ revision: "B", status: "pending", savedByName: "Rev Tester", description: "Added a title." });
    expect(list[0]!.summary).toMatch(/^Rev Tester changed FRM-TEST-1 Rev Test Form from REV A to REV B on .+: Added a title\.$/);
    const audit = await latestAudit("update");
    expect((audit.changes as { summary: string }).summary).toBe(list[0]!.summary);
    expect(JSON.stringify(audit.changes)).not.toMatch(/ID #/);

    const [row] = await db.select().from(builtForms).where(eq(builtForms.id, formId));
    expect(row!.revision).toBe("A");
    expect(JSON.stringify(row!.publishedStructure)).not.toContain("changed");
    const [fill] = await db.select().from(builtFormFills).where(eq(builtFormFills.id, fillId));
    expect(fill!.templateRevision).toBe("A");

    const another = await request(app).post(`/form-builder/${formId}/fills`).set(as(editor)).send({});
    expect(another.status).toBe(201);
    expect(another.body.templateRevision).toBe("A");
    expect(JSON.stringify(another.body.structure)).not.toContain("changed");
  });

  it("blocks another submit while one is pending, and autosave never moves the live version", async () => {
    const form = await load();
    const blocked = await patch(editor, { structure: withText(form.structure, "changed again"), mode: "save", newRevision: "C", changeDescription: "Again" });
    expect(blocked.status).toBe(409);
    expect(message(blocked.body)).toContain("REV B is waiting for approval");
    const autosave = await patch(editor, { structure: withText(form.structure, "typing"), mode: "autosave" });
    expect(autosave.status).toBe(200);
    expect(autosave.body.revision).toBe("A");
    const [row] = await db.select().from(builtForms).where(eq(builtForms.id, formId));
    expect(JSON.stringify(row!.publishedStructure)).not.toContain("typing");
  });

  it("rejects with a note: the old version stays live and the slot is free again", async () => {
    const pending = (await load()).pendingRevisionId!;
    const noNote = await reject(approver, pending, "   ");
    expect(noNote.status).toBe(400);
    expect(message(noNote.body)).toBe("Enter a note explaining why this revision is rejected.");
    expect((await reject(editor, pending, "No permission")).status).toBe(403);

    const res = await reject(approver, pending, "The title row overlaps the logo");
    expect(res.status).toBe(200);
    const form = await load();
    expect(form.revision).toBe("A");
    expect(form.status).toBe("published");
    expect(form.pendingRevision).toBeNull();
    expect(JSON.stringify(form.publishedStructure)).not.toContain("changed");
    const row = (await revisions()).find((item) => item.id === pending)!;
    expect(row).toMatchObject({ status: "rejected", approvedByName: "Approver One", decisionNote: "The title row overlaps the logo" });
    const audit = await latestAudit("status_change");
    expect((audit.changes as { summary: string }).summary).toMatch(/^Approver One rejected FRM-TEST-1 Rev Test Form REV B on .+: The title row overlaps the logo\.$/);
    expect((await approve(approver, pending, "late")).status).toBe(409);
  });

  it("lets the person who submitted a revision approve it, and the approver is on the audit entry", async () => {
    const form = await load(selfApprover);
    const submitted = await patch(selfApprover, { structure: withText(form.structure, "changed"), mode: "publish", newRevision: "B", changeDescription: "Added a title, fixed the overlap" });
    expect(submitted.status).toBe(200);
    expect(submitted.body.pendingRevision).toBe("B");
    const pending = (await load(selfApprover)).pendingRevisionId!;
    const res = await approve(selfApprover, pending);
    expect(res.status).toBe(200);

    const live = await load();
    expect(live.revision).toBe("B");
    expect(JSON.stringify(live.publishedStructure)).toContain("changed");
    const row = (await revisions())[0]!;
    expect(row).toMatchObject({ status: "approved", savedByName: "Both Roles", approvedByName: "Both Roles" });
    const audit = await latestAudit("status_change");
    expect((audit.changes as { summary: string }).summary).toMatch(/^Both Roles approved FRM-TEST-1 Rev Test Form REV B on .+\.$/);
  });

  it("never changed the REV by itself, and filled copies kept the revision they opened with", async () => {
    const [form] = await db.select().from(builtForms).where(eq(builtForms.id, formId));
    expect(form!.revision).toBe("B");
    const typed = (await db.select({ revision: builtFormRevisions.revision }).from(builtFormRevisions).where(eq(builtFormRevisions.formId, formId))).map((row) => row.revision);
    expect(new Set(typed)).toEqual(new Set(["A", "B"]));
    const [fill] = await db.select().from(builtFormFills).where(eq(builtFormFills.id, fillId));
    expect(fill!.templateRevision).toBe("A");
    expect(JSON.stringify(fill!.structure)).not.toContain("changed");
    const fresh = await request(app).post(`/form-builder/${formId}/fills`).set(as(editor)).send({});
    expect(fresh.body.templateRevision).toBe("B");
  });

  it("refuses a grid whose merges overlap and names the sheet and cell", async () => {
    const form = await load();
    const bad = JSON.parse(JSON.stringify(form.structure)) as { sheets: Array<{ cells: Array<Array<Record<string, unknown> | null>> }> };
    const cells = bad.sheets[0]!.cells;
    cells[0]![0] = { ...(cells[0]![0] as object), rowSpan: 2, colSpan: 2 } as Record<string, unknown>;
    cells[0]![1] = null;
    cells[1]![0] = null;
    cells[1]![1] = { ...(cells[1]![1] as object), rowSpan: 2, colSpan: 2 } as Record<string, unknown>;
    const res = await patch(editor, { structure: bad, mode: "autosave" });
    expect(res.status).toBe(400);
    expect(message(res.body)).toMatch(/Sheet 1 \("Sheet1"\), cell B2: the merge overlaps the merge at A1/);
  });
});

describe("form builder: the blank is filed when the revision is approved", () => {
  it("files nothing at publish and puts the blank in the chosen folder on approval", async () => {
    const [folder] = await db.insert(documentFolders).values({ name: BLANK_FORMS_FOLDER, parentId: null, sortOrder: 0 }).returning();
    const created = await request(app).post("/form-builder").set(as(selfApprover)).send({ kind: "grid", title: "Filing Test Form" });
    const id = created.body.id as number;
    const path = `/form-builder/template/${id}`;
    const published = await request(app).post(`/form-builder/${id}/publish`).set(as(selfApprover)).send({ folderId: folder!.id });
    expect(published.status).toBe(200);
    expect(published.body.submitted).toBe(true);
    expect(published.body.status).toBe("draft");
    expect(await db.select().from(documentFolders).where(eq(documentFolders.linkedPath, path))).toHaveLength(0);

    const form = (await request(app).get(`/form-builder/${id}`).set(as(selfApprover))).body as { pendingRevisionId: number };
    const approved = await request(app).post(`/form-builder/${id}/revisions/${form.pendingRevisionId}/approve`).set(as(selfApprover)).send({ pin: TEST_PIN, certified: true });
    expect(approved.status).toBe(200);
    const [leaf] = await db.select().from(documentFolders).where(eq(documentFolders.linkedPath, path));
    expect(leaf?.parentId).toBe(folder!.id);
    expect(leaf?.name).toBe("Filing Test Form");
  });
});
