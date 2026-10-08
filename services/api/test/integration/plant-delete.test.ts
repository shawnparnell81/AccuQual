import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { sites, userSites } from "../../src/drizzle/schema/sites.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let adminId: number;
let adminToken: string;
let operatorToken: string;

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("deleting a plant", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [admin] = await db.insert(users).values({ email: `plant-del-admin-${suffix}@test.local`, passwordHash: "unused", name: "Plant Admin" }).returning();
    const [operator] = await db.insert(users).values({ email: `plant-del-op-${suffix}@test.local`, passwordHash: "unused", name: "Operator", department: "quality" }).returning();
    adminId = admin!.id;
    adminToken = signAccessToken({ sub: String(adminId), roleId: null, roleName: "admin", department: null });
    operatorToken = signAccessToken({ sub: String(operator!.id), roleId: null, roleName: "operator", department: "quality" });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("refuses a role that does not have plants.delete", async () => {
    const res = await request(app).delete("/sites/1").set(auth(operatorToken));
    expect(res.status).toBe(403);
  });

  it("hides a deactivated plant and lets the same name and code be added again", async () => {
    const code = `shelved-${suffix}`;
    const [shelved] = await db.insert(sites).values({ name: "Shelved plant", code, status: "inactive", isDefault: false }).returning();
    const listed = await request(app).get("/sites").set(auth(adminToken));
    expect(listed.status).toBe(200);
    expect(listed.body.sites.map((site: { id: number }) => site.id)).not.toContain(shelved!.id);

    const again = await request(app).post("/sites").set(auth(adminToken)).send({ name: "Shelved plant", code });
    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(shelved!.id);
    expect(again.body.name).toBe("Shelved plant");
  });

  it("deletes a plant that has an issue, keeps the name on that issue, and allows the same name again", async () => {
    const created = await request(app).post("/sites").set(auth(adminToken)).send({ name: "Harbor", code: "harbor" });
    expect(created.status).toBe(201);
    const harborId = created.body.id as number;

    const [only] = await db.insert(users).values({ email: `plant-del-only-${suffix}@test.local`, passwordHash: "unused", name: "Only Harbor", department: "quality" }).returning();
    const [both] = await db.insert(users).values({ email: `plant-del-both-${suffix}@test.local`, passwordHash: "unused", name: "Both Plants", department: "quality" }).returning();
    const onlyToken = signAccessToken({ sub: String(only!.id), roleId: null, roleName: "operator", department: "quality" });
    const bothToken = signAccessToken({ sub: String(both!.id), roleId: null, roleName: "operator", department: "quality" });

    const [main] = await db.select().from(sites).where(eq(sites.isDefault, true));
    const mainId = main!.id;

    const addHarbor = await request(app).put(`/sites/${harborId}/members`).set(auth(adminToken)).send({ userIds: [only!.id, both!.id] });
    expect(addHarbor.status).toBe(200);
    const mainMembers = await request(app).get(`/sites/${mainId}/members`).set(auth(adminToken));
    expect(mainMembers.status).toBe(200);
    const kept = (mainMembers.body.userIds as number[]).filter((id) => id !== only!.id);
    const dropOnly = await request(app).put(`/sites/${mainId}/members`).set(auth(adminToken)).send({ userIds: kept });
    expect(dropOnly.status).toBe(200);

    expect((await request(app).post("/sites/current").set(auth(onlyToken)).send({ siteId: harborId })).status).toBe(200);
    expect((await request(app).post("/sites/current").set(auth(bothToken)).send({ siteId: harborId })).status).toBe(200);

    const issue = await request(app).post("/ncr").set(auth(onlyToken)).send({ title: "Issue at harbor", severity: "low" });
    expect(issue.status).toBe(201);
    expect(issue.body.siteId).toBe(harborId);

    const removed = await request(app).delete(`/sites/${harborId}`).set(auth(adminToken));
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ id: harborId, name: "Harbor" });

    const [tombstone] = await db.select().from(sites).where(eq(sites.id, harborId));
    expect(tombstone!.deletedAt).toBeTruthy();
    expect(tombstone!.nameSnapshot).toBe("Harbor");
    expect(tombstone!.name).toBe("Harbor");
    expect(tombstone!.status).toBe("inactive");
    expect(tombstone!.isDefault).toBe(false);

    const [keptIssue] = await db.select().from(ncr).where(eq(ncr.id, issue.body.id));
    expect(keptIssue!.siteId).toBe(harborId);
    expect(keptIssue!.title).toBe("Issue at harbor");
    expect(keptIssue!.isDeleted).toBe(false);

    const membership = await db.select().from(userSites).where(and(eq(userSites.siteId, harborId), eq(userSites.userId, only!.id)));
    expect(membership).toHaveLength(1);

    const [onlyUser] = await db.select().from(users).where(eq(users.id, only!.id));
    const [bothUser] = await db.select().from(users).where(eq(users.id, both!.id));
    expect(onlyUser!.currentSiteId).toBeNull();
    expect(bothUser!.currentSiteId).toBe(mainId);

    const onlySites = await request(app).get("/sites").set(auth(onlyToken));
    expect(onlySites.status).toBe(200);
    expect(onlySites.body.currentSiteId).toBeNull();
    expect(onlySites.body.sites.map((site: { name: string }) => site.name)).not.toContain("Harbor");
    const onlyList = await request(app).get("/ncr").set(auth(onlyToken));
    expect(onlyList.status).toBe(200);

    const stillThere = await request(app).get(`/ncr/${issue.body.id}`).set(auth(adminToken)).set("X-AccuQual-Site", String(mainId));
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.siteId).toBe(harborId);
    expect(stillThere.body.title).toBe("Issue at harbor");

    const openedByWorker = await request(app).get(`/ncr/${issue.body.id}`).set(auth(onlyToken));
    expect(openedByWorker.status).toBe(200);

    const overview = await request(app).get("/dashboard/overview").query({ scope: "all" }).set(auth(adminToken));
    expect(overview.status).toBe(200);
    const record = (overview.body.openWork.records as { title: string; plant: string | null }[]).find((row) => row.title === "Issue at harbor");
    expect(record?.plant).toBe("Harbor");
    expect((overview.body.plants as { name: string }[]).map((plant) => plant.name)).not.toContain("Harbor");
    expect((overview.body.openWork.plants as { name: string }[]).map((plant) => plant.name)).not.toContain("Harbor");

    const listed = await request(app).get("/sites").set(auth(adminToken));
    expect(listed.body.canDelete).toBe(true);
    expect(listed.body.sites.map((site: { id: number }) => site.id)).not.toContain(harborId);

    const switched = await request(app).post("/sites/current").set(auth(adminToken)).send({ siteId: harborId });
    expect(switched.status).toBe(400);

    const [audit] = await db
      .select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityType, "Site"), eq(auditTrail.entityId, harborId), eq(auditTrail.action, "delete")));
    expect(audit!.performedBy).toBe(adminId);
    expect(audit!.createdAt).toBeTruthy();
    expect((audit!.changes as { summary?: string }).summary).toMatch(/Deleted plant "Harbor" \(harbor\)/);

    const again = await request(app).post("/sites").set(auth(adminToken)).send({ name: "Harbor", code: "harbor" });
    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(harborId);

    const after = await request(app).get(`/ncr/${issue.body.id}`).set(auth(adminToken));
    expect(after.status).toBe(200);
    expect(after.body.siteId).toBe(harborId);

    await db.insert(roles).values({ name: `plant-clerk-${suffix}`, description: "Deletes plants", hierarchyLevel: 70, isProtected: false, permissions: ["plants.delete"] });
    const clerkToken = signAccessToken({ sub: String(adminId), roleId: null, roleName: `plant-clerk-${suffix}`, department: null });
    const clerkDelete = await request(app).delete(`/sites/${again.body.id}`).set(auth(clerkToken));
    expect(clerkDelete.status).toBe(200);
    const afterClerk = await request(app).get("/sites").set(auth(adminToken));
    expect(afterClerk.body.sites.map((site: { id: number }) => site.id)).not.toContain(again.body.id);
  });
});
