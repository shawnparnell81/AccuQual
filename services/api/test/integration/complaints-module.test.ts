// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Full-System Audit finding H4: Complaints had zero test references anywhere
// in the suite — no coverage of its real 4-department RBAC split
// (Quality/Engineering/Customer Service: edit, Production: read-only, see
// defaultPermissions.ts) or of its plain-PATCH status lifecycle (no
// dedicated transition endpoints, unlike NCR/CAPA).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { complaints } from "../../src/drizzle/schema/complaints.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
const userIds: number[] = [];
let customerServiceToken: string;
let productionToken: string;
let purchasingToken: string;

async function makeUser(department: string | null) {
  const [user] = await db.insert(users).values({ tenantId, email: `complaints-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName: "operator", department });
}

describe("Complaints module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Complaints Test Tenant ${suffix}`, code: `complaints-${suffix}` }).returning();
    tenantId = tenant!.id;
    await seedDefaultPermissions(tenantId);

    customerServiceToken = await makeUser("customer_service"); // edit
    productionToken = await makeUser("production"); // read-only
    purchasingToken = await makeUser("purchasing"); // zero access — not in complaints' department map at all
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(complaints).where(eq(complaints.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("purchasing (not in the complaints department map at all) is blocked outright", async () => {
    const res = await request(app).post("/complaints").set("Authorization", `Bearer ${purchasingToken}`).send({ description: "Should be blocked" });
    expect(res.status).toBe(403);
  });

  it("customer service (edit) can create a complaint, defaulting to status open", async () => {
    const res = await request(app).post("/complaints").set("Authorization", `Bearer ${customerServiceToken}`).send({ customerName: "Acme Co", description: "Widget arrived cracked", severity: "medium" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("open");
  });

  it("production (read-only) can list and read complaints but cannot create or update one", async () => {
    const create = await request(app).post("/complaints").set("Authorization", `Bearer ${customerServiceToken}`).send({ description: "Read-only fixture complaint" });
    const id = create.body.id as number;

    const list = await request(app).get("/complaints").set("Authorization", `Bearer ${productionToken}`);
    expect(list.status).toBe(200);

    const read = await request(app).get(`/complaints/${id}`).set("Authorization", `Bearer ${productionToken}`);
    expect(read.status).toBe(200);

    const blockedCreate = await request(app).post("/complaints").set("Authorization", `Bearer ${productionToken}`).send({ description: "Should be blocked" });
    expect(blockedCreate.status).toBe(403);

    const blockedUpdate = await request(app).patch(`/complaints/${id}`).set("Authorization", `Bearer ${productionToken}`).send({ status: "investigating" });
    expect(blockedUpdate.status).toBe(403);
  });

  it("customer service can walk a complaint through its real status lifecycle via PATCH", async () => {
    const create = await request(app).post("/complaints").set("Authorization", `Bearer ${customerServiceToken}`).send({ description: "Lifecycle complaint" });
    const id = create.body.id as number;

    const investigating = await request(app).patch(`/complaints/${id}`).set("Authorization", `Bearer ${customerServiceToken}`).send({ status: "investigating" });
    expect(investigating.status).toBe(200);
    expect(investigating.body.status).toBe("investigating");

    const resolved = await request(app).patch(`/complaints/${id}`).set("Authorization", `Bearer ${customerServiceToken}`).send({ status: "resolved" });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe("resolved");

    const closed = await request(app).patch(`/complaints/${id}`).set("Authorization", `Bearer ${customerServiceToken}`).send({ status: "closed" });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
  });

  it("a complaint can be linked to an NCR via linkedNcrId at creation", async () => {
    const res = await request(app).post("/complaints").set("Authorization", `Bearer ${customerServiceToken}`).send({ description: "Linked complaint", linkedNcrId: 999 });
    expect(res.status).toBe(201);
    expect(res.body.linkedNcrId).toBe(999);
  });
});
