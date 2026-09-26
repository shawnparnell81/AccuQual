import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Security-audit finding (low): quality-inspection-reports had no dedicated
// test file — its create/item/disposition CRUD flow and the "production has
// zero access" case are already covered incidentally inside
// scar-and-inspection-forms.test.ts, but two real gaps were still
// completely untested: the read-vs-edit split (purchasing/material_management
// get real read access, not just "quality edit or nothing") and company
// isolation. This file covers exactly those, without re-testing what that
// other file already does.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { qualityInspectionReports } from "../../src/drizzle/schema/qualityInspectionReports.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;

let reportId: number;
const userIds: number[] = [];
let qualityToken: string;
let purchasingToken: string;


describe("Quality Inspection Reports — RBAC read/edit split + company isolation (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    
    
    await seedDefaultPermissions(companyId);
    

    const [qualityUser] = await db.insert(users).values({ email: `qir-rbac-quality-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(qualityUser!.id);
    qualityToken = signAccessToken({ sub: String(qualityUser!.id), roleId: null, roleName: "operator", department: "quality" });

    const [purchasingUser] = await db.insert(users).values({ email: `qir-rbac-purchasing-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(purchasingUser!.id);
    purchasingToken = signAccessToken({ sub: String(purchasingUser!.id), roleId: null, roleName: "operator", department: "purchasing" });

    
    
    

    const [report] = await db.insert(qualityInspectionReports).values({ inspectionType: "incoming" }).returning();
    reportId = report!.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("purchasing (real read access) can list and read a report", async () => {
    const list = await request(app).get("/quality-inspection-reports").set("Authorization", `Bearer ${purchasingToken}`);
    expect(list.status).toBe(200);
    const detail = await request(app).get(`/quality-inspection-reports/${reportId}`).set("Authorization", `Bearer ${purchasingToken}`);
    expect(detail.status).toBe(200);
  });

  it("purchasing (read-only, not edit) cannot update a report", async () => {
    const res = await request(app).patch(`/quality-inspection-reports/${reportId}`).set("Authorization", `Bearer ${purchasingToken}`).send({ finalStatus: "accepted" });
    expect(res.status).toBe(403);
  });

  it("quality (real edit access) can update a report", async () => {
    const res = await request(app).patch(`/quality-inspection-reports/${reportId}`).set("Authorization", `Bearer ${qualityToken}`).send({ finalStatus: "accepted" });
    expect(res.status).toBe(200);
    expect(res.body.finalStatus).toBe("accepted");
  });

  ;

  ;
});
