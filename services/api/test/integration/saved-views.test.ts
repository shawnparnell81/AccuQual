// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Saved list-view search filters: GET/PATCH /users/me/saved-views — self-only, merge-patch per page key (mirrors
// /users/me/theme's merge-patch shape exactly, just keyed by page id instead of a fixed theme field).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let userAId: number;
let userBId: number;
let tokenA: string;
let tokenB: string;

async function makeUser(label: string) {
  const [user] = await db.insert(users).values({ tenantId, email: `saved-views-${label}-${suffix}@test.local`, passwordHash: "unused" }).returning();
  const token = await signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName: "operator", department: null });
  return { id: user!.id, token };
}

describe("Saved list-view filters (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Saved Views Test ${suffix}`, code: `saved-views-test-${suffix}` }).returning();
    tenantId = tenant!.id;
    const a = await makeUser("a");
    const b = await makeUser("b");
    userAId = a.id;
    userBId = b.id;
    tokenA = a.token;
    tokenB = b.token;
  });

  afterAll(async () => {
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(users).where(eq(users.id, userAId));
    await db.delete(users).where(eq(users.id, userBId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("starts empty for a user who has never saved a view", async () => {
    const res = await request(app).get("/users/me/saved-views").set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it("saves a view under one page key and reads it back", async () => {
    const patch = await request(app)
      .patch("/users/me/saved-views")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ "suppliers": [{ label: "High risk", searchText: "high" }] });
    expect(patch.status).toBe(200);
    expect(patch.body.suppliers).toEqual([{ label: "High risk", searchText: "high" }]);

    const read = await request(app).get("/users/me/saved-views").set("Authorization", `Bearer ${tokenA}`);
    expect(read.body.suppliers).toEqual([{ label: "High risk", searchText: "high" }]);
  });

  it("patching one page key never touches another page's saved views", async () => {
    await request(app)
      .patch("/users/me/saved-views")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ "ncr-list": [{ label: "Open, mine", searchText: "open" }] });

    const read = await request(app).get("/users/me/saved-views").set("Authorization", `Bearer ${tokenA}`);
    expect(read.body.suppliers).toEqual([{ label: "High risk", searchText: "high" }]);
    expect(read.body["ncr-list"]).toEqual([{ label: "Open, mine", searchText: "open" }]);
  });

  it("sending an empty array clears just that page's saved views", async () => {
    const patch = await request(app).patch("/users/me/saved-views").set("Authorization", `Bearer ${tokenA}`).send({ suppliers: [] });
    expect(patch.body.suppliers).toEqual([]);
    expect(patch.body["ncr-list"]).toEqual([{ label: "Open, mine", searchText: "open" }]);
  });

  it("is scoped to the caller's own row — a different user in the same tenant sees none of it", async () => {
    const res = await request(app).get("/users/me/saved-views").set("Authorization", `Bearer ${tokenB}`);
    expect(res.body).toEqual({});
  });

  it("rejects a saved view with no label", async () => {
    const res = await request(app).patch("/users/me/saved-views").set("Authorization", `Bearer ${tokenA}`).send({ suppliers: [{ label: "", searchText: "x" }] });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/users/me/saved-views")).status).toBe(401);
  });
});
