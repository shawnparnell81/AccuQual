import { and, desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { controlledFormTemplates } from "../../src/drizzle/schema/controlledForms.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { users } from "../../src/drizzle/schema/users.js";
import { FORM_BUILDER_APPROVE_PERMISSION } from "../../src/modules/roles/roleAccess.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { ensureTestCompany } from "../helpers/company.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { setTestPin, TEST_PIN } from "../helpers/signaturePin.js";

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const formKey = `frm-rev-${suffix}`;

type History = {
  currentRevision: string | null;
  pendingRevision: string | null;
  pendingRevisionId: number | null;
  canEdit: boolean;
  canApprove: boolean;
  history: Array<{ id: number; revision: string; previousRevision: string | null; description: string; status: string; createdByName: string | null; approvedByName: string | null; approvalSignature: string | null; decisionNote: string | null }>;
};

let editor: string;
let reader: string;
let approver: string;
let selfApprover: string;
let templateId: number;

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const message = (body: { error?: { message?: string } | string; message?: string }) => body.message ?? (typeof body.error === "object" ? (body.error?.message ?? "") : "");

async function makeUser(label: string, department: string | null, permissions: string[], name: string) {
  const roleName = `fr-${label}-${suffix}`;
  await db.insert(roles).values({ name: roleName, description: label, hierarchyLevel: 80, isProtected: false, permissions });
  const [user] = await db.insert(users).values({ email: `fr-${label}-${suffix}@test.local`, passwordHash: "unused", name }).returning();
  await setTestPin(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department });
}

const load = async (token = editor) => {
  const res = await request(app).get(`/form-revisions/${formKey}`).set(as(token));
  expect(res.status).toBe(200);
  return res.body as History;
};
const start = (token: string, body: Record<string, unknown>) => request(app).post(`/form-revisions/${formKey}`).set(as(token)).send(body);
const approve = (token: string, id: number, body: Record<string, unknown> = {}) =>
  request(app).post(`/form-revisions/${formKey}/${id}/approve`).set(as(token)).send({ pin: TEST_PIN, certified: true, ...body });
const reject = (token: string, id: number, note?: string) => request(app).post(`/form-revisions/${formKey}/${id}/reject`).set(as(token)).send({ note });
const latestAudit = async () =>
  (await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "FormRevision"), eq(auditTrail.entityId, templateId))).orderBy(desc(auditTrail.id)).limit(1))[0]!;

describe("built-in form revisions: typed REV, PIN-signed approval, history", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [template] = await db.insert(controlledFormTemplates).values({ formKey, formId: "FRM-REV-001", title: "Revision Test Form", subjectRoute: "/documents" }).returning();
    templateId = template!.id;
    editor = await makeUser("editor", "quality", [], "Form Editor");
    reader = await makeUser("reader", "production", [], "Form Reader");
    approver = await makeUser("approver", "production", [FORM_BUILDER_APPROVE_PERMISSION], "Form Approver");
    selfApprover = await makeUser("both", "quality", [FORM_BUILDER_APPROVE_PERMISSION], "Edit And Approve");
  });

  it("shows an empty history, and only Documents edit can start a revision", async () => {
    const view = await load(reader);
    expect(view).toMatchObject({ currentRevision: null, pendingRevision: null, canEdit: false, canApprove: false, history: [] });
    const denied = await start(reader, { newRevision: "A", changeDescription: "First issue" });
    expect(denied.status).toBe(403);
    expect((await load()).canEdit).toBe(true);
    expect((await request(app).get(`/form-revisions/no-such-form-${suffix}`).set(as(editor))).status).toBe(404);
  });

  it("needs a typed REV and a description, and never fills one in", async () => {
    const noRev = await start(editor, { changeDescription: "First issue" });
    expect(noRev.status).toBe(400);
    expect(message(noRev.body)).toBe("Enter the revision, such as A.");
    const noText = await start(editor, { newRevision: "A", changeDescription: "  " });
    expect(noText.status).toBe(400);
    expect(message(noText.body)).toBe("Describe what changed in this revision.");
    const tooLong = await start(editor, { newRevision: "ABCDEFGHIJK", changeDescription: "x" });
    expect(tooLong.status).toBe(400);
    expect((await load()).history).toHaveLength(0);
  });

  it("starts REV A as pending and audit-logs who, what, when and the description", async () => {
    const res = await start(editor, { newRevision: "A", changeDescription: "First issue of the form" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ currentRevision: null, pendingRevision: "A" });
    const audit = await latestAudit();
    expect(audit.performedBy).not.toBeNull();
    expect((audit.changes as { summary: string }).summary).toMatch(/^Form Editor started FRM-REV-001 Revision Test Form REV A on .+: First issue of the form\.$/);
    const again = await start(editor, { newRevision: "B", changeDescription: "Too soon" });
    expect(again.status).toBe(409);
  });

  it("approves only with the approve permission, the certification box and a correct PIN", async () => {
    const pending = (await load()).pendingRevisionId!;
    expect((await approve(editor, pending)).status).toBe(403);
    expect((await approve(approver, pending, { pin: "0000" })).status).toBe(403);
    const unchecked = await approve(approver, pending, { certified: false });
    expect(unchecked.status).toBe(400);
    expect((await load()).pendingRevision).toBe("A");
    const res = await approve(approver, pending, { note: "Matches the paper master" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ currentRevision: "A", pendingRevision: null });
    const row = (res.body as History).history[0]!;
    expect(row).toMatchObject({ status: "approved", createdByName: "Form Editor", approvedByName: "Form Approver", decisionNote: "Matches the paper master" });
    expect(row.approvalSignature).toMatch(/Form Approver/);
    const audit = await latestAudit();
    expect((audit.changes as { summary: string; signature: string }).summary).toMatch(/^Form Approver approved FRM-REV-001 Revision Test Form REV A on .+: Matches the paper master\.$/);
    expect((await approve(approver, pending)).status).toBe(409);
  });

  it("requires a REV different from the current one, and rejection needs a note and keeps the current REV", async () => {
    const same = await start(editor, { newRevision: "a", changeDescription: "Same rev" });
    expect(same.status).toBe(400);
    expect(message(same.body)).toBe("Enter the new revision. It must be different from REV A.");
    const res = await start(editor, { newRevision: "B", changeDescription: "Added a torque column" });
    expect(res.status).toBe(201);
    const pending = (res.body as History).pendingRevisionId!;
    expect((await reject(approver, pending, " ")).status).toBe(400);
    const rejected = await reject(approver, pending, "Column width is wrong");
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({ currentRevision: "A", pendingRevision: null });
    expect((rejected.body as History).history[0]).toMatchObject({ revision: "B", previousRevision: "A", status: "rejected", decisionNote: "Column width is wrong" });
  });

  it("lets the person who started a revision approve it", async () => {
    const res = await start(selfApprover, { newRevision: "B", changeDescription: "Added a torque column, fixed width" });
    expect(res.status).toBe(201);
    const approved = await approve(selfApprover, (res.body as History).pendingRevisionId!);
    expect(approved.status).toBe(200);
    const view = approved.body as History;
    expect(view.currentRevision).toBe("B");
    expect(view.history.map((row) => `${row.revision}:${row.status}`)).toEqual(["B:approved", "B:rejected", "A:approved"]);
    expect(view.history[0]).toMatchObject({ createdByName: "Edit And Approve", approvedByName: "Edit And Approve" });
  });
});
