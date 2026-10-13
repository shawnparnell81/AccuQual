import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ensureTestCompany } from "./helpers/company.js";
import { createApp } from "../src/app.js";
import { db } from "../src/db/index.js";
import { users } from "../src/drizzle/schema/users.js";
import { roles } from "../src/drizzle/schema/roles.js";
import { ncr } from "../src/drizzle/schema/ncr.js";
import { auditTrail } from "../src/drizzle/schema/auditTrail.js";
import { attachments } from "../src/drizzle/schema/attachments.js";
import { qualityEngineeringReports } from "../src/drizzle/schema/qualityEngineeringReport.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { seedDefaultPermissions, seedTestRoles } from "./helpers/seedDefaults.js";
import { setTestPin, TEST_PIN } from "./helpers/signaturePin.js";
import { updateRoleSchema } from "../src/modules/roles/roles.validation.js";

const docx = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "monthly-quality-report-september-2026.docx"));

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const YEAR = 2027;
const DELETE_MONTH = 1;
const OTHER_MONTH = 2;
const PERMISSION = "quality_report.delete";
let deleterToken: string;
let plainToken: string;
const userIds: number[] = [];
let deleterId: number;

async function makeUser(roleName: string, label: string) {
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, roleName));
  const [user] = await db
    .insert(users)
    .values({ email: `qr-del-${label}-${suffix}@test.local`, passwordHash: "unused", department: "quality", roleId: role?.id ?? null, name: `Delete Tester ${label}` })
    .returning();
  userIds.push(user!.id);
  await setTestPin(user!.id);
  return { id: user!.id, token: await signAccessToken({ sub: String(user!.id), roleId: null, roleName, department: "quality" }) };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function activeRow(month: number) {
  const [row] = await db
    .select()
    .from(qualityEngineeringReports)
    .where(and(eq(qualityEngineeringReports.year, YEAR), eq(qualityEngineeringReports.month, month), eq(qualityEngineeringReports.isDeleted, false)));
  return row;
}

async function allRows(month: number) {
  return db.select().from(qualityEngineeringReports).where(and(eq(qualityEngineeringReports.year, YEAR), eq(qualityEngineeringReports.month, month)));
}

const upload = (token: string, month: number) =>
  request(app).post("/reports/engineering/upload").set(bearer(token)).field("year", String(YEAR)).field("month", String(month)).field("replaceNotes", "true").attach("file", docx, "report.docx");

const remove = (token: string, month: number, body: unknown) =>
  request(app).delete("/reports/engineering").query({ year: YEAR, month }).set(bearer(token)).send(body as object);

async function wipe() {
  for (const month of [DELETE_MONTH, OTHER_MONTH]) {
    const rows = await allRows(month);
    for (const row of rows) {
      const stored = await db.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.entityType, "quality_engineering_report"), eq(attachments.entityId, row.id)));
      if (stored.length) await db.delete(attachments).where(inArray(attachments.id, stored.map((item) => item.id)));
      await db.delete(qualityEngineeringReports).where(eq(qualityEngineeringReports.id, row.id));
    }
  }
}

beforeAll(async () => {
  const co = await ensureTestCompany();
  await seedDefaultPermissions(co!.id);
  await seedTestRoles();
  const [lead] = await db.select().from(roles).where(eq(roles.name, "lead"));
  if (lead) await db.update(roles).set({ permissions: [...new Set([...(lead.permissions ?? []), PERMISSION])] }).where(eq(roles.id, lead.id));
  const [operator] = await db.select().from(roles).where(eq(roles.name, "operator"));
  if (operator) await db.update(roles).set({ permissions: (operator.permissions ?? []).filter((item) => item !== PERMISSION) }).where(eq(roles.id, operator.id));
  const deleter = await makeUser("lead", "deleter");
  deleterToken = deleter.token;
  deleterId = deleter.id;
  plainToken = (await makeUser("operator", "plain")).token;
  await wipe();
});

afterAll(async () => {
  await wipe();
  const [lead] = await db.select().from(roles).where(eq(roles.name, "lead"));
  if (lead) await db.update(roles).set({ permissions: (lead.permissions ?? []).filter((item) => item !== PERMISSION) }).where(eq(roles.id, lead.id));
  for (const id of userIds) await db.delete(users).where(eq(users.id, id)).catch(() => {});
});

