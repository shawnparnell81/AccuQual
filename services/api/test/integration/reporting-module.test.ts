import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Security-audit finding (low): reporting.routes.ts has 8 endpoints
// (metrics, export, summary, schedules CRUD, send-now) with zero test
// coverage — no coverage of report-schedule company isolation or the
// admin-only gate on schedule CRUD (see that file's own comment on why
// schedules are admin-only, distinct from the per-report ResourceKey gates
// the metrics endpoints use).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { reportSchedules } from "../../src/drizzle/schema/reporting.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();
let companyId: number;

const userIds: number[] = [];
let adminToken: string;
let operatorToken: string;


describe("Reporting schedules (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    
    

    const [admin] = await db.insert(users).values({ email: `report-admin-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(admin!.id);
    adminToken = signAccessToken({ sub: String(admin!.id), roleId: null, roleName: "admin", department: null });

    const [operator] = await db.insert(users).values({ email: `report-operator-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(operator!.id);
    operatorToken = signAccessToken({ sub: String(operator!.id), roleId: null, roleName: "operator", department: "quality" });

    
    
    
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("a non-admin (operator) cannot create a schedule — admin-only, distinct from the per-report ResourceKey gates", async () => {
    const res = await request(app)
      .post("/reporting/schedules")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ reportType: "ncr_summary", frequency: "weekly", recipients: ["qm@test.local"] });
    expect(res.status).toBe(403);
  });

  it("admin creates a schedule and it's scoped to the creating company", async () => {
    const res = await request(app)
      .post("/reporting/schedules")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reportType: "ncr_summary", frequency: "weekly", recipients: ["qm@test.local"] });
    expect(res.status).toBe(201);
  });

  ;

  it("rejects an invalid reportType instead of crashing", async () => {
    const res = await request(app)
      .post("/reporting/schedules")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reportType: "not_a_real_type", frequency: "weekly", recipients: ["qm@test.local"] });
    expect(res.status).toBe(400);
  });
});
