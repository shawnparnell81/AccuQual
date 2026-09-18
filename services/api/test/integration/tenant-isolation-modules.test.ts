// Real-DB integration test — same real-HTTP-path RLS shape as
// tenant-isolation.test.ts (Inspection Report R08), extended to a
// representative sample of modules beyond NCR. That original file only
// ever proved the RLS role-switch (see src/lib/tenantScope.ts) works for
// one module's controller; a genuine cross-tenant leak in a DIFFERENT
// controller (a forgotten `req.db!` scope, a raw `db` import bypassing the
// tenant transaction, a crudFactory misconfiguration) would have gone
// completely uncaught. Covers 9 modules chosen to span this app's real
// architectural variety: capa/audits (plain crudFactory + PATCH),
// risk (bespoke controller, PUT not PATCH), documents (Sprint 1's newly
// RBAC-gated router), suppliers (no generic PATCH at all — a bespoke
// POST action endpoint instead), inventory items (a nested /items path),
// training/change (Full-System Audit C1/C2 — both newly RBAC-gated after
// having no department gate at all), calibration (like suppliers, no
// generic PATCH — the real cross-tenant write surface is its bespoke
// POST /:id/calibration sub-resource; H4/H8's own review of this module
// also confirmed there is still no way to edit equipment itself at all,
// a real gap, not something this test works around).
//
// Uses the exact same admin-role-bypasses-department-RBAC convention as
// tenant-isolation.test.ts — this file tests ONLY tenant scoping, never
// department gating (that's permissions.test.ts's/permissions-module.test.ts's
// job).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { capa } from "../../src/drizzle/schema/capa.js";
import { audits } from "../../src/drizzle/schema/audits.js";
import { riskAssessments } from "../../src/drizzle/schema/risk.js";
import { documents } from "../../src/drizzle/schema/documents.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { inventoryItems, inventoryAlerts } from "../../src/drizzle/schema/inventory.js";
import { trainingCourses } from "../../src/drizzle/schema/training.js";
import { changeRequests } from "../../src/drizzle/schema/change.js";
import { equipment, calibrations } from "../../src/drizzle/schema/calibration.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

interface TenantIsolationCase {
  name: string;
  basePath: string;
  createPayload: Record<string, unknown>;
  mutate: { method: "patch" | "put" | "post"; pathSuffix: string; payload: Record<string, unknown> };
  unchangedField: string;
  unchangedValue: unknown;
}

const cases: TenantIsolationCase[] = [
  {
    name: "CAPA",
    basePath: "/capa",
    createPayload: { rootCause: "Tenant A's own root cause text" },
    mutate: { method: "patch", pathSuffix: "", payload: { rootCause: "HACKED" } },
    unchangedField: "rootCause",
    unchangedValue: "Tenant A's own root cause text",
  },
  {
    name: "Audit",
    basePath: "/audits",
    createPayload: { name: "Tenant A Audit" },
    mutate: { method: "patch", pathSuffix: "", payload: { name: "HACKED" } },
    unchangedField: "name",
    unchangedValue: "Tenant A Audit",
  },
  {
    name: "Risk",
    basePath: "/risk",
    createPayload: { title: "Tenant A Risk" },
    mutate: { method: "put", pathSuffix: "", payload: { title: "HACKED" } },
    unchangedField: "title",
    unchangedValue: "Tenant A Risk",
  },
  {
    name: "Document",
    basePath: "/documents",
    createPayload: { title: "Tenant A Document" },
    mutate: { method: "patch", pathSuffix: "", payload: { title: "HACKED" } },
    unchangedField: "title",
    unchangedValue: "Tenant A Document",
  },
  {
    name: "Supplier",
    // No generic PATCH exists on this router at all — real cross-tenant
    // write attempt uses one of its bespoke action endpoints instead.
    basePath: "/suppliers",
    createPayload: { name: "Tenant A Supplier" },
    mutate: { method: "post", pathSuffix: "/suspend", payload: {} },
    unchangedField: "name",
    unchangedValue: "Tenant A Supplier",
  },
  {
    name: "Inventory Item",
    basePath: "/inventory/items",
    createPayload: { sku: `TENANT-A-SKU-${suffix}`, description: "Original description" },
    mutate: { method: "patch", pathSuffix: "", payload: { description: "HACKED" } },
    unchangedField: "description",
    unchangedValue: "Original description",
  },
  {
    name: "Training Course",
    basePath: "/training",
    createPayload: { title: "Tenant A Course" },
    mutate: { method: "patch", pathSuffix: "", payload: { title: "HACKED" } },
    unchangedField: "title",
    unchangedValue: "Tenant A Course",
  },
  {
    name: "Change Request",
    basePath: "/change",
    createPayload: { title: "Tenant A Change" },
    mutate: { method: "patch", pathSuffix: "", payload: { title: "HACKED" } },
    unchangedField: "title",
    unchangedValue: "Tenant A Change",
  },
  {
    name: "Calibration Equipment",
    // No generic PATCH exists on this router at all (same real gap as
    // Suppliers above) — the cross-tenant write attempt uses the one real
    // mutate action, adding a calibration event to tenant A's equipment.
    basePath: "/equipment",
    createPayload: { name: "Tenant A Gauge", calibrationIntervalDays: 90 },
    mutate: { method: "post", pathSuffix: "/calibration", payload: { performedAt: new Date().toISOString(), result: "pass" } },
    unchangedField: "name",
    unchangedValue: "Tenant A Gauge",
  },
];

