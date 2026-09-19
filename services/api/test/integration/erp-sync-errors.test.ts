// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// ERP Sync Error Dashboard: RBAC (admin-only, same gate as erpPresets.routes.ts),
// a real validation failure triggered through POST /settings/erp-sync/trigger
// actually persists an erp_sync_errors row (not just an in-memory value),
// list + filters + pagination, resolve, retry (success auto-resolves with no
// new row; failure leaves the original untouched and adds a new row), and
// tenant isolation.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { erpConnectorPresets } from "../../src/drizzle/schema/erpPresets.js";
import { erpSyncErrors } from "../../src/drizzle/schema/erpSyncErrors.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let tenantAId: number;
let tenantBId: number;
let adminToken: string;
let qualityToken: string;
let tenantBAdminToken: string;
const userIds: number[] = [];
const presetIds: number[] = [];
let supplierId: number;

async function makeUser(tenantId: number, roleName: string, department: string | null = null) {
  const [user] = await db.insert(users).values({ tenantId, email: `erp-sync-errors-${roleName}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName, department });
}

/** Same real local webhook stand-in as erp-sync-triggers.test.ts. */
async function startWebhookServer() {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/sync`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe("ERP Sync Error Dashboard (real DB + real HTTP path)", () => {
  let webhook: Awaited<ReturnType<typeof startWebhookServer>>;
  let presetId: number;

  beforeAll(async () => {
    const [tenantA] = await db.insert(tenants).values({ name: `ERP Sync Errors Tenant A ${suffix}`, code: `erp-sync-errors-a-${suffix}` }).returning();
    const [tenantB] = await db.insert(tenants).values({ name: `ERP Sync Errors Tenant B ${suffix}`, code: `erp-sync-errors-b-${suffix}` }).returning();
    tenantAId = tenantA!.id;
    tenantBId = tenantB!.id;

    adminToken = await makeUser(tenantAId, "admin");
    qualityToken = await makeUser(tenantAId, "operator", "quality");
    tenantBAdminToken = await makeUser(tenantBId, "admin");

    const [supplier] = await db.insert(suppliers).values({ tenantId: tenantAId, name: "Missing Email Supplier", status: "active" }).returning();
    supplierId = supplier!.id;

    webhook = await startWebhookServer();
    await request(app)
      .post("/settings/erp-sync")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ webhookUrl: webhook.url, modulesEnabled: ["suppliers"], direction: "push" });

    const preset = await request(app)
      .post("/erp/presets")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        vendor: "sap",
        module: "suppliers",
        name: "Requires email",
        mappingConfig: { fieldMappings: [{ source: "name", target: "NAME1" }], triggers: [], validationRules: [{ field: "contactEmail", required: true }] },
      });
    presetId = preset.body.id;
    presetIds.push(presetId);
    await request(app).post(`/erp/presets/${presetId}/activate`).set("Authorization", `Bearer ${adminToken}`);
  });

  afterAll(async () => {
    await webhook.close();
    await new Promise((r) => setTimeout(r, 300)); // same fire-and-forget audit-trail race other ERP tests already work around
    await db.delete(auditTrail).where(inArray(auditTrail.performedBy, userIds));
    await db.delete(erpSyncErrors).where(inArray(erpSyncErrors.tenantId, [tenantAId, tenantBId]));
    for (const id of presetIds) await db.delete(erpConnectorPresets).where(eq(erpConnectorPresets.id, id));
    await db.delete(suppliers).where(eq(suppliers.tenantId, tenantAId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantAId));
    await db.delete(tenants).where(eq(tenants.id, tenantBId));
    await pool.end();
  });

  it("a non-admin cannot list, resolve, or retry errors", async () => {
    expect((await request(app).get("/erp/errors").set("Authorization", `Bearer ${qualityToken}`)).status).toBe(403);
    expect((await request(app).post("/erp/errors/1/resolve").set("Authorization", `Bearer ${qualityToken}`)).status).toBe(403);
  });

  it("triggering a sync against a supplier missing a required field persists a REAL erp_sync_errors row, not just an in-memory value", async () => {
    const before = await db.select().from(erpSyncErrors).where(eq(erpSyncErrors.tenantId, tenantAId));
    expect(before).toHaveLength(0);

    const res = await request(app).post("/settings/erp-sync/trigger").set("Authorization", `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(202);

    const after = await db.select().from(erpSyncErrors).where(eq(erpSyncErrors.tenantId, tenantAId));
    expect(after).toHaveLength(1);
    expect(after[0]!.errorType).toBe("validationError");
    expect(after[0]!.module).toBe("suppliers");
    expect(after[0]!.payloadSnapshot?.failedFields[0]?.field).toBe("contactEmail");
  });

  it("GET /erp/errors lists it, filterable by module/errorType/resolved, with pagination metadata", async () => {
    const list = await request(app).get("/erp/errors").set("Authorization", `Bearer ${adminToken}`).query({ module: "suppliers", errorType: "validationError", resolved: "false" });
    expect(list.status).toBe(200);
    expect(list.body.rows).toHaveLength(1);
    expect(list.body.total).toBe(1);

    const wrongType = await request(app).get("/erp/errors").set("Authorization", `Bearer ${adminToken}`).query({ errorType: "erpApiError" });
    expect(wrongType.body.rows).toHaveLength(0);

    const resolvedOnly = await request(app).get("/erp/errors").set("Authorization", `Bearer ${adminToken}`).query({ resolved: "true" });
    expect(resolvedOnly.body.rows).toHaveLength(0);
  });

  it("another tenant cannot see, fetch, resolve, or retry this tenant's error", async () => {
    const [row] = await db.select().from(erpSyncErrors).where(eq(erpSyncErrors.tenantId, tenantAId));
    const list = await request(app).get("/erp/errors").set("Authorization", `Bearer ${tenantBAdminToken}`);
    expect(list.body.rows).toHaveLength(0);
    expect((await request(app).get(`/erp/errors/${row!.id}`).set("Authorization", `Bearer ${tenantBAdminToken}`)).status).toBe(404);
    expect((await request(app).post(`/erp/errors/${row!.id}/resolve`).set("Authorization", `Bearer ${tenantBAdminToken}`)).status).toBe(404);
  });

  it("retrying while the supplier STILL fails validation leaves the original unresolved and adds a NEW row", async () => {
    const [original] = await db.select().from(erpSyncErrors).where(eq(erpSyncErrors.tenantId, tenantAId));
    const retry = await request(app).post(`/erp/errors/${original!.id}/retry`).set("Authorization", `Bearer ${adminToken}`);
    expect(retry.status).toBe(200);
    expect(retry.body.resolved).toBe(false);

    const rows = await db.select().from(erpSyncErrors).where(eq(erpSyncErrors.tenantId, tenantAId));
    expect(rows).toHaveLength(2);
    const stillOriginal = rows.find((r) => r.id === original!.id);
    expect(stillOriginal!.resolvedAt).toBeNull();
  });

  it("fixing the supplier then retrying auto-resolves the error with no additional row", async () => {
    await db.update(suppliers).set({ contactEmail: "supplier@example.com" }).where(eq(suppliers.id, supplierId));

    const rowsBefore = await db.select().from(erpSyncErrors).where(eq(erpSyncErrors.tenantId, tenantAId));
    const target = rowsBefore.find((r) => !r.resolvedAt)!;

    const retry = await request(app).post(`/erp/errors/${target.id}/retry`).set("Authorization", `Bearer ${adminToken}`);
    expect(retry.status).toBe(200);
    expect(retry.body.resolved).toBe(true);
    expect(retry.body.error.resolvedAt).toBeTruthy();

    const rowsAfter = await db.select().from(erpSyncErrors).where(eq(erpSyncErrors.tenantId, tenantAId));
    expect(rowsAfter).toHaveLength(rowsBefore.length); // no new row on a successful retry

    const resolvedList = await request(app).get("/erp/errors").set("Authorization", `Bearer ${adminToken}`).query({ resolved: "true" });
    expect(resolvedList.body.rows.some((r: { id: number }) => r.id === target.id)).toBe(true);
  });

  it("resolving an already-resolved error's retry is rejected", async () => {
    const rows = await db.select().from(erpSyncErrors).where(eq(erpSyncErrors.tenantId, tenantAId));
    const resolved = rows.find((r) => r.resolvedAt)!;
    const retry = await request(app).post(`/erp/errors/${resolved.id}/retry`).set("Authorization", `Bearer ${adminToken}`);
    expect(retry.status).toBe(400);
  });
});
