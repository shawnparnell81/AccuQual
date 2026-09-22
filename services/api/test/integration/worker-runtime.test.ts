// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Worker Runtime: profile fields on top of `users`, a self-service "me" endpoint with no extra gate, RBAC on viewing/editing
// someone else's profile, tenant isolation, an activity view that reuses the Calendar aggregator, and the audit trail.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { workerProfiles } from "../../src/drizzle/schema/workerProfiles.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { auditRowChanges } from "../../src/drizzle/schema/auditRowChanges.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let otherTenantId: number;
const userIds: number[] = [];
type Who = { id: number; email: string; token: string };
let qualityUser: Who; // quality department, ordinary role: view + manage (default worker_profile edit)
let production: Who; // production department: view only (default read)
let customer: Who; // external: refused entirely
let otherAdmin: Who;

const roleIdByName = new Map<string, number>();
async function roleId(name: string): Promise<number> {
  if (roleIdByName.has(name)) return roleIdByName.get(name)!;
  const [row] = await db.insert(roles).values({ name }).onConflictDoNothing().returning();
  const id = row?.id ?? (await db.select({ id: roles.id }).from(roles).where(eq(roles.name, name)))[0]!.id;
  roleIdByName.set(name, id);
  return id;
}

// A real `roleId` FK, not just a roleName in the JWT — worker.service.ts looks up a TARGET user's role from the database (it
// can't trust a client-supplied claim about someone else), so the "customer is excluded from the roster" behavior can only be
// exercised with a fixture that actually has one, the same way every real account (register/SSO) does.
async function makeUser(tenant: number, label: string, roleName: string, department: string | null): Promise<Who> {
  const email = `worker-${label}-${suffix}@test.local`;
  const rid = await roleId(roleName);
  const [u] = await db.insert(users).values({ tenantId: tenant, email, passwordHash: "unused", name: `${label} person`, department, roleId: rid }).returning();
  userIds.push(u!.id);
  return { id: u!.id, email, token: await signAccessToken({ sub: String(u!.id), tenantId: tenant, roleId: rid, roleName, department }) };
}
const as = (w: Who) => ({ Authorization: `Bearer ${w.token}` });

