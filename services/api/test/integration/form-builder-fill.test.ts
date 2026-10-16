import { and, desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { builtFormFills } from "../../src/drizzle/schema/builtForms.js";
import { documentFolders } from "../../src/drizzle/schema/documentFolders.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { users } from "../../src/drizzle/schema/users.js";
import { FORM_BUILDER_APPROVE_PERMISSION, FORM_BUILDER_PERMISSION } from "../../src/modules/roles/roleAccess.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { ensureTestCompany } from "../helpers/company.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { setTestPin, TEST_PIN } from "../helpers/signaturePin.js";

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const message = (body: { error?: { message?: string } | string; message?: string }) => body.message ?? (typeof body.error === "object" ? (body.error?.message ?? "") : "");

let editor: string;
let outsider: string;
let formId: number;
let fillId: number;
let folderId: number;

async function makeUser(label: string, permissions: string[], name: string) {
  const roleName = `fbfill-${label}-${suffix}`;
  await db.insert(roles).values({ name: roleName, description: label, hierarchyLevel: 80, isProtected: false, permissions });
  const [user] = await db.insert(users).values({ email: `fbfill-${label}-${suffix}@test.local`, passwordHash: "unused", name }).returning();
  await setTestPin(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department: null });
}

const cell = (extra: Record<string, unknown> = {}) => ({ value: "", locked: false, rowSpan: 1, colSpan: 1, style: {}, ...extra });

const structure = {
  kind: "grid",
  sheets: [
    {
      name: "Readings",
      colWidths: [90, 90, 90, 160, 90],
      rowHeights: [24, 24],
      cells: [
        [cell({ value: "Length", locked: true, type: "label" }), cell({ value: "Width", locked: true, type: "label" }), cell({ value: "Area", locked: true, type: "label" }), cell({ value: "Inspector", locked: true, type: "label" }), cell({ value: "Result", locked: true, type: "label" })],
        [cell({ type: "number", decimals: 2 }), cell({ type: "number" }), cell({ formula: "A2*B2", locked: true, decimals: 1 }), cell({ type: "signature", locked: true }), cell({ formula: 'IF(C2>10,"Pass","Fail")', locked: true, conditional: true })],
      ],
    },
  ],
};

async function audits(event: string) {
  const rows = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "BuiltFormFill"), eq(auditTrail.entityId, fillId))).orderBy(desc(auditTrail.id));
  return rows.filter((row) => (row.changes as { event?: string } | null)?.event === event);
}

