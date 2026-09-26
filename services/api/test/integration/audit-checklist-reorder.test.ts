import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Drag-to-reorder for an audit's checklist: the new order is saved and comes back on the next read, a question added
// afterwards goes to the end, a partial or duplicate list is refused, and a completed audit's checklist is locked.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { sites } from "../../src/drizzle/schema/sites.js";
import { audits, auditItems } from "../../src/drizzle/schema/audits.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();
let companyId: number;
let siteId: number;
let auditId: number;
let adminId: number;
let token: string;
const ids: Record<string, number> = {};

const auth = () => ({ Authorization: `Bearer ${token}` });
const reorder = (order: number[]) => request(app).post(`/audits/${auditId}/item/reorder`).set(auth()).send({ ids: order });
const questions = async () => (await request(app).get(`/audits/${auditId}/item`).set(auth())).body.map((i: { question: string }) => i.question);

describe("Audit checklist reorder (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const t = await ensureTestCompany();
    companyId = t!.id;
    await seedDefaultPermissions(companyId);
    // New companies get their default plant automatically.
    const [site] = await db.select().from(sites);
    siteId = site!.id;
    const [admin] = await db.insert(users).values({ email: `audit-reorder-${suffix}@test.local`, passwordHash: "unused" }).returning();
    adminId = admin!.id;
    token = await signAccessToken({ sub: String(adminId), roleId: null, roleName: "admin", department: null });
    const [audit] = await db.insert(audits).values({ siteId, name: "Process audit", status: "in_progress" }).returning();
    auditId = audit!.id;
    for (const q of ["Q1 calibration", "Q2 records", "Q3 training"]) {
      const [item] = await db.insert(auditItems).values({ auditId, question: q }).returning();
      ids[q] = item!.id;
    }
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("a checklist nobody has reordered keeps its creation order", async () => {
    expect(await questions()).toEqual(["Q1 calibration", "Q2 records", "Q3 training"]);
  });

  it("saves a new order, and it comes back on the next read", async () => {
    const res = await reorder([ids["Q3 training"]!, ids["Q1 calibration"]!, ids["Q2 records"]!]);
    expect(res.status).toBe(200);
    expect(await questions()).toEqual(["Q3 training", "Q1 calibration", "Q2 records"]);
    const audits_ = await db.select().from(auditTrail);
    expect(audits_.some((a) => (a.changes as { subAction?: string } | null)?.subAction === "items_reordered")).toBe(true);
  });

  it("puts a question added later at the end", async () => {
    const add = await request(app).post(`/audits/${auditId}/item`).set(auth()).send({ question: "Q4 housekeeping" });
    expect(add.status).toBe(201);
    expect(await questions()).toEqual(["Q3 training", "Q1 calibration", "Q2 records", "Q4 housekeeping"]);
  });

  it("refuses a list that doesn't have every question exactly once", async () => {
    expect((await reorder([ids["Q1 calibration"]!, ids["Q2 records"]!])).status).toBe(400);
    expect((await reorder([ids["Q1 calibration"]!, ids["Q1 calibration"]!, ids["Q2 records"]!, ids["Q3 training"]!])).status).toBe(400);
  });

  it("locks the checklist once the audit is completed", async () => {
    await db.update(audits).set({ status: "completed" }).where(eq(audits.id, auditId));
    const all = await db.select({ id: auditItems.id }).from(auditItems).where(eq(auditItems.auditId, auditId));
    const res = await reorder(all.map((r) => r.id));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/completed/i);
  });
});
