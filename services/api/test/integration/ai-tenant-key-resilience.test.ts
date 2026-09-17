// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Regression test for a real bug found live while testing the rebuilt AI
// Insights dashboard (apps/web/src/routes/AI/AiInsightsPage.tsx): a
// tenant's stored aiConfig.apiKeyEncrypted value that can no longer be
// authenticated under the current TENANT_AI_CONFIG_ENCRYPTION_KEY (a real,
// foreseeable state after any key rotation, not just corrupted test data)
// crashed loadTenantLlmOptions with an unhandled "Unsupported state or
// unable to authenticate data" error, turning into a 500 on every single
// AI pipeline endpoint for that tenant — POST /reporting/summary,
// /ai/analysis, /ai/risk-score, all of them. Every other "no real key"
// path in this app degrades to a clean stub instead of erroring; this one
// didn't, until ai.usage.ts's loadTenantLlmOptions wrapped the decrypt in
// a try/catch and treated a failure the same as "no key configured."
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { aiSuggestions, aiRiskScores } from "../../src/drizzle/schema/ai.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let userId: number;
let token: string;

describe("AI pipelines degrade to a stub, never a 500, when a tenant's stored key can't be decrypted", () => {
  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: `AI Key Resilience Test Tenant ${suffix}`,
        code: `ai-key-res-${suffix}`,
        // A well-formed iv:authTag:ciphertext shape (so decryptSecret gets
        // past its own "Malformed encrypted value" check) whose authTag
        // can never validate against anything — the exact live-reproduced
        // failure mode: authentication fails inside Decipheriv.final, not
        // a shape/parsing error.
        aiConfig: { provider: "anthropic", apiKeyEncrypted: `${"11".repeat(12)}:${"22".repeat(16)}:${"33".repeat(20)}` },
      })
      .returning();
    tenantId = tenant!.id;
    await seedDefaultPermissions(tenantId);

    const [user] = await db.insert(users).values({ tenantId, email: `ai-key-res-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userId = user!.id;
    token = signAccessToken({ sub: String(userId), tenantId, roleId: null, roleName: "admin", department: null });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(aiSuggestions).where(eq(aiSuggestions.tenantId, tenantId));
    await db.delete(aiRiskScores).where(eq(aiRiskScores.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("POST /reporting/summary returns a clean stub response, not a 500", async () => {
    const res = await request(app).post("/reporting/summary").set("Authorization", `Bearer ${token}`).send({ kind: "quality_trends" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("stub");
  });

  it("POST /ai/risk-score also degrades to a stub instead of crashing", async () => {
    const res = await request(app)
      .post("/ai/risk-score")
      .set("Authorization", `Bearer ${token}`)
      .send({ entityType: "supplier", input: { ncrCount: 1 } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("stub");
  });
});