describe("delete a month's Monthly Quality Report", () => {
  it("is a role permission: the Roles page can assign it and the effective list reports it", async () => {
    expect(updateRoleSchema.safeParse({ permissions: [PERMISSION] }).success).toBe(true);
    const granted = await request(app).get("/permissions/effective").set(bearer(deleterToken));
    expect(granted.body[PERMISSION]).toBe("edit");
    const none = await request(app).get("/permissions/effective").set(bearer(plainToken));
    expect(none.body[PERMISSION]).toBe("none");
  });

  it("refuses a user without the permission, a wrong PIN and a missing PIN, and deletes nothing", async () => {
    expect((await upload(deleterToken, DELETE_MONTH)).status).toBe(200);
    expect((await upload(deleterToken, OTHER_MONTH)).status).toBe(200);

    expect((await remove(plainToken, DELETE_MONTH, { pin: TEST_PIN })).status).toBe(403);
    const wrong = await remove(deleterToken, DELETE_MONTH, { pin: TEST_PIN === "1234" ? "4321" : "1234" });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(wrong.status).toBeLessThan(500);
    expect(wrong.status).not.toBe(200);
    expect((await remove(deleterToken, DELETE_MONTH, {})).status).toBe(400);
    expect((await remove(deleterToken, DELETE_MONTH, { pin: "12" })).status).toBe(400);

    const row = await activeRow(DELETE_MONTH);
    expect(row).toBeTruthy();
    const stored = await db.select().from(attachments).where(and(eq(attachments.entityType, "quality_engineering_report"), eq(attachments.entityId, row!.id)));
    expect(stored).toHaveLength(4);
  });

  it("clears the month and its pictures, leaves other months and live data alone, and audit-logs it", async () => {
    const row = await activeRow(DELETE_MONTH);
    const other = await activeRow(OTHER_MONTH);
    const files = (await db.select().from(attachments).where(and(eq(attachments.entityType, "quality_engineering_report"), eq(attachments.entityId, row!.id)))).map((item) => item.filePath);
    expect(files).toHaveLength(4);
    expect(files.every((path) => existsSync(path))).toBe(true);
    const ncrBefore = (await db.select({ id: ncr.id }).from(ncr)).length;

    const res = await remove(deleterToken, DELETE_MONTH, { pin: TEST_PIN });
    expect(res.status).toBe(200);
    // The month reads as a fresh, empty report.
    expect(res.body.saved).toBe(false);
    expect(res.body.narrative.ncrTableRows).toEqual([]);
    expect(res.body.narrative.images).toEqual([]);
    expect(res.body.narrative.ncrNotes).toBe("");

    const rows = await allRows(DELETE_MONTH);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isDeleted).toBe(true);
    expect(rows[0]!.deletedBy).toBe(deleterId);
    expect(rows[0]!.deletedAt).toBeTruthy();
    expect(await db.select().from(attachments).where(and(eq(attachments.entityType, "quality_engineering_report"), eq(attachments.entityId, row!.id)))).toHaveLength(0);
    expect(files.some((path) => existsSync(path))).toBe(false);

    const got = await request(app).get("/reports/engineering").query({ year: YEAR, month: DELETE_MONTH }).set(bearer(deleterToken));
    expect(got.status).toBe(200);
    expect(got.body.saved).toBe(false);
    expect(got.body.narrative.images).toEqual([]);

    // The other month is untouched, pictures included.
    const otherAfter = await activeRow(OTHER_MONTH);
    expect(otherAfter!.id).toBe(other!.id);
    const otherView = await request(app).get("/reports/engineering").query({ year: YEAR, month: OTHER_MONTH }).set(bearer(deleterToken));
    expect(otherView.body.saved).toBe(true);
    expect(otherView.body.narrative.images).toHaveLength(4);
    expect(otherView.body.narrative.ncrTableRows).toHaveLength(2);
    expect(await db.select().from(attachments).where(and(eq(attachments.entityType, "quality_engineering_report"), eq(attachments.entityId, other!.id)))).toHaveLength(4);
    expect((await db.select({ id: ncr.id }).from(ncr)).length).toBe(ncrBefore);

    const [entry] = await db
      .select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityType, "QualityEngineeringReport"), eq(auditTrail.entityId, row!.id), eq(auditTrail.action, "delete")))
      .orderBy(desc(auditTrail.id))
      .limit(1);
    expect(entry).toBeTruthy();
    expect(entry!.performedBy).toBe(deleterId);
    const summary = String((entry!.changes as { summary: string }).summary);
    expect(summary).toContain("deleted the January 2027 Monthly Quality Report (narrative, supplier data, 2 NCR rows, 4 pictures)");
    expect(summary).not.toMatch(/\b\d{5,}\b/);
  });

  it("lets the month be filled again after a delete, and says so when there is nothing to delete", async () => {
    const deleted = await allRows(DELETE_MONTH);
    expect((await remove(deleterToken, DELETE_MONTH, { pin: TEST_PIN })).status).toBe(404);

    expect((await upload(deleterToken, DELETE_MONTH)).status).toBe(200);
    const rows = await allRows(DELETE_MONTH);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => !row.isDeleted)).toHaveLength(1);
    expect(rows.find((row) => row.isDeleted)!.id).toBe(deleted[0]!.id);
    const fresh = await request(app).get("/reports/engineering").query({ year: YEAR, month: DELETE_MONTH }).set(bearer(deleterToken));
    expect(fresh.body.saved).toBe(true);
    expect(fresh.body.narrative.images).toHaveLength(4);
    // The deleted row's data did not come back with the new report.
    expect((await activeRow(DELETE_MONTH))!.id).not.toBe(deleted[0]!.id);
  });
});