describe("Worker Runtime (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [t] = await db.insert(tenants).values({ name: `Worker ${suffix}`, code: `worker-${suffix}` }).returning();
    const [o] = await db.insert(tenants).values({ name: `Worker Other ${suffix}`, code: `worker-other-${suffix}` }).returning();
    tenantId = t!.id;
    otherTenantId = o!.id;
    await seedDefaultPermissions(tenantId);
    await seedDefaultPermissions(otherTenantId);
    qualityUser = await makeUser(tenantId, "quality", "operator", "quality");
    production = await makeUser(tenantId, "production", "operator", "production");
    customer = await makeUser(tenantId, "customer", "customer", null);
    otherAdmin = await makeUser(otherTenantId, "other", "admin", null);
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    for (const t of [tenantId, otherTenantId]) {
      await db.delete(auditRowChanges).where(eq(auditRowChanges.tenantId, t));
      await db.delete(auditTrail).where(eq(auditTrail.tenantId, t));
      await db.delete(workerProfiles).where(eq(workerProfiles.tenantId, t));
      await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, t));
      await db.delete(ncr).where(eq(ncr.tenantId, t));
      await db.delete(users).where(eq(users.tenantId, t));
    }
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await pool.end();
  });

  it("GET /workers/me returns a blank profile + empty activity for someone with no profile row yet", async () => {
    const res = await request(app).get("/workers/me").set(as(production));
    expect(res.status).toBe(200);
    expect(res.body.profile.userId).toBe(production.id);
    expect(res.body.profile.employmentStatus).toBe("active");
    expect(res.body.profile.jobTitle).toBeNull();
    expect(res.body.activity).toEqual([]);
  });

  it("GET /workers/me needs no worker_profile permission at all — it's always your own data", async () => {
    // customer accounts are refused every other worker route, but /me only ever returns the caller's own row.
    const res = await request(app).get("/workers/me").set(as(customer));
    expect(res.status).toBe(200);
    expect(res.body.profile.userId).toBe(customer.id);
  });

  it("production (default view-only) can list the roster and read a coworker's profile", async () => {
    const list = await request(app).get("/workers").set(as(production));
    expect(list.status).toBe(200);
    expect(list.body.some((w: { userId: number }) => w.userId === qualityUser.id)).toBe(true);

    const one = await request(app).get(`/workers/${qualityUser.id}`).set(as(production));
    expect(one.status).toBe(200);
    expect(one.body.profile.userId).toBe(qualityUser.id);
  });

  it("production (default view-only, no edit) is refused writing another worker's profile", async () => {
    const res = await request(app).patch(`/workers/${qualityUser.id}`).set(as(production)).send({ jobTitle: "Line Lead" });
    expect(res.status).toBe(403);
  });

  it("customer (external role) is refused the roster and detail routes outright", async () => {
    expect((await request(app).get("/workers").set(as(customer))).status).toBe(403);
    expect((await request(app).get(`/workers/${production.id}`).set(as(customer))).status).toBe(403);
  });

  it("quality (default edit) can create then update a coworker's profile, and it's reflected in the roster and detail view", async () => {
    const create = await request(app).patch(`/workers/${production.id}`).set(as(qualityUser)).send({ jobTitle: "Machine Operator", shift: "day", skills: ["forklift certified"] });
    expect(create.status).toBe(200);
    expect(create.body.jobTitle).toBe("Machine Operator");
    expect(create.body.skills).toEqual(["forklift certified"]);

    const update = await request(app).patch(`/workers/${production.id}`).set(as(qualityUser)).send({ shift: "night", employmentStatus: "on_leave" });
    expect(update.status).toBe(200);
    expect(update.body.shift).toBe("night");
    expect(update.body.employmentStatus).toBe("on_leave");
    // The field left out of the second patch keeps its prior value rather than being wiped.
    expect(update.body.jobTitle).toBe("Machine Operator");

    const detail = await request(app).get(`/workers/${production.id}`).set(as(qualityUser));
    expect(detail.body.profile.employmentStatus).toBe("on_leave");

    const roster = await request(app).get("/workers").set(as(qualityUser));
    const row = roster.body.find((w: { userId: number }) => w.userId === production.id);
    expect(row.employmentStatus).toBe("on_leave");
  });

  it("records the edit in the audit trail, distinguishing create from update", async () => {
    const rows = await db
      .select()
      .from(auditTrail)
      .where(and(eq(auditTrail.tenantId, tenantId), eq(auditTrail.entityType, "WorkerProfile"), eq(auditTrail.entityId, production.id)));
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("create");
    expect(actions).toContain("update");
  });

  it("activity aggregates real assignments — an NCR assigned to the worker shows up in their /me and their detail view", async () => {
    const [row] = await db.insert(ncr).values({ tenantId, title: "Worker activity test NCR", assignedTo: production.id, isDeleted: false }).returning();

    const mine = await request(app).get("/workers/me").set(as(production));
    expect(mine.body.activity.some((item: { id: string }) => item.id === `ncr-${row!.id}`)).toBe(true);

    const seenByManager = await request(app).get(`/workers/${production.id}`).set(as(qualityUser));
    expect(seenByManager.body.activity.some((item: { id: string }) => item.id === `ncr-${row!.id}`)).toBe(true);
  });

  it("404s for a real user id from a DIFFERENT tenant — never silently returns another tenant's worker", async () => {
    const res = await request(app).get(`/workers/${otherAdmin.id}`).set(as(qualityUser));
    expect(res.status).toBe(404);
  });

  it("404s for a supplier/customer account id — external logins are never a worker to look up", async () => {
    const res = await request(app).get(`/workers/${customer.id}`).set(as(qualityUser));
    expect(res.status).toBe(404);
  });

  it("404s for a made-up id, and rejects a non-numeric id as a bad request", async () => {
    expect((await request(app).get("/workers/999999999").set(as(qualityUser))).status).toBe(404);
    expect((await request(app).get("/workers/not-a-number").set(as(qualityUser))).status).toBe(400);
  });
});
