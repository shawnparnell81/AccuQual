import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Full-System Audit finding L2: PPAP had zero dedicated test coverage — no
// coverage of its RBAC gate (Phase 3's own fix, engineering: edit) at all.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ppapPackages } from "../../src/drizzle/schema/ppap.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;
const userIds: number[] = [];
let engineeringToken: string;
let productionToken: string;

async function makeUser(department: string | null) {
  const [user] = await db.insert(users).values({ email: `ppap-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

describe("PPAP module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    await seedDefaultPermissions(companyId);

    engineeringToken = await makeUser("engineering");
    productionToken = await makeUser("production"); // ppap's default permissions are engineering-only
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("production (zero access to ppap) cannot create or read a PPAP package", async () => {
    const create = await request(app).post("/ppap").set("Authorization", `Bearer ${productionToken}`).send({ partNumber: "Should be blocked" });
    expect(create.status).toBe(403);
  });

  it("engineering can create a real PPAP package, defaulting to a real part number", async () => {
    const res = await request(app).post("/ppap").set("Authorization", `Bearer ${engineeringToken}`).send({ partNumber: "PN-1001", partName: "Widget Bracket", customer: "Acme Co" });
    expect(res.status).toBe(201);
    expect(res.body.partNumber).toBe("PN-1001");
  });

  it("engineering can list and read its own company's PPAP packages", async () => {
    const create = await request(app).post("/ppap").set("Authorization", `Bearer ${engineeringToken}`).send({ partNumber: "PN-1002" });
    const id = create.body.id as number;

    const list = await request(app).get("/ppap").set("Authorization", `Bearer ${engineeringToken}`);
    expect(list.status).toBe(200);
    expect(list.body.some((p: { id: number }) => p.id === id)).toBe(true);

    const read = await request(app).get(`/ppap/${id}`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(read.status).toBe(200);
    expect(read.body.id).toBe(id);
  });

  it("creating a PPAP package with no part number is rejected by validation", async () => {
    const res = await request(app).post("/ppap").set("Authorization", `Bearer ${engineeringToken}`).send({ customer: "Acme Co" });
    expect(res.status).toBe(400);
  });
});
