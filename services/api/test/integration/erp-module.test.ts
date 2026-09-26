import { ensureTestCompany } from "../helpers/company.js";
// Purchase orders and requisitions are no longer served. Receiving documents stay.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();
const userIds: number[] = [];
let token: string;

describe("Purchase orders are no longer part of the app", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [user] = await db.insert(users).values({ email: `erp-gone-${suffix}@test.local`, passwordHash: "unused", department: "purchasing" }).returning();
    userIds.push(user!.id);
    token = signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department: "purchasing" });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("does not serve purchase orders, the purchasing overview, or requisitions", async () => {
    expect((await request(app).get("/erp/purchase-orders").set("Authorization", `Bearer ${token}`)).status).toBe(404);
    expect((await request(app).post("/erp/purchase-orders").set("Authorization", `Bearer ${token}`).send({})).status).toBe(404);
    expect((await request(app).get("/erp/overview").set("Authorization", `Bearer ${token}`)).status).toBe(404);
    expect((await request(app).get("/erp/requisitions").set("Authorization", `Bearer ${token}`)).status).toBe(404);
    expect((await request(app).post("/erp/requisitions").set("Authorization", `Bearer ${token}`).send({})).status).toBe(404);
  });
});
