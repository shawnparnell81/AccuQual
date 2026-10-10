import { ensureTestCompany } from "../helpers/company.js";
// The company AI provider key is ciphertext on company.ai_config. These tests
// lock every other save so it cannot replace that ciphertext, and lock the
// settings read so a key this server cannot decrypt is reported instead of
// looking like it was never saved.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { encryptSecret } from "../../src/modules/company/crypto.js";
import { KEY_UNREADABLE_MESSAGE } from "../../src/modules/company/aiConfigKey.js";

const app = createApp();
const suffix = Date.now();
const PLAIN = "sk-ant-api03-test-key-ABCD";

let companyId: number;
let adminToken: string;
let cipher: string;

function auth() {
  return { Authorization: `Bearer ${adminToken}` };
}

async function storedKey(): Promise<string | undefined> {
  const [row] = await db.select({ aiConfig: company.aiConfig }).from(company).where(eq(company.id, companyId));
  return row?.aiConfig?.apiKeyEncrypted;
}

async function putKey(extra: Record<string, unknown> = {}) {
  cipher = encryptSecret(PLAIN);
  await db
    .update(company)
    .set({
      aiConfig: {
        provider: "anthropic",
        apiKeyEncrypted: cipher,
        modelName: "claude-haiku-4-5",
        apiKeySetAt: "2026-01-15T12:00:00.000Z",
        apiKeySetByName: "Pat Admin",
        ...extra,
      },
      profile: { contactName: "Keep me", timezone: "UTC" },
    })
    .where(eq(company.id, companyId));
}

