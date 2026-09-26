import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// ERP Connector Presets: RBAC (requireRole("admin"), mirroring ErpSyncSettings'
// own gate — see erpPresets.routes.ts's own comment), full CRUD, version
// bump only on a real mappingConfig change, activation deactivating any
// prior active preset for that module, and company isolation (global presets
// visible to everyone, another company's own presets invisible).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { erpConnectorPresets } from "../../src/drizzle/schema/erpPresets.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let companyAId: number;

const userIds: number[] = [];
const presetIds: number[] = [];

let adminToken: string;
let qualityToken: string;


async function makeUser(companyId: number, roleName: string, department: string | null = null) {
  const [user] = await db.insert(users).values({ email: `erp-presets-${roleName}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department });
}

describe("ERP Connector Presets (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const companyA = await ensureTestCompany();
    
    companyAId = companyA!.id;
    

    adminToken = await makeUser(companyAId, "admin");
    qualityToken = await makeUser(companyAId, "operator", "quality");
    
  });

  afterAll(async () => {
    // The global error handler logs a "transition_failed" audit-trail row
    // for a caught AppError via recordAuditTrailStandalone (outside this
    // test's own request transactions, fire-and-forget) — same real race
    // settings-module.test.ts's own afterAll already works around.
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("a non-admin cannot list, create, or activate presets", async () => {
    expect((await request(app).get("/erp/presets").set("Authorization", `Bearer ${qualityToken}`)).status).toBe(403);
    expect((await request(app).post("/erp/presets").set("Authorization", `Bearer ${qualityToken}`).send({ vendor: "sap", module: "suppliers", name: "x" })).status).toBe(403);
  });

  it("rejects a validation rule pattern with a catastrophic-backtracking shape, but accepts an ordinary one", async () => {
    const evil = await request(app)
      .post("/erp/presets")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ vendor: "sap", module: "suppliers", name: "Evil pattern", mappingConfig: { fieldMappings: [], triggers: [], validationRules: [{ field: "code", pattern: "^(a+)+$" }] } });
    expect(evil.status).toBe(400);

    const fine = await request(app)
      .post("/erp/presets")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ vendor: "sap", module: "suppliers", name: "Ordinary pattern", mappingConfig: { fieldMappings: [], triggers: [], validationRules: [{ field: "code", pattern: "^[A-Z]{2}\\d{4}$" }] } });
    expect(fine.status).toBe(201);
    presetIds.push(fine.body.id);
  });

  it("admin creates a preset, company-scoped, version 1, empty history", async () => {
    const res = await request(app)
      .post("/erp/presets")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ vendor: "sap", module: "suppliers", name: "Test SAP Preset", direction: "push", mappingConfig: { fieldMappings: [{ source: "name", target: "NAME1" }], triggers: [], validationRules: [] } });
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(1);
    expect(res.body.versionHistory).toEqual([]);
    presetIds.push(res.body.id);

    const [row] = await db.select().from(auditTrail).where(eq(auditTrail.entityType, "ErpConnectorPreset"));
    expect(row).toBeTruthy();
  });

  it("updating the mappingConfig bumps version and records the PRIOR config in history; a metadata-only update does not", async () => {
    const create = await request(app)
      .post("/erp/presets")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ vendor: "netsuite", module: "purchaseOrders", name: "Versioned Preset", mappingConfig: { fieldMappings: [{ source: "a", target: "b" }], triggers: [], validationRules: [] } });
    const id = create.body.id;
    presetIds.push(id);

    const renameOnly = await request(app).put(`/erp/presets/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ description: "just a description change" });
    expect(renameOnly.body.version).toBe(1);

    const realChange = await request(app)
      .put(`/erp/presets/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mappingConfig: { fieldMappings: [{ source: "a", target: "c" }], triggers: [], validationRules: [] } });
    expect(realChange.body.version).toBe(2);
    expect(realChange.body.versionHistory).toHaveLength(1);
    expect(realChange.body.versionHistory[0].version).toBe(1);
    expect(realChange.body.versionHistory[0].mappingConfig.fieldMappings[0].target).toBe("b");
  });

  it("activating a preset deactivates whatever was previously active for that same module", async () => {
    const first = await request(app).post("/erp/presets").set("Authorization", `Bearer ${adminToken}`).send({ vendor: "sap", module: "workOrders", name: "First" });
    const second = await request(app).post("/erp/presets").set("Authorization", `Bearer ${adminToken}`).send({ vendor: "oracle", module: "workOrders", name: "Second" });
    presetIds.push(first.body.id, second.body.id);

    await request(app).post(`/erp/presets/${first.body.id}/activate`).set("Authorization", `Bearer ${adminToken}`);
    let active = await request(app).get("/erp/active-preset/workOrders").set("Authorization", `Bearer ${adminToken}`);
    expect(active.body.id).toBe(first.body.id);

    await request(app).post(`/erp/presets/${second.body.id}/activate`).set("Authorization", `Bearer ${adminToken}`);
    active = await request(app).get("/erp/active-preset/workOrders").set("Authorization", `Bearer ${adminToken}`);
    expect(active.body.id).toBe(second.body.id);

    const firstNow = await request(app).get(`/erp/presets/${first.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(firstNow.body.isActive).toBe(false);
  });

  it("soft-deleting a preset removes it from the list and 404s a subsequent get", async () => {
    const created = await request(app).post("/erp/presets").set("Authorization", `Bearer ${adminToken}`).send({ vendor: "epicor", module: "inventory", name: "To delete" });
    presetIds.push(created.body.id);

    const del = await request(app).delete(`/erp/presets/${created.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(204);

    const get = await request(app).get(`/erp/presets/${created.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(get.status).toBe(404);
  });

  ;
});
