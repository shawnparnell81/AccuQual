import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Covers the two things settings-module.test.ts's own ERP Sync section
// doesn't: trigger-rule filtering (an `event` on POST /settings/erp-sync/trigger
// deciding which enabled modules' active preset actually gets mapped this
// run) and the preset cache staying fresh across an activate call — both new
// with erpMappingEngine.ts's evaluateTrigger / erpPresets.service.ts's
// getActivePresetCached.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { erpConnectorPresets } from "../../src/drizzle/schema/erpPresets.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;
let adminToken: string;
const userIds: number[] = [];
const presetIds: number[] = [];

async function makeAdmin() {
  const [user] = await db.insert(users).values({ email: `erp-sync-triggers-${suffix}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "admin", department: null });
}

/** Starts a real local HTTP server standing in for the company's configured webhook — same pattern as settings-module.test.ts's own ERP Sync test. */
async function startWebhookServer() {
  const received: unknown[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      received.push(JSON.parse(raw));
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/sync`, received, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe("ERP Sync trigger filtering + preset cache freshness (real DB + real HTTP path)", () => {
  let webhook: Awaited<ReturnType<typeof startWebhookServer>>;
  let presetAId: number;
  let presetBId: number;

  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    adminToken = await makeAdmin();

    await db.insert(suppliers).values({ name: "Trigger Test Supplier", status: "active" });

    webhook = await startWebhookServer();
    await request(app)
      .post("/settings/erp-sync")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ webhookUrl: webhook.url, modulesEnabled: ["suppliers"], direction: "push" });

    const presetA = await request(app)
      .post("/erp/presets")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        vendor: "sap",
        module: "suppliers",
        name: "Preset A — statusChange only",
        mappingConfig: { fieldMappings: [{ source: "name", target: "NAME1" }], triggers: [{ on: "statusChange", statusValues: ["disqualified"] }], validationRules: [] },
      });
    presetAId = presetA.body.id;
    presetIds.push(presetAId);
    await request(app).post(`/erp/presets/${presetAId}/activate`).set("Authorization", `Bearer ${adminToken}`);
  });

  afterAll(async () => {
    await webhook.close();
    await new Promise((r) => setTimeout(r, 300)); // same fire-and-forget audit-trail race settings-module.test.ts's own afterAll works around
    await pool.end();
  });

  it("no event supplied — syncs unconditionally, same as before triggers existed", async () => {
    webhook.received.length = 0;
    const res = await request(app).post("/settings/erp-sync/trigger").set("Authorization", `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect((webhook.received[0] as { mappedData?: { suppliers?: unknown } }).mappedData?.suppliers).toBeTruthy();
  });

  it("a non-matching event skips the module — no mappedData.suppliers in the delivered payload", async () => {
    webhook.received.length = 0;
    const res = await request(app).post("/settings/erp-sync/trigger").set("Authorization", `Bearer ${adminToken}`).send({ event: "create" });
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect((webhook.received[0] as { mappedData?: { suppliers?: unknown } }).mappedData?.suppliers).toBeUndefined();
  });

  it("a matching statusChange event (with the configured statusValue) includes the module", async () => {
    webhook.received.length = 0;
    const res = await request(app).post("/settings/erp-sync/trigger").set("Authorization", `Bearer ${adminToken}`).send({ event: "statusChange", statusValue: "disqualified" });
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    const delivered = webhook.received[0] as { mappedData?: { suppliers?: { records: { fields: Record<string, unknown> }[] } } };
    expect(delivered.mappedData?.suppliers?.records[0]?.fields.NAME1).toBe("Trigger Test Supplier");
  });

  it("activating a different preset is reflected on the VERY NEXT trigger call — the cache doesn't serve a stale preset", async () => {
    const presetB = await request(app)
      .post("/erp/presets")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ vendor: "netsuite", module: "suppliers", name: "Preset B — no triggers", mappingConfig: { fieldMappings: [{ source: "name", target: "companyname" }], triggers: [], validationRules: [] } });
    presetBId = presetB.body.id;
    presetIds.push(presetBId);
    await request(app).post(`/erp/presets/${presetBId}/activate`).set("Authorization", `Bearer ${adminToken}`);

    webhook.received.length = 0;
    const res = await request(app).post("/settings/erp-sync/trigger").set("Authorization", `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    const delivered = webhook.received[0] as { mappedData?: { suppliers?: { records: { fields: Record<string, unknown> }[] } } };
    // Preset B maps to `companyname`, not `NAME1` — proves the freshly-activated preset, not a cached copy of preset A, was used.
    expect(delivered.mappedData?.suppliers?.records[0]?.fields.companyname).toBe("Trigger Test Supplier");
    expect(delivered.mappedData?.suppliers?.records[0]?.fields.NAME1).toBeUndefined();
  });
});
