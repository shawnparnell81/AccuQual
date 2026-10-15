import { ensureTestCompany } from "../helpers/company.js";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { controlledLists } from "../../src/drizzle/schema/controlledLists.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = `${Date.now()}`;
let editor: string;
let second: string;
let viewer: string;

async function person(label: string, roleName: string) {
  const [user] = await db.insert(users).values({ email: `lock-${label}-${suffix}@test.local`, name: `Lock ${label}`, passwordHash: "unused" }).returning();
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department: "quality" });
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

async function summaries(listId: number) {
  const rows = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "ControlledList"), eq(auditTrail.entityId, listId)));
  return rows.map((row) => String((row.changes as { summary?: string } | null)?.summary ?? ""));
}

describe("master lists open read-only until Edit", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    await db.insert(roles).values({ name: `lock-editor-${suffix}`, description: "Edits master lists", hierarchyLevel: 80, isProtected: false, permissions: ["controlled_lists.edit"] });
    await db.insert(roles).values({ name: `lock-viewer-${suffix}`, description: "No list edits", hierarchyLevel: 80, isProtected: false, permissions: [] });
    editor = await person("editor", `lock-editor-${suffix}`);
    second = await person("second", `lock-editor-${suffix}`);
    viewer = await person("viewer", `lock-viewer-${suffix}`);
  });

  for (const key of ["lst-eqp-001", "lst-gen-001", "lst-gen-002", "lst-gen-003", "lst-dev-001", "lst-ncr-001", "lst-eng-001"]) {
    it(`${key}: refuses every write without the permission, and without an open Edit`, async () => {
      const view = await request(app).get(`/controlled-lists/${key}`).set(as(viewer));
      expect(view.status).toBe(200);
      expect(view.body.locked).toBe(true);
      expect(view.body.canEditList).toBe(false);
      expect(view.body.canEditStructure).toBe(false);
      const sheet = view.body.sheets[0].name as string;
      for (const token of [viewer, editor]) {
        expect((await request(app).put(`/controlled-lists/${key}`).set(as(token)).send({ sheets: [{ name: sheet, cells: { B9: { v: "x" } } }] })).status).toBe(403);
        expect((await request(app).post(`/controlled-lists/${key}/rows`).set(as(token)).send({ sheet, op: "add" })).status).toBe(403);
        expect((await request(app).post(`/controlled-lists/${key}/rows`).set(as(token)).send({ sheet, op: "delete", row: 9 })).status).toBe(403);
        expect((await request(app).post(`/controlled-lists/${key}/columns`).set(as(token)).send({ sheet, op: "add" })).status).toBe(403);
        expect((await request(app).post(`/controlled-lists/${key}/location`).set(as(token)).send({ sheet, path: "A/B" })).status).toBe(403);
      }
      expect((await request(app).post(`/controlled-lists/${key}/edit`).set(as(viewer)).send({ action: "start" })).status).toBe(403);
      const editorView = await request(app).get(`/controlled-lists/${key}`).set(as(editor));
      expect(editorView.body.canEditList).toBe(true);
      expect(editorView.body.editSession).toBeNull();
    });
  }

  it("Edit unlocks, others keep the saved copy, Save keeps edits and locks, all audited", async () => {
    const key = "lst-gen-003";
    const before = await request(app).get(`/controlled-lists/${key}`).set(as(editor));
    const sheet = before.body.sheets[0];
    const start = before.body.dataStart[sheet.name] as number;
    const started = await request(app).post(`/controlled-lists/${key}/edit`).set(as(editor)).send({ action: "start" });
    expect(started.status).toBe(200);
    expect(started.body.editSession.mine).toBe(true);
    const added = await request(app).post(`/controlled-lists/${key}/rows`).set(as(editor)).send({ sheet: sheet.name, op: "add" });
    expect(added.status).toBe(200);
    const put = await request(app).put(`/controlled-lists/${key}`).set(as(editor)).send({ sheets: [{ name: sheet.name, cells: { [`A${start}`]: { v: `Saved ${suffix}` } } }] });
    expect(put.status).toBe(200);

    // A second editor cannot start, and a viewer sees the copy from before Edit.
    const blocked = await request(app).post(`/controlled-lists/${key}/edit`).set(as(second)).send({ action: "start" });
    expect(blocked.status).toBe(409);
    expect((await request(app).put(`/controlled-lists/${key}`).set(as(second)).send({ sheets: [{ name: sheet.name, cells: { [`A${start}`]: { v: "no" } } }] })).status).toBe(403);
    const others = await request(app).get(`/controlled-lists/${key}`).set(as(viewer));
    expect(others.body.editSession.mine).toBe(false);
    expect(others.body.sheets[0].cells[`A${start}`]?.v ?? null).toBe(sheet.cells[`A${start}`]?.v ?? null);

    const saved = await request(app).post(`/controlled-lists/${key}/edit`).set(as(editor)).send({ action: "save" });
    expect(saved.status).toBe(200);
    expect(saved.body.editSession).toBeNull();
    expect(saved.body.revision).toBe(before.body.revision);
    const after = await request(app).get(`/controlled-lists/${key}`).set(as(viewer));
    expect(after.body.sheets[0].cells[`A${start}`].v).toBe(`Saved ${suffix}`);
    expect((await request(app).put(`/controlled-lists/${key}`).set(as(editor)).send({ sheets: [{ name: sheet.name, cells: { [`A${start}`]: { v: "late" } } }] })).status).toBe(403);

    const log = await summaries(before.body.id);
    expect(log.some((line) => /^Lock editor started editing LST-GEN-003 .* on .+\. Revision /.test(line))).toBe(true);
    expect(log.some((line) => /^Lock editor saved edits to LST-GEN-003 .* on .+: .*cell.* changed.*row.* added.*locked again\.$/.test(line))).toBe(true);
  });

  it("Cancel discards cells and rows since Edit, keeps Rev, and is audited", async () => {
    const key = "lst-eqp-001";
    const before = await request(app).get(`/controlled-lists/${key}`).set(as(editor));
    const sheet = before.body.sheets[0];
    expect((await request(app).post(`/controlled-lists/${key}/edit`).set(as(editor)).send({ action: "start" })).status).toBe(200);
    expect((await request(app).post(`/controlled-lists/${key}/rows`).set(as(editor)).send({ sheet: sheet.name, op: "add" })).status).toBe(200);
    const start = before.body.dataStart[sheet.name] as number;
    expect((await request(app).put(`/controlled-lists/${key}`).set(as(editor)).send({ sheets: [{ name: sheet.name, cells: { [`B${start}`]: { v: `Discard ${suffix}` } } }] })).status).toBe(200);
    const canceled = await request(app).post(`/controlled-lists/${key}/edit`).set(as(editor)).send({ action: "cancel" });
    expect(canceled.status).toBe(200);
    expect(canceled.body.editSession).toBeNull();
    expect(canceled.body.revision).toBe(before.body.revision);
    const [row] = await db.select().from(controlledLists).where(eq(controlledLists.listKey, key));
    expect(row!.sheets[0]!.maxRow).toBe(sheet.maxRow);
    expect(JSON.stringify(row!.sheets)).not.toContain(`Discard ${suffix}`);
    expect(row!.editSnapshot).toBeNull();
    const log = await summaries(before.body.id);
    expect(log.some((line) => /^Lock editor canceled editing LST-EQP-001 .* on .+\. Discarded: .*locked again\.$/.test(line))).toBe(true);
    expect((await request(app).post(`/controlled-lists/${key}/edit`).set(as(editor)).send({ action: "save" })).status).toBe(403);
  });

});
