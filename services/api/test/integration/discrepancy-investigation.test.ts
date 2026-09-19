// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Discrepancy & Investigation (quality/DI): RBAC, the guarded
// open -> investigating -> disposed -> closed lifecycle (status is NOT
// editable via the generic PATCH), the disposition requirement, closed
// immutability, assignee tenant validation, and the two-way sync between the
// record and its investigation form (form_data).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { discrepancyInvestigations } from "../../src/drizzle/schema/quality.js";
import { audits, auditItems } from "../../src/drizzle/schema/audits.js";
import { formData } from "../../src/drizzle/schema/forms.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let otherTenantId: number;
let otherTenantUserId: number;
const userIds: number[] = [];
let qualityToken: string;
let engineeringToken: string;

async function makeUser(department: string | null, forTenant = tenantId) {
  const [user] = await db.insert(users).values({ tenantId: forTenant, email: `di-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return { id: user!.id, token: await signAccessToken({ sub: String(user!.id), tenantId: forTenant, roleId: null, roleName: "operator", department }) };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createDi(token: string, body: Record<string, unknown> = { title: "Fixture discrepancy" }) {
  const res = await request(app).post("/quality").set(auth(token)).send(body);
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function formRow(id: number) {
  const [row] = await db.select().from(formData).where(and(eq(formData.tenantId, tenantId), eq(formData.formType, "discrepancy_inspection"), eq(formData.entityId, id)));
  return row;
}

describe("Discrepancy & Investigation / quality-DI (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `DI Test Tenant ${suffix}`, code: `di-test-${suffix}` }).returning();
    const [other] = await db.insert(tenants).values({ name: `DI Other Tenant ${suffix}`, code: `di-other-${suffix}` }).returning();
    tenantId = tenant!.id;
    otherTenantId = other!.id;
    await seedDefaultPermissions(tenantId);

    qualityToken = (await makeUser("quality")).token;
    engineeringToken = (await makeUser("engineering")).token; // di's default permissions are quality-only
    otherTenantUserId = (await makeUser("quality", otherTenantId)).id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(formData).where(eq(formData.tenantId, tenantId));
    await db.delete(discrepancyInvestigations).where(eq(discrepancyInvestigations.tenantId, tenantId));
    await db.delete(auditItems).where(eq(auditItems.tenantId, tenantId));
    await db.delete(audits).where(eq(audits.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await pool.end();
  });

  it("engineering (zero access to di) cannot create a discrepancy investigation", async () => {
    const res = await request(app).post("/quality").set(auth(engineeringToken)).send({ title: "Should be blocked" });
    expect(res.status).toBe(403);
  });

  it("a fresh discrepancy investigation starts as open", async () => {
    const id = await createDi(qualityToken);
    const res = await request(app).get(`/quality/${id}`).set(auth(qualityToken));
    expect(res.body.status).toBe("open");
  });

  it("cannot close a discrepancy investigation before it's disposed", async () => {
    const id = await createDi(qualityToken);
    const res = await request(app).post(`/quality/${id}/close`).set(auth(qualityToken));
    expect(res.status).toBe(400);
  });

  it("status is not editable via the generic PATCH — a raw status:closed is ignored, not applied", async () => {
    const id = await createDi(qualityToken);
    const patch = await request(app).patch(`/quality/${id}`).set(auth(qualityToken)).send({ status: "closed", title: "Retitled" });
    expect(patch.status).toBe(200);
    expect(patch.body.status).toBe("open");
    expect(patch.body.title).toBe("Retitled");
  });

  it("enforces open -> investigating -> disposed -> closed, one guarded hop at a time", async () => {
    const id = await createDi(qualityToken);
    const q = (path: string, body: object = {}) => request(app).post(`/quality/${id}/${path}`).set(auth(qualityToken)).send(body);

    expect((await q("dispose", { disposition: "rework" })).status).toBe(400); // open can't skip to disposed
    expect((await q("investigate")).status).toBe(200);
    expect((await q("investigate")).status).toBe(400); // already investigating
    expect((await q("close")).status).toBe(400); // not disposed yet

    const dispose = await q("dispose", { disposition: "rework" });
    expect(dispose.status).toBe(200);
    expect(dispose.body.status).toBe("disposed");
    expect(dispose.body.disposition).toBe("rework");

    const close = await q("close");
    expect(close.status).toBe(200);
    expect(close.body.status).toBe("closed");

    const trail = await db.select().from(auditTrail).where(and(eq(auditTrail.entityId, id), eq(auditTrail.entityType, "Discrepancy investigation")));
    expect(trail.filter((t) => t.action === "status_change")).toHaveLength(3);
  });

  it("disposing requires a disposition — in the request or already set on the record", async () => {
    const id = await createDi(qualityToken);
    await request(app).post(`/quality/${id}/investigate`).set(auth(qualityToken));

    const none = await request(app).post(`/quality/${id}/dispose`).set(auth(qualityToken)).send({});
    expect(none.status).toBe(400);

    await request(app).patch(`/quality/${id}`).set(auth(qualityToken)).send({ disposition: "scrap" });
    const withSaved = await request(app).post(`/quality/${id}/dispose`).set(auth(qualityToken)).send({});
    expect(withSaved.status).toBe(200);
    expect(withSaved.body.disposition).toBe("scrap");
  });

  it("a closed investigation cannot be edited", async () => {
    const id = await createDi(qualityToken);
    for (const [path, body] of [["investigate", {}], ["dispose", { disposition: "sort" }], ["close", {}]] as const) {
      await request(app).post(`/quality/${id}/${path}`).set(auth(qualityToken)).send(body);
    }
    const res = await request(app).patch(`/quality/${id}`).set(auth(qualityToken)).send({ title: "Too late" });
    expect(res.status).toBe(400);
  });

  it("engineering cannot advance one either", async () => {
    const id = await createDi(qualityToken);
    const res = await request(app).post(`/quality/${id}/investigate`).set(auth(engineeringToken));
    expect(res.status).toBe(403);
  });

  it("rejects assigning an investigation to a user from another tenant", async () => {
    const id = await createDi(qualityToken);
    const res = await request(app).patch(`/quality/${id}`).set(auth(qualityToken)).send({ assignedTo: otherTenantUserId });
    expect(res.status).toBe(400);
  });

  describe("investigation form sync", () => {
    it("creating a discrepancy seeds its form with title, severity, description and status", async () => {
      const id = await createDi(qualityToken, { title: "Bent bracket", severity: "major", description: "Found at station 4" });
      const row = await formRow(id);
      expect(row?.data).toMatchObject({ title: "Bent bracket", severity: "Major", description: "Found at station 4", status: "Open" });
    });

    it("saving the form writes title/severity/description/disposition back to the record", async () => {
      const id = await createDi(qualityToken);
      const save = await request(app)
        .post(`/forms/discrepancy_inspection/${id}/save`)
        .set(auth(qualityToken))
        .send({ entityId: id, data: { title: "Edited in form", severity: "Critical", description: "New text", disposition: [{ value: { Repair: true } }] } });
      expect(save.status).toBe(200);

      const record = await request(app).get(`/quality/${id}`).set(auth(qualityToken));
      expect(record.body).toMatchObject({ title: "Edited in form", severity: "critical", description: "New text", disposition: "repair" });
    });

    it("editing the form's Status box does NOT change the record's status", async () => {
      const id = await createDi(qualityToken);
      await request(app).post(`/forms/discrepancy_inspection/${id}/save`).set(auth(qualityToken)).send({ entityId: id, data: { status: "Closed", title: "Fixture discrepancy" } });
      const record = await request(app).get(`/quality/${id}`).set(auth(qualityToken));
      expect(record.body.status).toBe("open");
    });

    it("moving the record through the workflow mirrors status and disposition into the form", async () => {
      const id = await createDi(qualityToken);
      await request(app).post(`/quality/${id}/investigate`).set(auth(qualityToken));
      await request(app).post(`/quality/${id}/dispose`).set(auth(qualityToken)).send({ disposition: "return-to-supplier" });
      const row = await formRow(id);
      expect(row?.data).toMatchObject({ status: "Disposed", disposition: [{ value: { "Return to Supplier": true } }] });
    });

    it("a form edit after the investigation is closed is ignored", async () => {
      const id = await createDi(qualityToken, { title: "Final title" });
      for (const [path, body] of [["investigate", {}], ["dispose", { disposition: "sort" }], ["close", {}]] as const) {
        await request(app).post(`/quality/${id}/${path}`).set(auth(qualityToken)).send(body);
      }
      await request(app).post(`/forms/discrepancy_inspection/${id}/save`).set(auth(qualityToken)).send({ entityId: id, data: { title: "Sneaky late edit" } });
      const record = await request(app).get(`/quality/${id}`).set(auth(qualityToken));
      expect(record.body.title).toBe("Final title");
    });

    it("a nonconformance found in an internal audit auto-opens a discrepancy whose form is pre-filled with the audit source", async () => {
      const audit = await request(app).post("/audits").set(auth(qualityToken)).send({ name: "Sync Audit", type: "internal" });
      expect(audit.status).toBe(201);
      const item = await request(app).post(`/audits/${audit.body.id}/item`).set(auth(qualityToken)).send({ question: "Is torque logged?", finding: "No torque log", severity: "major" });
      expect(item.status).toBe(201);

      const di = item.body.discrepancyInvestigation;
      const row = await formRow(di.id);
      expect(row?.data).toMatchObject({ severity: "Major", description: "No torque log", status: "Open" });
      expect((row?.data as { sourceReference?: string }).sourceReference).toContain(`Audit #${audit.body.id}`);
    });
  });
});
