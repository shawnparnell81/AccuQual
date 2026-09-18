// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Full-System Audit finding M8: nav had zero test coverage — no coverage of
// getKpiCounts' real "open" filtering per module, and no coverage of the
// hide/show nav-preferences round-trip (including L8's new Zod validation).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { complaints } from "../../src/drizzle/schema/complaints.js";
import { navHiddenItems } from "../../src/drizzle/schema/navPreferences.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let otherTenantId: number;
const userIds: number[] = [];
let token: string;

describe("Nav (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Nav Test Tenant ${suffix}`, code: `nav-test-${suffix}` }).returning();
    tenantId = tenant!.id;
    const [other] = await db.insert(tenants).values({ name: `Nav Other Tenant ${suffix}`, code: `nav-other-${suffix}` }).returning();
    otherTenantId = other!.id;

    const [user] = await db.insert(users).values({ tenantId, email: `nav-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(user!.id);
    token = signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName: "admin", department: null });
  });

  afterAll(async () => {
    await db.delete(navHiddenItems).where(eq(navHiddenItems.tenantId, tenantId));
    await db.delete(ncr).where(eq(ncr.tenantId, tenantId));
    await db.delete(ncr).where(eq(ncr.tenantId, otherTenantId));
    await db.delete(complaints).where(eq(complaints.tenantId, tenantId));
    await db.delete(users).where(eq(users.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await pool.end();
  });

  describe("GET /nav/kpi-counts", () => {
    it("counts only this tenant's own open (non-closed) records, per module", async () => {
      await db.insert(ncr).values([
        { tenantId, title: "Open NCR 1" },
        { tenantId, title: "Open NCR 2" },
        { tenantId, title: "Closed NCR", status: "closed" },
      ]);
      await db.insert(complaints).values([
        { tenantId, description: "Open complaint" },
        { tenantId, description: "Closed complaint", status: "closed" },
      ]);
      // A different tenant's own open records must never bleed into this count.
      await db.insert(ncr).values({ tenantId: otherTenantId, title: "Other tenant's open NCR" });

      const res = await request(app).get("/nav/kpi-counts").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.ncr).toBe(2);
      expect(res.body.complaints).toBe(1);
    });
  });

  describe("nav hidden-item preferences", () => {
    it("starts with nothing hidden", async () => {
      const res = await request(app).get("/nav/hidden").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("POST /nav/hidden with no scope is rejected by the new Zod schema (L8) — a clean 400, not a manual check", async () => {
      const res = await request(app).post("/nav/hidden").set("Authorization", `Bearer ${token}`).send({});
      expect(res.status).toBe(400);
    });

    it("hides an item, lists it, then shows it again", async () => {
      const hide = await request(app).post("/nav/hidden").set("Authorization", `Bearer ${token}`).send({ scope: "item:quality:audits" });
      expect(hide.status).toBe(201);

      const list = await request(app).get("/nav/hidden").set("Authorization", `Bearer ${token}`);
      expect(list.body).toEqual(["item:quality:audits"]);

      const show = await request(app).delete("/nav/hidden").set("Authorization", `Bearer ${token}`).send({ scope: "item:quality:audits" });
      expect(show.status).toBe(204);

      const listAfter = await request(app).get("/nav/hidden").set("Authorization", `Bearer ${token}`);
      expect(listAfter.body).toEqual([]);
    });

    it("hiding the same scope twice doesn't error (onConflictDoNothing)", async () => {
      const first = await request(app).post("/nav/hidden").set("Authorization", `Bearer ${token}`).send({ scope: "department:sales" });
      const second = await request(app).post("/nav/hidden").set("Authorization", `Bearer ${token}`).send({ scope: "department:sales" });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);

      const list = await request(app).get("/nav/hidden").set("Authorization", `Bearer ${token}`);
      expect(list.body).toEqual(["department:sales"]);
    });
  });
});
