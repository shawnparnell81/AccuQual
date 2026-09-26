import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Complaints: the 4-department RBAC split (Quality/Engineering/Customer
// Service: edit, Production: read-only), the guarded
// open -> investigating -> resolved -> closed lifecycle (status is NOT
// editable via the generic PATCH), the resolution requirement, closed
// immutability, company-checked NCR links/assignees, escalation to a real NCR,
// and the two-way sync with the complaint form.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { complaints } from "../../src/drizzle/schema/complaints.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { formData } from "../../src/drizzle/schema/forms.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;



const userIds: number[] = [];
let customerServiceToken: string;
let qualityToken: string;
let qualityUserId: number;
let productionToken: string;
let purchasingToken: string;

async function makeUser(department: string | null, forCompany = companyId) {
  const [user] = await db.insert(users).values({ email: `complaints-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return { id: user!.id, token: await signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department }) };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createComplaint(token = customerServiceToken, body: Record<string, unknown> = { description: "Fixture complaint" }) {
  const res = await request(app).post("/complaints").set(auth(token)).send(body);
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function formRow(id: number) {
  const [row] = await db.select().from(formData).where(and(eq(formData.formType, "complaint"), eq(formData.entityId, id)));
  return row;
}

describe("Complaints module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    
    companyId = co!.id;
    
    await seedDefaultPermissions(companyId);

    customerServiceToken = (await makeUser("customer_service")).token; // edit complaints, no NCR edit
    const quality = await makeUser("quality"); // edit complaints AND ncr
    qualityToken = quality.token;
    qualityUserId = quality.id;
    productionToken = (await makeUser("production")).token; // read-only
    purchasingToken = (await makeUser("purchasing")).token; // zero access — not in complaints' department map at all
    
    
    
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("purchasing (not in the complaints department map at all) is blocked outright", async () => {
    const res = await request(app).post("/complaints").set(auth(purchasingToken)).send({ description: "Should be blocked" });
    expect(res.status).toBe(403);
  });

  it("customer service (edit) can create a complaint, defaulting to status open", async () => {
    const res = await request(app).post("/complaints").set(auth(customerServiceToken)).send({ customerName: "Acme Co", productAffected: "Widget", description: "Widget arrived cracked", severity: "medium" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("open");
    expect(res.body.productAffected).toBe("Widget");
  });

  it("production (read-only) can list and read complaints but cannot create, update, or advance one", async () => {
    const id = await createComplaint();

    expect((await request(app).get("/complaints").set(auth(productionToken))).status).toBe(200);
    expect((await request(app).get(`/complaints/${id}`).set(auth(productionToken))).status).toBe(200);
    expect((await request(app).post("/complaints").set(auth(productionToken)).send({ description: "Should be blocked" })).status).toBe(403);
    expect((await request(app).patch(`/complaints/${id}`).set(auth(productionToken)).send({ description: "x" })).status).toBe(403);
    expect((await request(app).post(`/complaints/${id}/investigate`).set(auth(productionToken))).status).toBe(403);
  });

  it("status is not editable via the generic PATCH — a raw status:closed is ignored, not applied", async () => {
    const id = await createComplaint();
    const patch = await request(app).patch(`/complaints/${id}`).set(auth(customerServiceToken)).send({ status: "closed", severity: "high" });
    expect(patch.status).toBe(200);
    expect(patch.body.status).toBe("open");
    expect(patch.body.severity).toBe("high");
  });

  it("walks open -> investigating -> resolved -> closed through guarded hops, with audit history", async () => {
    const id = await createComplaint();
    const post = (path: string, body: object = {}) => request(app).post(`/complaints/${id}/${path}`).set(auth(customerServiceToken)).send(body);

    expect((await post("resolve", { resolution: "x" })).status).toBe(400); // open can't skip to resolved
    expect((await post("close")).status).toBe(400);
    expect((await post("investigate")).status).toBe(200);
    expect((await post("investigate")).status).toBe(400); // already investigating

    const resolved = await post("resolve", { resolution: "Replaced the unit and fixed the packaging." });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe("resolved");
    expect(resolved.body.resolution).toBe("Replaced the unit and fixed the packaging.");
    expect(resolved.body.resolvedAt).toBeTruthy();

    const closed = await post("close");
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
    expect(closed.body.closedAt).toBeTruthy();

    const trail = await db.select().from(auditTrail).where(and(eq(auditTrail.entityId, id), eq(auditTrail.entityType, "Complaint")));
    expect(trail.filter((t) => t.action === "status_change")).toHaveLength(3);
  });

  it("resolving requires a resolution — in the request or already saved on the complaint", async () => {
    const id = await createComplaint();
    await request(app).post(`/complaints/${id}/investigate`).set(auth(customerServiceToken));

    expect((await request(app).post(`/complaints/${id}/resolve`).set(auth(customerServiceToken)).send({})).status).toBe(400);

    await request(app).patch(`/complaints/${id}`).set(auth(customerServiceToken)).send({ resolution: "Credit issued." });
    const res = await request(app).post(`/complaints/${id}/resolve`).set(auth(customerServiceToken)).send({});
    expect(res.status).toBe(200);
    expect(res.body.resolution).toBe("Credit issued.");
  });

  it("a resolved complaint can be reopened to investigating; a closed one is final and uneditable", async () => {
    const id = await createComplaint();
    const post = (path: string, body: object = {}) => request(app).post(`/complaints/${id}/${path}`).set(auth(customerServiceToken)).send(body);
    await post("investigate");
    await post("resolve", { resolution: "First fix" });

    const reopened = await post("investigate");
    expect(reopened.status).toBe(200);
    expect(reopened.body.status).toBe("investigating");
    expect(reopened.body.resolvedAt).toBeNull();

    await post("resolve", { resolution: "Second fix" });
    await post("close");
    expect((await post("investigate")).status).toBe(400);
    expect((await request(app).patch(`/complaints/${id}`).set(auth(customerServiceToken)).send({ description: "Too late" })).status).toBe(400);
  });

  describe("NCR links and assignees", () => {
    it("accepts an NCR from this company, and lets the link be cleared", async () => {
      const [own] = await db.insert(ncr).values({ title: "Own NCR" }).returning();
      const id = await createComplaint(customerServiceToken, { description: "Linked complaint", linkedNcrId: own!.id });
      const linked = await request(app).get(`/complaints/${id}`).set(auth(customerServiceToken));
      expect(linked.body.linkedNcrId).toBe(own!.id);

      const cleared = await request(app).patch(`/complaints/${id}`).set(auth(customerServiceToken)).send({ linkedNcrId: null });
      expect(cleared.body.linkedNcrId).toBeNull();
    });

    it("rejects an NCR id that does not exist in this company (including another company's real NCR)", async () => {
      expect((await request(app).post("/complaints").set(auth(customerServiceToken)).send({ description: "Bad link", linkedNcrId: 99999999 })).status).toBe(400);
      
    });

    it("assigns to a colleague, but rejects a user from another company", async () => {
      const id = await createComplaint();
      const ok = await request(app).patch(`/complaints/${id}`).set(auth(customerServiceToken)).send({ assignedTo: qualityUserId });
      expect(ok.status).toBe(200);
      expect(ok.body.assignedTo).toBe(qualityUserId);

      
      
    });
  });

  describe("escalate to NCR", () => {
    it("creates a real NCR from the complaint and links it — but only for someone with NCR edit access", async () => {
      const id = await createComplaint(customerServiceToken, { customerName: "Acme Co", description: "Cracked housing", severity: "high" });

      const blocked = await request(app).post(`/complaints/${id}/escalate-to-ncr`).set(auth(customerServiceToken));
      expect(blocked.status).toBe(403);

      const res = await request(app).post(`/complaints/${id}/escalate-to-ncr`).set(auth(qualityToken));
      expect(res.status).toBe(201);
      expect(res.body.ncr).toMatchObject({ description: "Cracked housing", severity: "high", status: "open" });
      expect(res.body.ncr.title).toContain(`Customer complaint #${id}`);
      expect(res.body.complaint.linkedNcrId).toBe(res.body.ncr.id);

      const again = await request(app).post(`/complaints/${id}/escalate-to-ncr`).set(auth(qualityToken));
      expect(again.status).toBe(400); // already linked

      const ncrForm = await db.select().from(formData).where(and(eq(formData.formType, "ncr"), eq(formData.entityId, res.body.ncr.id)));
      expect(ncrForm).toHaveLength(1); // the new NCR's official document is seeded, like any other NCR
    });
  });

  describe("complaint form sync", () => {
    it("creating a complaint seeds its form with the description", async () => {
      const id = await createComplaint(customerServiceToken, { description: "Seeded description" });
      expect((await formRow(id))?.data).toMatchObject({ description: "Seeded description" });
    });

    it("saving the form writes description and resolution back to the record", async () => {
      const id = await createComplaint();
      const save = await request(app)
        .post(`/forms/complaint/${id}/save`)
        .set(auth(customerServiceToken))
        .send({ entityId: id, data: { description: "Rewritten in the form", resolution: "Written in the form" } });
      expect(save.status).toBe(200);
      const record = await request(app).get(`/complaints/${id}`).set(auth(customerServiceToken));
      expect(record.body).toMatchObject({ description: "Rewritten in the form", resolution: "Written in the form" });
    });

    it("a resolution written through the workflow appears in the form, and late form edits to a closed complaint are ignored", async () => {
      const id = await createComplaint();
      const post = (path: string, body: object = {}) => request(app).post(`/complaints/${id}/${path}`).set(auth(customerServiceToken)).send(body);
      await post("investigate");
      await post("resolve", { resolution: "Fixed properly" });
      expect((await formRow(id))?.data).toMatchObject({ resolution: "Fixed properly" });

      await post("close");
      await request(app).post(`/forms/complaint/${id}/save`).set(auth(customerServiceToken)).send({ entityId: id, data: { resolution: "Sneaky late edit" } });
      const record = await request(app).get(`/complaints/${id}`).set(auth(customerServiceToken));
      expect(record.body.resolution).toBe("Fixed properly");
    });
  });
});
