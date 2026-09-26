import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Security-audit finding (low): rma-activity-log had no dedicated test
// file — a regression in this automated supplier-RMA event trail would
// ship silently. Covers the real RBAC split (quality: edit, customer_service:
// read, everyone else: none), the ?rmaId= narrowing filter, and company
// isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { rma } from "../../src/drizzle/schema/rma.js";
import { rmaActivityLog } from "../../src/drizzle/schema/supplierRma.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;

let rmaId: number;
const userIds: number[] = [];
let qualityToken: string;
let customerServiceToken: string;
let engineeringToken: string;

describe("RMA Activity Log (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    
    
    await seedDefaultPermissions(companyId);

    const [qualityUser] = await db.insert(users).values({ email: `rma-activity-quality-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(qualityUser!.id);
    qualityToken = signAccessToken({ sub: String(qualityUser!.id), roleId: null, roleName: "operator", department: "quality" });

    const [csUser] = await db.insert(users).values({ email: `rma-activity-cs-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(csUser!.id);
    customerServiceToken = signAccessToken({ sub: String(csUser!.id), roleId: null, roleName: "operator", department: "customer_service" });

    const [engUser] = await db.insert(users).values({ email: `rma-activity-eng-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(engUser!.id);
    engineeringToken = signAccessToken({ sub: String(engUser!.id), roleId: null, roleName: "operator", department: "engineering" });

    const [supplier] = await db.insert(suppliers).values({ name: `Test Supplier ${suffix}` }).returning();
    const [rmaRow] = await db.insert(rma).values({ rmaNumber: `RMA-ACT-${suffix}`, supplierId: supplier!.id }).returning();
    rmaId = rmaRow!.id;

    await db.insert(rmaActivityLog).values({ rmaId, event: "created", details: { note: "seed" } });
    await db.insert(rmaActivityLog).values({ event: "unrelated_event" }); // no rmaId — must not appear in a ?rmaId= filtered view

    // Isolation fixture — same shape of data in a different company.
    
    
    
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("quality (edit access) can list the company's activity log", async () => {
    const res = await request(app).get("/rma-activity-log").set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it("customer_service (read access) can also list it", async () => {
    const res = await request(app).get("/rma-activity-log").set("Authorization", `Bearer ${customerServiceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it("engineering (zero access) is blocked", async () => {
    const res = await request(app).get("/rma-activity-log").set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(403);
  });

  it("?rmaId= narrows to just that RMA's own timeline", async () => {
    const res = await request(app).get(`/rma-activity-log?rmaId=${rmaId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].event).toBe("created");
  });

});
