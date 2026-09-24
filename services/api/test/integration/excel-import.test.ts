// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Bulk import from Excel/CSV: preview + column auto-mapping, whole-file validation, real inserts with audit
// entries, duplicate handling (existing rows and repeats inside the file), inventory's supplier lookup,
// people's one-time credentials, and who is allowed to import what.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { inventoryItems, inventoryAlerts, inventoryStock } from "../../src/drizzle/schema/inventory.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { refreshTokens } from "../../src/drizzle/schema/refreshTokens.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
import { auditRowChanges } from "../../src/drizzle/schema/auditRowChanges.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();
const CSRF = { "X-AccuQual-Csrf": "1" };

let tenantId: number;
let adminToken: string;
let operatorToken: string;
let roleId: number;
const userIds: number[] = [];

async function xlsx(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}`, ...CSRF });

async function upload(path: string, token: string, file: Buffer, fields: Record<string, string> = {}, name = "list.xlsx") {
  let req = request(app).post(path).set(auth(token)).attach("file", file, name);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req;
}

describe("Excel / CSV import (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [t] = await db.insert(tenants).values({ name: `Import Test ${suffix}`, code: `import-test-${suffix}` }).returning();
    tenantId = t!.id;
    await seedDefaultPermissions(tenantId);
    const [role] = await db.insert(roles).values({ name: `import-role-${suffix}` }).returning();
    roleId = role!.id;
    const [admin] = await db.insert(users).values({ tenantId, email: `import-admin-${suffix}@test.local`, passwordHash: "unused" }).returning();
    const [operator] = await db.insert(users).values({ tenantId, email: `import-operator-${suffix}@test.local`, passwordHash: "unused", department: "production" }).returning();
    userIds.push(admin!.id, operator!.id);
    adminToken = await signAccessToken({ sub: String(admin!.id), tenantId, roleId: null, roleName: "admin", department: null });
    operatorToken = await signAccessToken({ sub: String(operator!.id), tenantId, roleId: null, roleName: "operator", department: "production" });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    const items = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId));
    const itemIds = items.map((i) => i.id);
    if (itemIds.length) {
      await db.delete(inventoryAlerts).where(inArray(inventoryAlerts.itemId, itemIds));
      await db.delete(inventoryStock).where(inArray(inventoryStock.itemId, itemIds));
    }
    await db.delete(auditRowChanges).where(eq(auditRowChanges.tenantId, tenantId));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId));
    await db.delete(suppliers).where(eq(suppliers.tenantId, tenantId));
    const tenantUsers = await db.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantId));
    if (tenantUsers.length) await db.delete(refreshTokens).where(inArray(refreshTokens.userId, tenantUsers.map((u) => u.id)));
    await db.delete(users).where(eq(users.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    await db.delete(roles).where(eq(roles.id, roleId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("serves a template and describes the fields", async () => {
    const info = await request(app).get("/import/suppliers").set(auth(adminToken));
    expect(info.status).toBe(200);
    expect(info.body.fields.map((f: { key: string }) => f.key)).toEqual(["name", "contactEmail"]);
    const tpl = await request(app).get("/import/suppliers/template").set(auth(adminToken)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(tpl.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body as Buffer);
    expect(wb.getWorksheet("Import")!.getRow(1).getCell(1).value).toBe("Supplier name");
  });

  it("previews with columns auto-matched by header name, tolerating different wording and order", async () => {
    const file = await xlsx([["E-mail", "Vendor Name", "Region"], ["a@x.com", "Acme", "US"], ["b@x.com", "Bolt Co", "EU"]]);
    const res = await upload("/import/suppliers/preview", adminToken, file);
    expect(res.status).toBe(200);
    expect(res.body.totalRows).toBe(2);
    expect(res.body.mapping).toEqual({ name: 1, contactEmail: 0 });
    expect(res.body.headers).toEqual(["E-mail", "Vendor Name", "Region"]);
  });

  it("validates the whole file without saving anything, and reports each problem by row", async () => {
    const file = await xlsx([["Name", "Email"], ["Good Supplier", "ok@x.com"], ["", "nobody@x.com"], ["Bad Email Co", "not-an-email"], ["Good Supplier", ""]]);
    const res = await upload("/import/suppliers/run", adminToken, file, { mapping: JSON.stringify({ name: 0, contactEmail: 1 }), mode: "validate" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 4, valid: 1, invalid: 3, created: 0 });
    const byRow = Object.fromEntries(res.body.problems.map((p: { row: number; messages: string[] }) => [p.row, p.messages.join(" ")]));
    expect(byRow[3]).toMatch(/required/i);
    expect(byRow[4]).toMatch(/email/i);
    expect(byRow[5]).toMatch(/more than once/i);
    expect(await db.select().from(suppliers).where(eq(suppliers.tenantId, tenantId))).toHaveLength(0);
  });

  it("imports the valid suppliers, records an audit entry per row, and skips ones that already exist", async () => {
    const file = await xlsx([["Name", "Email"], ["Acme Fasteners", "sales@acme.com"], ["Bolt Co", ""]]);
    const first = await upload("/import/suppliers/run", adminToken, file, { mapping: JSON.stringify({ name: 0, contactEmail: 1 }), mode: "import" });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ created: 2, invalid: 0 });
    const rows = await db.select().from(suppliers).where(eq(suppliers.tenantId, tenantId));
    expect(rows.map((r) => r.name).sort()).toEqual(["Acme Fasteners", "Bolt Co"]);
    const audits = await db.select().from(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    expect(audits.filter((a) => a.entityType === "Supplier" && a.action === "create")).toHaveLength(2);

    const again = await upload("/import/suppliers/run", adminToken, await xlsx([["Name"], ["acme fasteners"], ["New One"]]), { mapping: JSON.stringify({ name: 0, contactEmail: null }), mode: "import" });
    expect(again.body).toMatchObject({ created: 1, invalid: 1 });
    expect(again.body.problems[0].messages.join(" ")).toMatch(/already exists/i);
  });

  it("reads CSV files too", async () => {
    const csv = Buffer.from("Supplier,Contact Email\nCsv Supplier,csv@x.com\n");
    const res = await upload("/import/suppliers/run", adminToken, csv, { mapping: JSON.stringify({ name: 0, contactEmail: 1 }), mode: "import" }, "list.csv");
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
  });

  it("imports inventory items: type wording, number cleanup, supplier lookup by name, and state settling", async () => {
    const file = await xlsx([
      ["Part Number", "Desc", "Type", "UoM", "Vendor", "Min", "Unit Cost"],
      ["FST-1", "Bolt", "Raw material", "EA", "Acme Fasteners", "100", "$0.12"],
      ["FST-2", "Kit", "finished goods", "EA", "", "", ""],
      ["FST-3", "Ghost supplier", "wip", "EA", "Nobody Inc", "", ""],
      ["FST-4", "Bad type", "gadget", "EA", "", "", ""],
      ["FST-5", "Bad number", "", "EA", "", "lots", ""],
    ]);
    const preview = await upload("/import/inventory_items/preview", adminToken, file);
    expect(preview.body.mapping).toMatchObject({ sku: 0, description: 1, itemType: 2, unitOfMeasure: 3, supplier: 4, minLevel: 5, unitCost: 6 });

    const res = await upload("/import/inventory_items/run", adminToken, file, { mapping: JSON.stringify(preview.body.mapping), mode: "import" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 5, created: 2, invalid: 3 });
    const items = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId));
    const bySku = Object.fromEntries(items.map((i) => [i.sku, i]));
    expect(bySku["FST-1"]).toMatchObject({ itemType: "raw_material", unitCost: "0.12", minLevel: "100" });
    expect(bySku["FST-1"]!.defaultSupplierId).not.toBeNull();
    expect(bySku["FST-2"]).toMatchObject({ itemType: "finished_good" });
    const messages = res.body.problems.map((p: { messages: string[] }) => p.messages.join(" ")).join(" | ");
    expect(messages).toMatch(/Nobody Inc/);
    expect(messages).toMatch(/gadget/);
    expect(messages).toMatch(/lots/);
  });

  it("requires every required field to be mapped, and rejects a file with no usable data", async () => {
    const file = await xlsx([["Name"], ["X"]]);
    const missing = await upload("/import/suppliers/run", adminToken, file, { mapping: JSON.stringify({ name: null, contactEmail: null }), mode: "validate" });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toMatch(/Supplier name/);
    const empty = await upload("/import/suppliers/preview", adminToken, await xlsx([["Name"]]));
    expect(empty.status).toBe(400);
    const junk = await upload("/import/suppliers/preview", adminToken, Buffer.from("this is not a spreadsheet"));
    expect(junk.status).toBe(400);
  });

  it("creates people with one-time temporary passwords that really work, matches roles, and refuses admins", async () => {
    const file = await xlsx([
      ["Email", "Name", "Role", "Department"],
      [`jamie-${suffix}@test.local`, "Jamie Rivera", `import-role-${suffix}`, "Production"],
      [`sam-${suffix}@test.local`, "Sam Lee", "admin", ""],
      [`kim-${suffix}@test.local`, "Kim Park", "no-such-role", "Underwater Basket Weaving"],
    ]);
    const res = await upload("/import/people/run", adminToken, file, { mapping: JSON.stringify({ email: 0, name: 1, role: 2, department: 3 }), mode: "import" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 1, invalid: 2 });
    expect(res.body.credentials).toHaveLength(1);
    const { email, temporaryPassword } = res.body.credentials[0];
    expect(email).toBe(`jamie-${suffix}@test.local`);
    const [created] = await db.select().from(users).where(eq(users.email, email));
    expect(created).toMatchObject({ tenantId, roleId, department: "production", name: "Jamie Rivera" });
    userIds.push(created!.id);
    // The password is never in the row summary, only in `credentials`, and it signs in for real.
    expect(JSON.stringify(res.body.createdRows)).not.toContain(temporaryPassword);
    const login = await request(app).post("/auth/login").send({ email, password: temporaryPassword });
    expect(login.status).toBe(200);
  });

  it("only lets people who can edit a module import into it, and only admins import people", async () => {
    const file = await xlsx([["Name"], ["Sneaky Supplier"]]);
    const mapping = JSON.stringify({ name: 0, contactEmail: null });
    expect((await upload("/import/suppliers/run", operatorToken, file, { mapping, mode: "import" })).status).toBe(403);
    expect((await upload("/import/people/run", operatorToken, await xlsx([["Email"], ["x@y.com"]]), { mapping: JSON.stringify({ email: 0, name: null, role: null, department: null }), mode: "import" })).status).toBe(403);
    expect((await request(app).get("/import/bogus").set(auth(adminToken))).status).toBe(404);
    expect((await request(app).get("/import/suppliers")).status).toBe(401);
    expect(await db.select().from(suppliers).where(eq(suppliers.name, "Sneaky Supplier"))).toHaveLength(0);
  });
});