let tenantAId: number;
let tenantBId: number;
let userAId: number;
let userBId: number;
let tokenA: string;
let tokenB: string;
const createdIds = new Map<string, number>();

describe("tenant isolation across modules (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenantA] = await db.insert(tenants).values({ name: `Module RLS Test Tenant A ${suffix}`, code: `mod-rls-a-${suffix}` }).returning();
    const [tenantB] = await db.insert(tenants).values({ name: `Module RLS Test Tenant B ${suffix}`, code: `mod-rls-b-${suffix}` }).returning();
    tenantAId = tenantA!.id;
    tenantBId = tenantB!.id;
    await seedDefaultPermissions(tenantAId);
    await seedDefaultPermissions(tenantBId);

    const [userA] = await db.insert(users).values({ tenantId: tenantAId, email: `mod-rls-a-${suffix}@test.local`, passwordHash: "unused" }).returning();
    const [userB] = await db.insert(users).values({ tenantId: tenantBId, email: `mod-rls-b-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userAId = userA!.id;
    userBId = userB!.id;

    tokenA = signAccessToken({ sub: String(userAId), tenantId: tenantAId, roleId: null, roleName: "admin", department: null });
    tokenB = signAccessToken({ sub: String(userBId), tenantId: tenantBId, roleId: null, roleName: "admin", department: null });

    for (const c of cases) {
      const res = await request(app).post(c.basePath).set("Authorization", `Bearer ${tokenA}`).send(c.createPayload);
      expect(res.status, `${c.name} create should succeed`).toBeLessThan(300);
      createdIds.set(c.name, res.body.id);
    }
  });

  afterAll(async () => {
    // Same grace period as tenant-isolation.test.ts's own afterAll — this
    // file's cross-tenant 404s go through the same fire-and-forget
    // logFailedTransition path.
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(inArray(auditTrail.tenantId, [tenantAId, tenantBId]));
    await db.delete(capa).where(eq(capa.id, createdIds.get("CAPA")!));
    await db.delete(audits).where(eq(audits.id, createdIds.get("Audit")!));
    await db.delete(riskAssessments).where(eq(riskAssessments.id, createdIds.get("Risk")!));
    await db.delete(documents).where(eq(documents.id, createdIds.get("Document")!));
    await db.delete(suppliers).where(eq(suppliers.id, createdIds.get("Supplier")!));
    // A fresh item can trigger a real "below_min" alert (see
    // inventory.controller.ts's create path) — must go before the item
    // itself, or the FK from inventory_alerts blocks this delete.
    await db.delete(inventoryAlerts).where(eq(inventoryAlerts.itemId, createdIds.get("Inventory Item")!));
    await db.delete(inventoryItems).where(eq(inventoryItems.id, createdIds.get("Inventory Item")!));
    await db.delete(trainingCourses).where(eq(trainingCourses.id, createdIds.get("Training Course")!));
    await db.delete(changeRequests).where(eq(changeRequests.id, createdIds.get("Change Request")!));
    // The successful "tenant A can add its own calibration event" (create,
    // via seeding above) plus this suite's own cross-tenant attempt both go
    // through the real /:id/calibration insert — clear its child rows
    // before the equipment FK they point at is deleted.
    await db.delete(calibrations).where(eq(calibrations.equipmentId, createdIds.get("Calibration Equipment")!));
    await db.delete(equipment).where(eq(equipment.id, createdIds.get("Calibration Equipment")!));
    await db.delete(departmentPermissions).where(inArray(departmentPermissions.tenantId, [tenantAId, tenantBId]));
    await db.delete(users).where(inArray(users.id, [userAId, userBId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
    await pool.end();
  });

  for (const c of cases) {
    describe(c.name, () => {
      it("tenant B's list never includes tenant A's record", async () => {
        const res = await request(app).get(c.basePath).set("Authorization", `Bearer ${tokenB}`);
        expect(res.status).toBe(200);
        const list = Array.isArray(res.body) ? res.body : res.body.items;
        expect(list.find((r: { id: number }) => r.id === createdIds.get(c.name))).toBeUndefined();
      });

      it("tenant B cannot fetch tenant A's record by id — 404, not a leak", async () => {
        const res = await request(app).get(`${c.basePath}/${createdIds.get(c.name)}`).set("Authorization", `Bearer ${tokenB}`);
        expect(res.status).toBe(404);
      });

      it("tenant B cannot mutate tenant A's record", async () => {
        const url = `${c.basePath}/${createdIds.get(c.name)}${c.mutate.pathSuffix}`;
        const req = request(app)[c.mutate.method](url).set("Authorization", `Bearer ${tokenB}`);
        const res = await req.send(c.mutate.payload);
        expect(res.status).toBe(404);

        // Re-fetch under tenant A's OWN token to prove the field genuinely
        // never changed — not just that the response we saw said 404.
        const check = await request(app).get(`${c.basePath}/${createdIds.get(c.name)}`).set("Authorization", `Bearer ${tokenA}`);
        expect(check.status).toBe(200);
        expect(check.body[c.unchangedField]).toBe(c.unchangedValue);
      });
    });
  }
});
