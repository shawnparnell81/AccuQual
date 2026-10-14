import { and, desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { builtFormFills, builtFormRevisions, builtForms } from "../../src/drizzle/schema/builtForms.js";
import { users } from "../../src/drizzle/schema/users.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { ensureTestCompany } from "../helpers/company.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

let token: string;
let formId: number;
let fillId: number;

const auth = () => ({ Authorization: `Bearer ${token}` });

async function load() {
  const res = await request(app).get(`/form-builder/${formId}`).set(auth());
  expect(res.status).toBe(200);
  return res.body as { revision: string; status: string; structure: { sheets: Array<{ cells: Array<Array<{ value: string } | null>> }> } };
}

function withText(structure: unknown, text: string) {
  const copy = JSON.parse(JSON.stringify(structure)) as { sheets: Array<{ cells: Array<Array<{ value: string } | null>> }> };
  copy.sheets[0]!.cells[0]![0]!.value = text;
  return copy;
}

const revisionRows = () => db.select().from(builtFormRevisions).where(eq(builtFormRevisions.formId, formId));

describe("form builder: manual revisions and change history", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [user] = await db.insert(users).values({ email: `fb-rev-${suffix}@test.local`, passwordHash: "unused", name: "Rev Tester" }).returning();
    token = signAccessToken({ sub: String(user!.id), roleId: null, roleName: "admin", department: null });
    const created = await request(app).post("/form-builder").set(auth()).send({ kind: "grid", title: "Rev Test Form" });
    expect(created.status).toBe(201);
    formId = created.body.id;
  });

  it("starts at REV A and a draft save or autosave keeps it", async () => {
    const form = await load();
    expect(form.revision).toBe("A");
    const autosave = await request(app).patch(`/form-builder/${formId}`).set(auth()).send({ structure: withText(form.structure, "draft one"), mode: "autosave" });
    expect(autosave.status).toBe(200);
    expect(autosave.body.revision).toBe("A");
    const save = await request(app).patch(`/form-builder/${formId}`).set(auth()).send({ formNumber: "FRM-TEST-1", structure: withText(form.structure, "draft two"), mode: "save" });
    expect(save.status).toBe(200);
    expect(save.body.revision).toBe("A");
    expect(save.body.status).toBe("draft");
  });

  it("lets a draft take a typed REV, and keeps it on the first publish", async () => {
    const form = await load();
    const typed = await request(app).patch(`/form-builder/${formId}`).set(auth()).send({ newRevision: "A", structure: form.structure, mode: "save" });
    expect(typed.status).toBe(200);
    const published = await request(app).patch(`/form-builder/${formId}`).set(auth()).send({ structure: form.structure, mode: "publish" });
    expect(published.status).toBe(200);
    expect(published.body.status).toBe("published");
    expect(published.body.revision).toBe("A");
  });

  it("opens a copy at REV A", async () => {
    const opened = await request(app).post(`/form-builder/${formId}/fills`).set(auth()).send({});
    expect(opened.status).toBe(201);
    expect(opened.body.templateRevision).toBe("A");
    fillId = opened.body.id;
  });

  it("rejects a structural change to a published form without a new REV and saves nothing", async () => {
    const form = await load();
    const historyBefore = (await revisionRows()).length;
    const next = withText(form.structure, "changed");
    const missing = await request(app).patch(`/form-builder/${formId}`).set(auth()).send({ structure: next, mode: "save", changeDescription: "Edited a label" });
    expect(missing.status).toBe(400);
    expect(missing.body.error?.message ?? missing.body.message).toContain("Enter the new revision. It must be different from REV A.");
    const same = await request(app).patch(`/form-builder/${formId}`).set(auth()).send({ structure: next, mode: "save", newRevision: "a", changeDescription: "Edited a label" });
    expect(same.status).toBe(400);
    const noNote = await request(app).patch(`/form-builder/${formId}`).set(auth()).send({ structure: next, mode: "save", newRevision: "B" });
    expect(noNote.status).toBe(400);
    const tooLong = await request(app).patch(`/form-builder/${formId}`).set(auth()).send({ structure: next, mode: "save", newRevision: "B".repeat(11), changeDescription: "x" });
    expect(tooLong.status).toBe(400);

    const [row] = await db.select().from(builtForms).where(eq(builtForms.id, formId));
    expect(row!.revision).toBe("A");
    expect(JSON.stringify(row!.publishedStructure)).not.toContain("changed");
    expect((await revisionRows()).length).toBe(historyBefore);
  });

  it("applies a valid new REV, writes a history row and an audit entry, and leaves the filled copy alone", async () => {
    const form = await load();
    const next = withText(form.structure, "changed");
    const saved = await request(app).patch(`/form-builder/${formId}`).set(auth()).send({ structure: next, mode: "save", newRevision: " B ", changeDescription: "Added a title" });
    expect(saved.status).toBe(200);
    expect(saved.body.revision).toBe("B");

    const rows = await request(app).get(`/form-builder/${formId}/revisions`).set(auth());
    expect(rows.status).toBe(200);
    const newest = rows.body[0];
    expect(newest.revision).toBe("B");
    expect(newest.savedByName).toBe("Rev Tester");
    expect(newest.description).toBe("Added a title.");
    expect(newest.summary).toMatch(/^Rev Tester changed FRM-TEST-1 Rev Test Form from REV A to REV B on .+: Added a title\.$/);

    const [audit] = await db
      .select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityType, "BuiltForm"), eq(auditTrail.entityId, formId), eq(auditTrail.action, "update")))
      .orderBy(desc(auditTrail.id))
      .limit(1);
    expect((audit!.changes as { summary: string }).summary).toBe(newest.summary);
    expect(JSON.stringify(audit!.changes)).not.toMatch(/ID #|"entityId"/);

    const [fill] = await db.select().from(builtFormFills).where(eq(builtFormFills.id, fillId));
    expect(fill!.templateRevision).toBe("A");
    expect(JSON.stringify(fill!.structure)).not.toContain("changed");
  });

  it("does not move the REV on autosave or on a save that changes nothing", async () => {
    const form = await load();
    const historyBefore = (await revisionRows()).length;
    const autosave = await request(app).patch(`/form-builder/${formId}`).set(auth()).send({ structure: withText(form.structure, "typing"), mode: "autosave" });
    expect(autosave.status).toBe(200);
    expect(autosave.body.revision).toBe("B");
    const [row] = await db.select().from(builtForms).where(eq(builtForms.id, formId));
    expect(JSON.stringify(row!.publishedStructure)).not.toContain("typing");
    const unchanged = await request(app).patch(`/form-builder/${formId}`).set(auth()).send({ structure: row!.publishedStructure, mode: "save" });
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.revision).toBe("B");
    expect((await revisionRows()).length).toBe(historyBefore);
  });

  it("publish needs the new REV too", async () => {
    const [row] = await db.select().from(builtForms).where(eq(builtForms.id, formId));
    const next = withText(row!.structure, "second change");
    const denied = await request(app).patch(`/form-builder/${formId}`).set(auth()).send({ structure: next, mode: "publish" });
    expect(denied.status).toBe(400);
    const ok = await request(app).patch(`/form-builder/${formId}`).set(auth()).send({ structure: next, mode: "publish", newRevision: "C", changeDescription: "Second change" });
    expect(ok.status).toBe(200);
    expect(ok.body.revision).toBe("C");
    const [fill] = await db.select().from(builtFormFills).where(eq(builtFormFills.id, fillId));
    expect(fill!.templateRevision).toBe("A");
  });

  it("refuses a grid whose merges overlap and names the sheet and cell", async () => {
    const form = await load();
    const bad = JSON.parse(JSON.stringify(form.structure)) as { sheets: Array<{ cells: Array<Array<Record<string, unknown> | null>> }> };
    const cells = bad.sheets[0]!.cells;
    cells[0]![0] = { ...(cells[0]![0] as object), rowSpan: 2, colSpan: 2 } as Record<string, unknown>;
    cells[0]![1] = null;
    cells[1]![0] = null;
    cells[1]![1] = { ...(cells[1]![1] as object), rowSpan: 2, colSpan: 2 } as Record<string, unknown>;
    const res = await request(app).patch(`/form-builder/${formId}`).set(auth()).send({ structure: bad, mode: "autosave" });
    expect(res.status).toBe(400);
    expect(res.body.error?.message ?? res.body.message).toMatch(/Sheet 1 \("Sheet1"\), cell B2: the merge overlaps the merge at A1/);
  });
});
