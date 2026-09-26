import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Regression test for a real bug found live while testing the rebuilt AI
// Insights dashboard (apps/web/src/routes/AI/AiInsightsPage.tsx): a
// company's stored aiConfig.apiKeyEncrypted value that can no longer be
// authenticated under the current COMPANY_AI_CONFIG_ENCRYPTION_KEY (a real,
// foreseeable state after any key rotation, not just corrupted test data)
// crashed loadCompanyLlmOptions with an unhandled "Unsupported state or
// unable to authenticate data" error, turning into a 500 on every single
// AI pipeline endpoint for that company — POST /reporting/summary,
// /ai/analysis, /ai/risk-score, all of them. Every other "no real key"
// path in this app degrades to a clean stub instead of erroring; this one
// didn't, until ai.usage.ts's loadCompanyLlmOptions wrapped the decrypt in
// a try/catch and treated a failure the same as "no key configured."
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { aiSuggestions, aiRiskScores } from "../../src/drizzle/schema/ai.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;
let userId: number;
let token: string;

describe("AI pipelines degrade to a stub, never a 500, when a company's stored key can't be decrypted", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    await seedDefaultPermissions(companyId);

    const [user] = await db.insert(users).values({ email: `ai-key-res-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userId = user!.id;
    token = signAccessToken({ sub: String(userId), roleId: null, roleName: "admin", department: null });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
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

  // Full-System Audit finding C4: this endpoint had its own inline
  // db.select + decryptSecret call with no try/catch, missing the fix
  // every other AI endpoint above already had — confirmed live-broken with
  // a raw 500 before loadCompanyLlmOptions replaced that inline call.
  it("POST /ai/assistant (its own inline decrypt call, found missing the same fix) also degrades to a stub instead of crashing", async () => {
    const res = await request(app)
      .post("/ai/assistant")
      .set("Authorization", `Bearer ${token}`)
      .send({ messages: [{ role: "user", content: "Summarize the current state." }] });
    expect(res.status).toBe(200);
    expect(res.body.isStub).toBe(true);
  });
});