describe("company AI provider key is not wiped by other saves", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    const [admin] = await db
      .insert(users)
      .values({ email: `ai-key-${suffix}@test.local`, passwordHash: "unused", name: "Pat Admin" })
      .returning();
    adminToken = signAccessToken({ sub: String(admin!.id), roleId: null, roleName: "admin", department: null });
    await putKey();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("GET names the key on file and does not return the key", async () => {
    const res = await request(app).get("/company/ai-config").set(auth());
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.body.keyOnFileLabel).toBe("Key on file (ends in …ABCD), saved by Pat Admin on Jan 15, 2026");
    expect(res.body.hasApiKey).toBe(true);
    expect(res.body.keyStatus).toBe("ready");
    expect(res.body.keySource).toBe("company");
    expect(res.body.featuresEnabled).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(PLAIN);
    expect(JSON.stringify(res.body)).not.toContain(cipher);
  });

  it("Company Settings save leaves the key", async () => {
    const res = await request(app).patch("/company/profile").set(auth()).send({ timezone: "America/Chicago", contactName: "Keep me" });
    expect(res.status).toBe(200);
    expect(await storedKey()).toBe(cipher);
  });

  it("session length spreads profile and leaves the key", async () => {
    const res = await request(app).patch("/company/security").set(auth()).send({ sessionLengthHours: 8 });
    expect(res.status).toBe(200);
    expect(await storedKey()).toBe(cipher);
    const [row] = await db.select({ profile: company.profile }).from(company).where(eq(company.id, companyId));
    expect(row?.profile?.contactName).toBe("Keep me");
    expect(row?.profile?.sessionLengthHours).toBe(8);
  });

  it("moving the login-history start spreads profile and leaves the key", async () => {
    const res = await request(app).patch("/login-history/start").set(auth()).send({ startsAt: "2026-11-01T05:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(await storedKey()).toBe(cipher);
    const [row] = await db.select({ profile: company.profile }).from(company).where(eq(company.id, companyId));
    expect(row?.profile?.loginHistoryStartsAt).toBe("2026-11-01T05:00:00.000Z");
    expect(row?.profile?.contactName).toBe("Keep me");
  });

  it("the sign-in policy save leaves the key", async () => {
    const res = await request(app).patch("/company/security").set(auth()).send({ mfaPolicy: "optional" });
    expect(res.status).toBe(200);
    expect(await storedKey()).toBe(cipher);
  });

  it("branding and onboarding saves leave the key", async () => {
    expect((await request(app).patch("/company/branding").set(auth()).send({ pdfHeader: "Hello" })).status).toBe(200);
    expect((await request(app).patch("/company/onboarding").set(auth()).send({ dismissed: true })).status).toBe(200);
    expect(await storedKey()).toBe(cipher);
  });

  it.each(["", "   ", "••••ABCD", "[redacted]", "Leave blank to keep the current key"])(
    "AI settings save with apiKey %j does not replace the stored key",
    async (apiKey) => {
      await putKey();
      const res = await request(app).patch("/company/ai-config").set(auth()).send({ apiKey, assistantName: "Acu", safetyMode: "strict" });
      expect(res.status).toBe(200);
      expect(await storedKey()).toBe(cipher);
      expect(res.body.assistantName).toBe("Acu");
      expect(res.body.safetyMode).toBe("strict");
      expect(res.body.keyOnFileLabel).toBe("Key on file (ends in …ABCD), saved by Pat Admin on Jan 15, 2026");
    },
  );

  it("turning AI features off leaves the key", async () => {
    await putKey({ featuresEnabled: true });
    const res = await request(app).patch("/company/ai-config").set(auth()).send({ featuresEnabled: false, apiKey: "••••ABCD" });
    expect(res.status).toBe(200);
    expect(res.body.featuresEnabled).toBe(false);
    expect(await storedKey()).toBe(cipher);
    expect(res.body.keyOnFileLabel).toBe("Key on file (ends in …ABCD), saved by Pat Admin on Jan 15, 2026");
  });

  it("changing the limit and the model leaves the key", async () => {
    const res = await request(app).patch("/company/ai-config").set(auth()).send({ modelName: "claude-haiku-4-5", monthlyLimit: 1000, limitEnforced: true });
    expect(res.status).toBe(200);
    expect(await storedKey()).toBe(cipher);
    expect(res.body.monthlyLimit).toBe(1000);
    expect(res.body.limitEnforced).toBe(true);
  });

  it("a provider key the provider rejects does not replace the stored key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 401 }));
    const res = await request(app).patch("/company/ai-config").set(auth()).send({ apiKey: "sk-ant-rejected-key-ZZZZ" });
    expect(res.status).toBe(400);
    expect(await storedKey()).toBe(cipher);
  });

  it("a new key replaces it, and the audit row does not contain the key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
    const next = "sk-ant-api03-replaced-WXYZ";
    const res = await request(app).patch("/company/ai-config").set(auth()).send({ apiKey: next });
    expect(res.status).toBe(200);
    const now = await storedKey();
    expect(now).toBeTruthy();
    expect(now).not.toBe(cipher);
    expect(res.body.keyOnFileLabel).toMatch(/^Key on file \(ends in …WXYZ\), saved by Pat Admin on /);
    const entries = await db.select().from(auditTrail).where(eq(auditTrail.entityType, "Company"));
    const setRow = entries.find((entry) => (entry.changes as { action?: string } | null)?.action === "ai_api_key_set");
    expect(setRow).toBeTruthy();
    const logged = JSON.stringify(setRow?.changes);
    expect(logged).not.toContain(next);
    expect(logged).not.toContain(now);
    expect(logged).not.toContain(PLAIN);
  });

  it("only Remove key clears it, and the audit row does not contain the key", async () => {
    await putKey();
    const res = await request(app).patch("/company/ai-config").set(auth()).send({ removeApiKey: true });
    expect(res.status).toBe(200);
    expect(res.body.hasApiKey).toBe(false);
    expect(res.body.keyOnFileLabel).toBeNull();
    expect(await storedKey()).toBeUndefined();
    const entries = await db.select().from(auditTrail).where(eq(auditTrail.entityType, "Company"));
    const removed = entries.find((entry) => (entry.changes as { action?: string } | null)?.action === "ai_api_key_removed");
    expect(removed).toBeTruthy();
    expect(JSON.stringify(removed?.changes)).not.toContain(PLAIN);
    expect(JSON.stringify(removed?.changes)).not.toContain(cipher);
  });

  it("a key this server cannot read is reported, and a later settings save still keeps the ciphertext", async () => {
    await db
      .update(company)
      .set({ aiConfig: { provider: "anthropic", apiKeyEncrypted: "aa:bb:cc", modelName: "claude-haiku-4-5" } })
      .where(eq(company.id, companyId));
    const res = await request(app).get("/company/ai-config").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.hasApiKey).toBe(true);
    expect(res.body.keyStatus).toBe("unreadable");
    expect(res.body.keyError).toBe(KEY_UNREADABLE_MESSAGE);
    expect(res.body.keyOnFileLabel).toBeNull();
    expect(res.body.maskedApiKey).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("aa:bb:cc");

    const saved = await request(app).patch("/company/ai-config").set(auth()).send({ assistantName: "Still here", apiKey: "" });
    expect(saved.status).toBe(200);
    expect(saved.body.keyError).toBe(KEY_UNREADABLE_MESSAGE);
    expect(saved.body.assistantName).toBe("Still here");
    expect(await storedKey()).toBe("aa:bb:cc");
  });
});
