// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Covers the generic QMS Simple Form engine — backs 22 of the "ACCUQUAL
// Forms" batch's forms (see qmsFormDefinitions.ts's schema comment for why
// the other 13 of the original 35 candidates were dropped in favor of
// linking straight to already-real modules, and why forms 01/37 were never
// on this engine at all). Tests two different formTypes to prove the engine
// really is generic (not hardcoded to one shape), the row sub-resource CRUD,
// rejection of an unknown formType or an unknown sectionKey, and full
// delete cascading the rows. Deliberately ungated — a production-department
// user proves there's truly no department gate, same as Document Control.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { qmsForms, qmsFormRows } from "../../src/drizzle/schema/qmsForms.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let formId: number;
let rowId: number;
const userIds: number[] = [];

let productionToken: string;

async function makeUser(department: string | null) {
  const [user] = await db.insert(users).values({ tenantId, email: `qmsforms-test-${department ?? "none"}-${suffix}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName: "operator", department });
}

describe("Generic QMS Simple Form engine (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `QMS Forms Test Tenant ${suffix}`, code: `qmsforms-test-${suffix}` }).returning();
    tenantId = tenant!.id;
    productionToken = await makeUser("production"); // proves there's no department gate at all
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(inArray(auditTrail.performedBy, userIds));
    if (formId) {
      await db.delete(qmsFormRows).where(eq(qmsFormRows.formId, formId));
      await db.delete(qmsForms).where(eq(qmsForms.id, formId));
    }
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("GET /qms-forms/types returns all real definitions", async () => {
    const res = await request(app).get("/qms-forms/types").set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(15);
    expect(res.body.some((d: { formType: string }) => d.formType === "record_retention_log")).toBe(true);
  });

  it("rejects an unknown form type", async () => {
    const res = await request(app).post("/qms-forms").set("Authorization", `Bearer ${productionToken}`).send({ formType: "not_a_real_form" });
    expect(res.status).toBe(400);
  });

  it("any authenticated user can create a real form — no department gate at all", async () => {
    const res = await request(app).post("/qms-forms").set("Authorization", `Bearer ${productionToken}`).send({ formType: "record_retention_log", formNo: "QF-004" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.formType).toBe("record_retention_log");
    formId = res.body.id;

    const [row] = await db.select().from(auditTrail).where(eq(auditTrail.entityType, "QmsForm"));
    expect(row).toBeTruthy();
    expect(row!.action).toBe("create");
  });

  it("the detail endpoint returns the matching definition and empty rows", async () => {
    const res = await request(app).get(`/qms-forms/${formId}`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(200);
    expect(res.body.definition.formType).toBe("record_retention_log");
    expect(res.body.rows).toEqual([]);
  });

  it("updates the header, including the status checkboxes", async () => {
    const res = await request(app).patch(`/qms-forms/${formId}`).set("Authorization", `Bearer ${productionToken}`).send({ status: "active", preparedBy: "J. Smith" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
    expect(res.body.preparedBy).toBe("J. Smith");
  });

  it("rejects a row for a section that doesn't exist on this form type", async () => {
    const res = await request(app).post(`/qms-forms/${formId}/rows`).set("Authorization", `Bearer ${productionToken}`).send({ sectionKey: "not_a_real_section" });
    expect(res.status).toBe(400);
  });

  it("adds a row to the real section, storing arbitrary jsonb column data", async () => {
    const res = await request(app)
      .post(`/qms-forms/${formId}/rows`)
      .set("Authorization", `Bearer ${productionToken}`)
      .send({ sectionKey: "record_register", data: { recordType: "NCR", owner: "Quality", retentionPeriod: "7 years" } });
    expect(res.status).toBe(201);
    expect(res.body.data.recordType).toBe("NCR");
    rowId = res.body.id;

    const detail = await request(app).get(`/qms-forms/${formId}`).set("Authorization", `Bearer ${productionToken}`);
    expect(detail.body.rows.length).toBe(1);
  });

  it("updates a row's data", async () => {
    const res = await request(app).patch(`/qms-forms/${formId}/rows/${rowId}`).set("Authorization", `Bearer ${productionToken}`).send({ data: { recordType: "CAPA", owner: "Quality" } });
    expect(res.status).toBe(200);
    expect(res.body.data.recordType).toBe("CAPA");
  });

  it("a second, differently-shaped form type works through the exact same engine", async () => {
    const created = await request(app).post("/qms-forms").set("Authorization", `Bearer ${productionToken}`).send({ formType: "design_history_form" });
    expect(created.status).toBe(201);
    const otherId = created.body.id;

    const row = await request(app)
      .post(`/qms-forms/${otherId}/rows`)
      .set("Authorization", `Bearer ${productionToken}`)
      .send({ sectionKey: "history", data: { idPhase: "1", designInputOutput: "Input: customer spec" } });
    expect(row.status).toBe(201);

    // cleanup — this form isn't the one afterAll tracks
    await db.delete(qmsFormRows).where(eq(qmsFormRows.formId, otherId));
    await db.delete(qmsForms).where(eq(qmsForms.id, otherId));
  });

  it("removes the row", async () => {
    const res = await request(app).delete(`/qms-forms/${formId}/rows/${rowId}`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(204);
    const [gone] = await db.select().from(qmsFormRows).where(eq(qmsFormRows.id, rowId));
    expect(gone).toBeUndefined();
  });

  it("deletes the whole form, cascading any remaining rows, logged before it disappears", async () => {
    await request(app).post(`/qms-forms/${formId}/rows`).set("Authorization", `Bearer ${productionToken}`).send({ sectionKey: "record_register", data: {} });

    const res = await request(app).delete(`/qms-forms/${formId}`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(204);

    const [gone] = await db.select().from(qmsForms).where(eq(qmsForms.id, formId));
    expect(gone).toBeUndefined();
    const remainingRows = await db.select().from(qmsFormRows).where(eq(qmsFormRows.formId, formId));
    expect(remainingRows.length).toBe(0);

    const [row] = await db.select().from(auditTrail).where(eq(auditTrail.action, "delete"));
    expect(row).toBeTruthy();
    formId = 0; // already cleaned up — skip afterAll's own cleanup for this id
  });
});
