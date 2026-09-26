import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// What's new: GET/PATCH /users/me/changelog-seen — self-only, no RBAC beyond auth (same class of endpoint as /users/me/theme).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;
let userAId: number;
let userBId: number;
let tokenA: string;
let tokenB: string;

async function makeUser(label: string) {
  const [user] = await db.insert(users).values({ email: `changelog-${label}-${suffix}@test.local`, passwordHash: "unused" }).returning();
  const token = await signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department: null });
  return { id: user!.id, token };
}

describe("What's new changelog-seen (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    const a = await makeUser("a");
    const b = await makeUser("b");
    userAId = a.id;
    userBId = b.id;
    tokenA = a.token;
    tokenB = b.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("a user who has never opened the panel reads back null", async () => {
    const res = await request(app).get("/users/me/changelog-seen").set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.lastSeenVersion).toBeNull();
  });

  it("marking a version seen persists and reads back for that same user", async () => {
    const mark = await request(app).patch("/users/me/changelog-seen").set("Authorization", `Bearer ${tokenA}`).send({ version: "2026-09-22" });
    expect(mark.status).toBe(200);
    expect(mark.body.lastSeenVersion).toBe("2026-09-22");

    const read = await request(app).get("/users/me/changelog-seen").set("Authorization", `Bearer ${tokenA}`);
    expect(read.body.lastSeenVersion).toBe("2026-09-22");
  });

  it("is scoped to the caller's own row — a different user in the same company is unaffected", async () => {
    const res = await request(app).get("/users/me/changelog-seen").set("Authorization", `Bearer ${tokenB}`);
    expect(res.body.lastSeenVersion).toBeNull();
  });

  it("rejects an empty version string", async () => {
    const res = await request(app).patch("/users/me/changelog-seen").set("Authorization", `Bearer ${tokenA}`).send({ version: "" });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/users/me/changelog-seen")).status).toBe(401);
  });
});
