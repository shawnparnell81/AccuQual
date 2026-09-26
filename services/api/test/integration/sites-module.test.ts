import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test. One organization, two plants: an issue logged
// at plant A does not show up on plant B's default list.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { sites } from "../../src/drizzle/schema/sites.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { formData } from "../../src/drizzle/schema/forms.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;
let adminId: number;
let qualityId: number;
let eastOnlyId: number;
let adminToken: string;
let qualityToken: string;
let eastOnlyToken: string;

describe("plants (one company, many sites)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    await seedDefaultPermissions(companyId);

    const [admin] = await db.insert(users).values({ email: `plants-admin-${suffix}@test.local`, passwordHash: "unused", name: "Plant Admin" }).returning();
    const [quality] = await db.insert(users).values({ email: `plants-quality-${suffix}@test.local`, passwordHash: "unused", name: "Quality", department: "quality" }).returning();
    const [eastOnly] = await db.insert(users).values({ email: `plants-east-${suffix}@test.local`, passwordHash: "unused", name: "East Only", department: "quality" }).returning();
    adminId = admin!.id;
    qualityId = quality!.id;
    eastOnlyId = eastOnly!.id;
    adminToken = signAccessToken({ sub: String(adminId), roleId: null, roleName: "admin", department: null });
    qualityToken = signAccessToken({ sub: String(qualityId), roleId: null, roleName: "operator", department: "quality" });
    eastOnlyToken = signAccessToken({ sub: String(eastOnlyId), roleId: null, roleName: "operator", department: "quality" });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("gives an existing-style company a main plant and assigns the new user to it", async () => {
    const res = await request(app).get("/sites").set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.canManage).toBe(false);
    expect(res.body.sites).toEqual([expect.objectContaining({ name: "Main plant", code: "main", isDefault: true })]);
    expect(res.body.currentSiteId).toBe(res.body.sites[0].id);
  });

  it("lets an admin add a plant, assign someone to it, and keeps issues off the other plant's list", async () => {
    const created = await request(app).post("/sites").set("Authorization", `Bearer ${adminToken}`).send({ name: "East plant" });
    expect(created.status).toBe(201);
    const eastId = created.body.id as number;

    const main = await db.select().from(sites);
    const mainId = main.find((site) => site.isDefault)!.id;

    const addEast = await request(app).put(`/sites/${eastId}/members`).set("Authorization", `Bearer ${adminToken}`).send({ userIds: [qualityId, eastOnlyId] });
    expect(addEast.status).toBe(200);
    const dropMain = await request(app).put(`/sites/${mainId}/members`).set("Authorization", `Bearer ${adminToken}`).send({ userIds: [adminId, qualityId] });
    expect(dropMain.status).toBe(200);

    const onMain = await request(app).post("/ncr").set("Authorization", `Bearer ${qualityToken}`).send({ title: "Issue at main", severity: "low" });
    expect(onMain.status).toBe(201);
    expect(onMain.body.siteId).toBe(mainId);

    const switched = await request(app).post("/sites/current").set("Authorization", `Bearer ${qualityToken}`).send({ siteId: eastId });
    expect(switched.status).toBe(200);
    expect(switched.body.currentSiteId).toBe(eastId);

    const eastList = await request(app).get("/ncr").set("Authorization", `Bearer ${qualityToken}`);
    expect(eastList.status).toBe(200);
    expect(eastList.body.map((row: { title: string }) => row.title)).not.toContain("Issue at main");

    const onEast = await request(app).post("/ncr").set("Authorization", `Bearer ${qualityToken}`).send({ title: "Issue at east", severity: "high" });
    expect(onEast.status).toBe(201);
    expect(onEast.body.siteId).toBe(eastId);

    const eastListAfter = await request(app).get("/ncr").set("Authorization", `Bearer ${qualityToken}`);
    expect(eastListAfter.body.map((row: { title: string }) => row.title)).toEqual(["Issue at east"]);

    const back = await request(app).post("/sites/current").set("Authorization", `Bearer ${qualityToken}`).send({ siteId: mainId });
    expect(back.status).toBe(200);
    const mainList = await request(app).get("/ncr").set("Authorization", `Bearer ${qualityToken}`);
    expect(mainList.body.map((row: { title: string }) => row.title)).toEqual(["Issue at main"]);

    const eastOnlyList = await request(app).get("/ncr").set("Authorization", `Bearer ${eastOnlyToken}`);
    expect(eastOnlyList.body.map((row: { title: string }) => row.title)).toEqual(["Issue at east"]);

    const blocked = await request(app).get(`/ncr/${onMain.body.id}`).set("Authorization", `Bearer ${eastOnlyToken}`);
    expect(blocked.status).toBe(404);
    const openedByAdmin = await request(app).get(`/ncr/${onEast.body.id}`).set("Authorization", `Bearer ${adminToken}`).set("X-AccuQual-Site", String(mainId));
    expect(openedByAdmin.status).toBe(200);
    const adminMainList = await request(app).get("/ncr").set("Authorization", `Bearer ${adminToken}`).set("X-AccuQual-Site", String(mainId));
    expect(adminMainList.body.map((row: { id: number }) => row.id)).not.toContain(onEast.body.id);

    const refused = await request(app).post("/sites/current").set("Authorization", `Bearer ${eastOnlyToken}`).send({ siteId: mainId });
    expect(refused.status).toBe(403);
  });

  it("still lists controlled documents without a plant filter", async () => {
    const docs = await request(app).get("/documents").set("Authorization", `Bearer ${adminToken}`);
    expect(docs.status).toBe(200);
    expect(Array.isArray(docs.body)).toBe(true);
  });
});
