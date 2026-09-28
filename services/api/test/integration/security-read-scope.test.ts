import { ensureTestCompany } from "../helpers/company.js";
// Supplier logins cannot read company settings, roles, or staff records.
// Other signed-in people can open a person, but only an owner or admin
// sees more than the name and email.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let supplierToken: string;
let qualityToken: string;
let operatorToken: string;
let adminToken: string;
let staffId: number;

async function makeUser(roleName: string, department: string | null, name?: string) {
  const [user] = await db
    .insert(users)
    .values({
      email: `read-scope-${roleName}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`,
      passwordHash: "unused",
      department,
      name: name ?? roleName,
    })
    .returning();
  return { id: user!.id, token: signAccessToken({ sub: String(user!.id), roleId: null, roleName, department }) };
}

describe("supplier and staff read scope", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    supplierToken = (await makeUser("supplier", null)).token;
    qualityToken = (await makeUser("operator", "quality")).token;
    operatorToken = (await makeUser("operator", "production")).token;
    adminToken = (await makeUser("admin", null)).token;
    staffId = (await makeUser("operator", "quality", "Pat Quality")).id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("refuses supplier logins on settings, company, roles, and staff reads", async () => {
    expect((await request(app).get("/settings/feasibility").set("Authorization", `Bearer ${supplierToken}`)).status).toBe(403);
    expect((await request(app).get("/company/branding").set("Authorization", `Bearer ${supplierToken}`)).status).toBe(403);
    expect((await request(app).get("/roles").set("Authorization", `Bearer ${supplierToken}`)).status).toBe(403);
    expect((await request(app).get(`/users/${staffId}`).set("Authorization", `Bearer ${supplierToken}`)).status).toBe(403);
  });

  it("still lets an internal department read settings", async () => {
    const res = await request(app).get("/settings/feasibility").set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
  });

  it("returns only the name and email to someone who is not an admin", async () => {
    const res = await request(app).get(`/users/${staffId}`).set("Authorization", `Bearer ${operatorToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: staffId, name: "Pat Quality", email: expect.stringContaining("@test.local") });
    expect(res.body.department).toBeUndefined();
  });

  it("returns the full staff record to an admin", async () => {
    const res = await request(app).get(`/users/${staffId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.department).toBe("quality");
    expect(res.body.name).toBe("Pat Quality");
  });
});
