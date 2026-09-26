import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment
// for why this category exists). Covers the new Customer Contact &
// Communications Log module: real create/list/audit-trail, department RBAC
// (Customer Service/Quality: edit, everyone else: read), and company
// isolation on the real HTTP path — same battery
// company-isolation-modules.test.ts already applies to 6 other modules.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { customers } from "../../src/drizzle/schema/customers.js";
import { customerCommunications } from "../../src/drizzle/schema/customerCommunications.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;

let customerId: number;
let otherCompanyCustomerId: number | undefined;
const userIds: number[] = [];
let customerServiceToken: string;
let qualityToken: string;
let purchasingToken: string;

async function makeUser(forCompanyId: number, department: string | null, roleName = "operator") {
  const [user] = await db.insert(users).values({ email: `cc-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department });
}

describe("Customer Communications (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    
    
    await seedDefaultPermissions(companyId);
    

    const [customer] = await db.insert(customers).values({ legalName: `Test Customer Inc. ${suffix}` }).returning();
    customerId = customer!.id;

    customerServiceToken = await makeUser(companyId, "customer_service");
    qualityToken = await makeUser(companyId, "quality");
    purchasingToken = await makeUser(companyId, "purchasing");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("Customer Service can create a real communication log entry", async () => {
    const res = await request(app)
      .post("/customer-communications")
      .set("Authorization", `Bearer ${customerServiceToken}`)
      .send({ customerId, commsType: "phone", subject: "Delivery delay", summary: "Called re: late shipment.", followUpRequired: true });
    expect(res.status).toBe(201);
    expect(res.body.customerId).toBe(customerId);
    expect(res.body.followUpRequired).toBe(true);

    const trail = await db.select().from(auditTrail).where(eq(auditTrail.entityType, "CustomerCommunication"));
    expect(trail.some((t) => t.entityId === res.body.id && t.action === "create")).toBe(true);
  });

  it("Quality can also create and edit — the second department this module grants edit to", async () => {
    const res = await request(app)
      .post("/customer-communications")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ customerId, commsType: "email", summary: "Sent root-cause explanation for NCR-linked defect." });
    expect(res.status).toBe(201);

    const patch = await request(app).patch(`/customer-communications/${res.body.id}`).set("Authorization", `Bearer ${qualityToken}`).send({ summary: "Updated: customer confirmed receipt." });
    expect(patch.status).toBe(200);
    expect(patch.body.summary).toBe("Updated: customer confirmed receipt.");
  });

  it("a read-only department (Purchasing) can list but not create", async () => {
    const list = await request(app).get("/customer-communications").set("Authorization", `Bearer ${purchasingToken}`);
    expect(list.status).toBe(200);

    const create = await request(app).post("/customer-communications").set("Authorization", `Bearer ${purchasingToken}`).send({ customerId, commsType: "email", summary: "should be blocked" });
    expect(create.status).toBe(403);
  });

  it("rejects an invalid commsType", async () => {
    const res = await request(app).post("/customer-communications").set("Authorization", `Bearer ${customerServiceToken}`).send({ customerId, commsType: "carrier_pigeon", summary: "x" });
    expect(res.status).toBe(400);
  });

  it("rejects an absurd/malformed date with a clean 400, not a real crash — a live-reproduced bug (z.coerce.date() alone accepts a mistyped '91920-02-06' as a real year-91920 Date, which then crashed at the Postgres layer)", async () => {
    const res = await request(app)
      .post("/customer-communications")
      .set("Authorization", `Bearer ${customerServiceToken}`)
      .send({ customerId, commsType: "phone", summary: "x", followUpDate: "91920-02-06" });
    expect(res.status).toBe(400);
  });

  ;
});
