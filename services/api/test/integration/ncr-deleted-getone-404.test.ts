import { ensureTestCompany } from "../helpers/company.js";
// Bug A: a soft-deleted NCR must read as 404 (the list already hides it),
// not 200 with the deleted row — otherwise the detail page hangs on
// "Loading this issue…" forever instead of showing not-found.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let qualityToken: string;

describe("deleted NCR reads as 404", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [user] = await db
      .insert(users)
      .values({ email: `ncr-gone-${suffix}@test.local`, passwordHash: "unused" })
      .returning();
    qualityToken = signAccessToken({
      sub: String(user!.id),
      roleId: null,
      roleName: "operator",
      department: "quality",
    });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("returns 200 before delete and 404 after soft-delete", async () => {
    const created = await request(app)
      .post("/ncr")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ title: "Bug A repro", severity: "high" });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const before = await request(app).get(`/ncr/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(before.status).toBe(200);

    const deleted = await request(app).delete(`/ncr/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(deleted.status).toBe(204);

    const after = await request(app).get(`/ncr/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(after.status).toBe(404);
  });

  it("still 404s for an id that never existed", async () => {
    const res = await request(app)
      .get("/ncr/999999999")
      .set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(404);
  });
});