describe("form builder: filling a grid copy", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    editor = await makeUser("editor", [FORM_BUILDER_PERMISSION, FORM_BUILDER_APPROVE_PERMISSION], "Fill Tester");
    outsider = await makeUser("outsider", [], "No Access");
    const created = await request(app).post("/form-builder").set(as(editor)).send({ kind: "grid", title: `Fill Test ${suffix}` });
    expect(created.status).toBe(201);
    formId = created.body.id;
    expect((await request(app).patch(`/form-builder/${formId}`).set(as(editor)).send({ structure, newRevision: "A", mode: "save" })).status).toBe(200);
    expect((await request(app).patch(`/form-builder/${formId}`).set(as(editor)).send({ structure, mode: "publish" })).status).toBe(200);
    const pending = (await request(app).get(`/form-builder/${formId}`).set(as(editor))).body.pendingRevisionId as number;
    const approved = await request(app).post(`/form-builder/${formId}/revisions/${pending}/approve`).set(as(editor)).send({ pin: TEST_PIN, certified: true });
    expect(approved.status).toBe(200);
    const [folder] = await db.insert(documentFolders).values({ name: `Fill Test Folder ${suffix}`, parentId: null, sortOrder: 0 }).returning();
    folderId = folder!.id;
  });

  it("refuses a bad formula in the layout and names the cell", async () => {
    const bad = JSON.parse(JSON.stringify(structure));
    bad.sheets[0].cells[1][2].formula = "A2*";
    const res = await request(app).post("/form-builder").set(as(editor)).send({ kind: "grid", title: `Bad ${suffix}` });
    const saved = await request(app).patch(`/form-builder/${res.body.id}`).set(as(editor)).send({ structure: bad, mode: "save" });
    expect(saved.status).toBe(400);
    expect(message(saved.body)).toMatch(/Sheet 1 \("Readings"\), cell C2: the formula =A2\* cannot be saved\. The formula ends too soon\./);
  });

  it("someone without edit access cannot open, save, sign, file or edit a copy", async () => {
    expect((await request(app).post(`/form-builder/${formId}/fills`).set(as(outsider)).send({})).status).toBe(403);
    const opened = await request(app).post(`/form-builder/${formId}/fills`).set(as(editor)).send({});
    expect(opened.status).toBe(201);
    fillId = opened.body.id;
    expect((await request(app).patch(`/form-builder/fills/${fillId}`).set(as(outsider)).send({ answers: { "0!A2": "1" } })).status).toBe(403);
    expect((await request(app).post(`/form-builder/fills/${fillId}/sign`).set(as(outsider)).send({ fieldId: "0!D2", pin: TEST_PIN, certified: true })).status).toBe(403);
    expect((await request(app).post(`/form-builder/fills/${fillId}/file`).set(as(outsider)).send({ folderId })).status).toBe(403);
    expect((await request(app).post(`/form-builder/fills/${fillId}/begin-edit`).set(as(outsider)).send({})).status).toBe(403);
    const [row] = await db.select().from(builtFormFills).where(eq(builtFormFills.id, fillId));
    expect(row!.answers).toEqual({});
  });

  it("Edit, Save and Cancel each write a who/what/when line", async () => {
    for (const action of [undefined, "save", "cancel"]) {
      const res = await request(app).post(`/form-builder/fills/${fillId}/begin-edit`).set(as(editor)).send(action ? { action } : {});
      expect(res.status).toBe(200);
    }
    const started = (await audits("edit_started"))[0]!;
    expect((started.changes as { summary: string }).summary).toMatch(/^Fill Tester opened filled form \d+ for editing on .+\.$|^Fill Tester .+filled form \d+ on .+\.$/);
    expect((await audits("edit_saved")).length).toBe(1);
    expect((await audits("edit_canceled")).length).toBe(1);
  });

  it("works out formula cells on the server and ignores values sent for them, and keeps text typed into a number cell", async () => {
    const res = await request(app)
      .patch(`/form-builder/fills/${fillId}`)
      .set(as(editor))
      .send({ answers: { "0!A2": "2.5", "0!B2": "6", "0!C2": "999", "0!E2": "Pass", "0!A1": "renamed", "0!D2": { stamped: true, text: "Forged Person, Jan 1" } } });
    expect(res.status).toBe(200);
    expect(res.body.answers).toMatchObject({ "0!A2": "2.5", "0!B2": "6", "0!C2": "15.0", "0!E2": "Pass" });
    expect(res.body.answers["0!A1"]).toBeUndefined();
    expect(res.body.answers["0!D2"]).toBeUndefined();

    const text = await request(app).patch(`/form-builder/fills/${fillId}`).set(as(editor)).send({ answers: { "0!A2": "two", "0!B2": "6" } });
    expect(text.body.answers["0!A2"]).toBe("two");
    expect(text.body.answers["0!C2"]).toBe("#VALUE!");
    expect(text.body.answers["0!E2"]).toBe("#VALUE!");

    const fixed = await request(app).patch(`/form-builder/fills/${fillId}`).set(as(editor)).send({ answers: { "0!A2": "1", "0!B2": "4" } });
    expect(fixed.body.answers["0!C2"]).toBe("4.0");
    expect(fixed.body.answers["0!E2"]).toBe("Fail");
  });

  it("logs every save, even one that changes nothing", async () => {
    const before = (await audits("form_saved")).length;
    const same = await request(app).patch(`/form-builder/fills/${fillId}`).set(as(editor)).send({ answers: { "0!A2": "1", "0!B2": "4" } });
    expect(same.status).toBe(200);
    const saves = await audits("form_saved");
    expect(saves.length).toBe(before + 1);
    expect((saves[0]!.changes as { summary: string }).summary).toMatch(/^Fill Tester saved filled form .*"Fill Test .+" on .+\. No values changed\.$/);
    expect((saves[1]!.changes as { summary: string }).summary).toMatch(/4 values changed\.$/);
  });

  it("signs a signature cell with PIN and certification, once", async () => {
    const unchecked = await request(app).post(`/form-builder/fills/${fillId}/sign`).set(as(editor)).send({ fieldId: "0!D2", pin: TEST_PIN });
    expect(unchecked.status).toBe(400);
    expect(message(unchecked.body)).toBe("Tick the certification box to sign.");
    const wrong = await request(app).post(`/form-builder/fills/${fillId}/sign`).set(as(editor)).send({ fieldId: "0!D2", pin: "0000", certified: true });
    expect(wrong.status).toBe(403);
    const notSignature = await request(app).post(`/form-builder/fills/${fillId}/sign`).set(as(editor)).send({ fieldId: "0!A2", pin: TEST_PIN, certified: true });
    expect(notSignature.status).toBe(400);
    expect(message(notSignature.body)).toBe("That cell is not a signature on this form.");
    const signed = await request(app).post(`/form-builder/fills/${fillId}/sign`).set(as(editor)).send({ fieldId: "0!D2", pin: TEST_PIN, certified: true });
    expect(signed.status).toBe(200);
    expect(signed.body.answers["0!D2"].stamped).toBe(true);
    expect(signed.body.answers["0!D2"].text).toMatch(/^Fill Tester/);
    const again = await request(app).post(`/form-builder/fills/${fillId}/sign`).set(as(editor)).send({ fieldId: "0!D2", pin: TEST_PIN, certified: true });
    expect(again.status).toBe(400);
    const audit = (await audits("form_signed"))[0]!;
    expect((audit.changes as { summary: string }).summary).toMatch(/^Fill Tester signed cell D2 on filled form .+ with their PIN on .+\. Stamp: Fill Tester/);

    // A later save keeps the stamp, even when the browser leaves it out or sends something else.
    const later = await request(app).patch(`/form-builder/fills/${fillId}`).set(as(editor)).send({ answers: { "0!A2": "3", "0!B2": "4", "0!D2": "typed over" } });
    expect(later.body.answers["0!D2"].stamped).toBe(true);
    expect(later.body.answers["0!C2"]).toBe("12.0");
  });

  it("Save as files the copy in the chosen folder, says where, and logs it", async () => {
    const filed = await request(app).post(`/form-builder/fills/${fillId}/file`).set(as(editor)).send({ folderId });
    expect(filed.status).toBe(200);
    expect(filed.body.folder).toContain(`Fill Test Folder ${suffix}`);
    const got = await request(app).get(`/form-builder/fills/${fillId}`).set(as(editor));
    expect(got.body.folderLabel).toBe(filed.body.folder);
    const audit = (await audits("form_filed"))[0]!;
    expect((audit.changes as { summary: string }).summary).toMatch(new RegExp(`^Fill Tester saved filled form .+ to .*Fill Test Folder ${suffix}.* on .+\\.$`));
    const blank = await db.select().from(documentFolders).where(eq(documentFolders.linkedPath, `/form-builder/fills/${fillId}`));
    expect(blank).toHaveLength(1);
  });

  it("downloads a PDF of the copy, logs it, and refuses someone who cannot view it", async () => {
    const res = await request(app).get(`/form-builder/fills/${fillId}/pdf`).set(as(editor)).buffer(true).parse((response, done) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => done(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename=".+_Rev-A\.pdf"/);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    const audit = (await audits("pdf_export"))[0]!;
    expect((audit.changes as { summary: string }).summary).toMatch(/^Fill Tester downloaded a PDF of filled form .+ \(REV A, 1 page\) on .+\.$/);
    expect((await request(app).get(`/form-builder/fills/${fillId}/pdf`).set(as(outsider))).status).toBe(403);
  });
});
