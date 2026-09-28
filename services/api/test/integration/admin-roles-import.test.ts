import { ensureTestCompany } from "../helpers/company.js";
// Role order, delete protections, and the admin spreadsheet import (check, create, update).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { customers } from "../../src/drizzle/schema/customers.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let adminId: number;
let adminToken: string;
let operatorToken: string;

describe("admin roles, user removal, and data import", () => {
  beforeAll(async () => {
    await ensureTestCompany();
    const [admin] = await db.insert(users).values({ email: `roles-admin-${suffix}@test.local`, passwordHash: "unused", name: "Admin Person" }).returning();
    const [operator] = await db.insert(users).values({ email: `roles-operator-${suffix}@test.local`, passwordHash: "unused" }).returning();
    adminId = admin!.id;
    adminToken = signAccessToken({ sub: String(admin!.id), roleId: null, roleName: "admin", department: null });
    operatorToken = signAccessToken({ sub: String(operator!.id), roleId: null, roleName: "operator", department: "production" });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("lists built-in roles from the top of the organization down", async () => {
    const res = await request(app).get("/roles").set(auth(adminToken));
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((role) => role.name);
    const at = (name: string) => names.indexOf(name);
    expect(at("owner")).toBeGreaterThanOrEqual(0);
    expect(at("owner")).toBeLessThan(at("admin"));
    expect(at("admin")).toBeLessThan(at("president"));
    expect(at("president")).toBeLessThan(at("vice_president"));
    expect(at("vice_president")).toBeLessThan(at("director"));
    expect(at("director")).toBeLessThan(at("quality_manager"));
    expect(at("quality_manager")).toBeLessThan(at("lead"));
    expect(at("staff")).toBeGreaterThan(at("operator"));
    expect(at("read_only")).toBeGreaterThan(at("staff"));
    expect(at("read_only")).toBeLessThan(at("auditor"));
    const vice = (res.body as { name: string; displayName?: string; hierarchyLevel?: number }[]).find((role) => role.name === "vice_president");
    expect(vice?.displayName).toBe("Vice President");
    const staff = (res.body as { name: string; hierarchyLevel?: number }[]).find((role) => role.name === "staff");
    expect(staff?.hierarchyLevel).toBe(80);
    expect(at("quality_manager")).toBeLessThan(at("operator"));
    expect(at("operator")).toBeLessThan(at("auditor"));
    expect(at("auditor")).toBeLessThan(at("supplier"));
    expect(at("supplier")).toBeLessThan(at("customer"));
  });

  it("will not delete a built-in role, and reassigns people before deleting a custom one", async () => {
    const listed = await request(app).get("/roles").set(auth(adminToken));
    const owner = (listed.body as { id: number; name: string }[]).find((role) => role.name === "owner");
    expect((await request(app).delete(`/roles/${owner!.id}`).set(auth(adminToken))).status).toBe(409);

    const created = await request(app).post("/roles").set(auth(adminToken)).send({ name: `Floor Helper ${suffix}`, description: "Day shift" });
    expect(created.status).toBe(201);
    const [holder] = await db.insert(users).values({ email: `helper-${suffix}@test.local`, passwordHash: "unused", roleId: created.body.id }).returning();
    const blocked = await request(app).delete(`/roles/${created.body.id}`).set(auth(adminToken));
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/1 person still has/);

    const operator = (listed.body as { id: number; name: string }[]).find((role) => role.name === "operator");
    const removed = await request(app).delete(`/roles/${created.body.id}`).set(auth(adminToken)).send({ replacementRoleId: operator!.id });
    expect(removed.status).toBe(204);
    const [moved] = await db.select().from(users).where(eq(users.id, holder!.id));
    expect(moved!.roleId).toBe(operator!.id);
  });

  it("will not delete yourself or the last owner, erases a person with no records, and turns off a person with history", async () => {
    expect((await request(app).delete(`/users/${adminId}`).set(auth(adminToken))).status).toBe(409);

    const [ownerRole] = await db.select().from(roles).where(eq(roles.name, "owner"));
    const [onlyOwner] = await db.insert(users).values({ email: `only-owner-${suffix}@test.local`, passwordHash: "unused", roleId: ownerRole!.id, name: "Only Owner" }).returning();
    const blocked = await request(app).delete(`/users/${onlyOwner!.id}`).set(auth(adminToken));
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/last Owner or Administrator/);

    const [fresh] = await db.insert(users).values({ email: `fresh-${suffix}@test.local`, passwordHash: "unused", name: "Fresh" }).returning();
    const erased = await request(app).delete(`/users/${fresh!.id}`).set(auth(adminToken));
    expect(erased.status).toBe(200);
    expect(erased.body.outcome).toBe("deleted");

    const [historian] = await db.insert(users).values({ email: `historian-${suffix}@test.local`, passwordHash: "unused", name: "Historian" }).returning();
    await db.insert(auditTrail).values({ entityType: "NCR", entityId: 1, action: "create", performedBy: historian!.id });
    const kept = await request(app).delete(`/users/${historian!.id}`).set(auth(adminToken));
    expect(kept.status).toBe(200);
    expect(kept.body.outcome).toBe("deactivated");
    const [still] = await db.select().from(users).where(eq(users.id, historian!.id));
    expect(still).toMatchObject({ isActive: false, name: "Historian" });
  });

  it("checks a supplier file, creates rows, then updates them, and refuses an operator", async () => {
    expect((await request(app).get("/admin/imports/types").set(auth(operatorToken))).status).toBe(403);

    const csv = Buffer.from("Vendor Name,E-mail\nImport Co,first@x.com\n,bad-email\n");
    const uploaded = await request(app).post("/admin/imports").set(auth(adminToken)).field("entityKey", "suppliers").attach("file", csv, "suppliers.csv");
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.totalRows).toBe(2);
    expect(uploaded.body.mapping).toMatchObject({ name: 0, contactEmail: 1 });

    const checked = await request(app).post(`/admin/imports/${uploaded.body.id}/check`).set(auth(adminToken)).send({
      mapping: uploaded.body.mapping,
      badRowMode: "skip",
      duplicateMode: "create_only",
      sendInvites: false,
    });
    expect(checked.status).toBe(200);
    expect(checked.body.failedCount).toBe(1);
    expect(checked.body.createdCount).toBe(1);
    expect(await db.select().from(suppliers)).toHaveLength(0);

    const ran = await request(app).post(`/admin/imports/${uploaded.body.id}/run`).set(auth(adminToken)).send({
      mapping: uploaded.body.mapping,
      badRowMode: "skip",
      duplicateMode: "create_only",
      sendInvites: false,
    });
    expect(ran.status).toBe(200);
    expect(ran.body).toMatchObject({ status: "completed", createdCount: 1, failedCount: 1 });
    const [created] = await db.select().from(suppliers).where(eq(suppliers.name, "Import Co"));
    expect(created!.contactEmail).toBe("first@x.com");

    const againFile = Buffer.from("Vendor Name,E-mail\nImport Co,second@x.com\n");
    const again = await request(app).post("/admin/imports").set(auth(adminToken)).field("entityKey", "suppliers").attach("file", againFile, "suppliers-2.csv");
    const updated = await request(app).post(`/admin/imports/${again.body.id}/run`).set(auth(adminToken)).send({
      mapping: { name: 0, contactEmail: 1 },
      badRowMode: "fail",
      duplicateMode: "update",
      sendInvites: false,
    });
    expect(updated.body).toMatchObject({ status: "completed", updatedCount: 1, createdCount: 0 });
    const [row] = await db.select().from(suppliers).where(eq(suppliers.name, "Import Co"));
    expect(row!.contactEmail).toBe("second@x.com");

    const contacts = Buffer.from("Customer name,Quality contact email\nNorthwind,quality@northwind.example\n");
    const contactUpload = await request(app).post("/admin/imports").set(auth(adminToken)).field("entityKey", "customers").attach("file", contacts, "customers.csv");
    const contactRun = await request(app).post(`/admin/imports/${contactUpload.body.id}/run`).set(auth(adminToken)).send({
      mapping: contactUpload.body.mapping,
      badRowMode: "skip",
      duplicateMode: "skip",
      sendInvites: false,
    });
    expect(contactRun.body.createdCount).toBe(1);
    const [customer] = await db.select().from(customers);
    expect(customer).toMatchObject({ legalName: "Northwind", primaryContactEmail: "quality@northwind.example", status: "approved" });
  });
});
