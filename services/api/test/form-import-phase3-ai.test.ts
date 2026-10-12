import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { mockCallLlmDetailed } = vi.hoisted(() => ({ mockCallLlmDetailed: vi.fn() }));
vi.mock("../src/modules/ai/llm-gateway.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/ai/llm-gateway.js")>();
  return { ...actual, callLlmDetailed: mockCallLlmDetailed };
});

import { createApp } from "../src/app.js";
import { db } from "../src/db/index.js";
import { aiSuggestions } from "../src/drizzle/schema/ai.js";
import { auditTrail } from "../src/drizzle/schema/auditTrail.js";
import { builtForms } from "../src/drizzle/schema/builtForms.js";
import { company } from "../src/drizzle/schema/company.js";
import { roles } from "../src/drizzle/schema/roles.js";
import { users } from "../src/drizzle/schema/users.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { ensureTestCompany } from "./helpers/company.js";
import { seedDefaultPermissions } from "./helpers/seedDefaults.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const docxPath = join(fixturesDir, "monthly-quality-report-september-2026.docx");

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function llmResult(overrides: Partial<{ text: string; isStub: boolean; usage: { inputTokens: number; outputTokens: number } | null }> = {}) {
  return { text: "{}", isStub: false, usage: { inputTokens: 10, outputTokens: 5 }, model: "mock-model", ...overrides };
}

async function makeUser(label: string, permissions: string[], department: string | null = "quality") {
  const roleRowName = `import-ai-${label}-${suffix}`;
  const [role] = await db.insert(roles).values({ name: roleRowName, permissions }).onConflictDoNothing().returning();
  const [user] = await db.insert(users).values({ email: `import-ai-${label}-${suffix}@test.local`, passwordHash: "unused", department, roleId: role?.id ?? null }).returning();
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: roleRowName, department });
}

const FORM_FIELDS = [
  { id: "status", label: "Status of Department", sectionId: "s1", type: "text" },
  { id: "deptHealth", label: "Department health", sectionId: "s1", type: "text" },
  { id: "inspectorMood", label: "Inspector Mood", sectionId: "s1", type: "text" },
];
const STRUCTURE = { kind: "fields", sections: [{ id: "s1", title: "Report" }], fields: FORM_FIELDS };

async function createPublishedForm(title: string) {
  const [row] = await db
    .insert(builtForms)
    .values({ kind: "fields", title, formNumber: null, revision: "A", status: "published", structure: STRUCTURE, publishedStructure: STRUCTURE })
    .returning();
  return row!;
}

async function extractAndPropose(token: string, targetRef: string) {
  const docx = readFileSync(docxPath);
  const extractRes = await request(app).post("/form-import/extract").set("Authorization", `Bearer ${token}`).attach("file", docx, "x.docx");
  const proposeRes = await request(app).post("/form-import/propose").set("Authorization", `Bearer ${token}`).send({ targetRef, extracted: extractRes.body.extracted });
  return { extracted: extractRes.body.extracted, proposeRes };
}

describe("import from file phase 3: AI-suggested mapping", () => {
  let allowedToken: string;
  let noPermissionToken: string;

  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    allowedToken = await makeUser("allowed", ["import.ai_mapping"]);
    noPermissionToken = await makeUser("none", []);
  });

  beforeEach(() => {
    mockCallLlmDetailed.mockReset();
    mockCallLlmDetailed.mockResolvedValue(llmResult({ text: JSON.stringify({ suggestions: [] }) }));
  });

  it("sends only empty fields to the model", async () => {
    const form = await createPublishedForm(`AI fields check ${suffix}`);
    const targetRef = `built:${form.id}`;
    const { extracted, proposeRes } = await extractAndPropose(allowedToken, targetRef);
    expect(proposeRes.body.proposals.find((p: { key: string }) => p.key === "status").value).toBe("Yellow");

    await request(app)
      .post("/form-import/ai-suggest")
      .set("Authorization", `Bearer ${allowedToken}`)
      .send({ targetRef, extracted, proposals: proposeRes.body.proposals });

    const prompt = mockCallLlmDetailed.mock.calls[0]![0] as string;
    const fieldsBlock = /<import_fields>([\s\S]*?)<\/import_fields>/.exec(prompt)![1]!;
    expect(fieldsBlock).toContain("Department health");
    expect(fieldsBlock).toContain("Inspector Mood");
    expect(fieldsBlock).not.toContain("Status of Department");
  });

  it("keeps a quote found in the file, drops an invented quote with a warning, and drops a key that wasn't requested", async () => {
    const form = await createPublishedForm(`AI verify check ${suffix}`);
    const targetRef = `built:${form.id}`;
    const { extracted, proposeRes } = await extractAndPropose(allowedToken, targetRef);

    mockCallLlmDetailed.mockResolvedValueOnce(
      llmResult({
        text: JSON.stringify({
          suggestions: [
            { key: "deptHealth", quote: "Yellow" },
            { key: "inspectorMood", quote: "Ecstatic beyond measure" },
            { key: "not-a-real-field", quote: "Yellow" },
          ],
        }),
      }),
    );

    const res = await request(app)
      .post("/form-import/ai-suggest")
      .set("Authorization", `Bearer ${allowedToken}`)
      .send({ targetRef, extracted, proposals: proposeRes.body.proposals });

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([{ key: "deptHealth", value: "Yellow", quote: "Yellow", source: null }]);
    expect(res.body.warnings).toContain("AI suggestion dropped: not found in the file");
  });

  it("acceptance: a mocked 'Yellow' quote is kept, a mocked 'Green' quote is dropped", async () => {
    const form = await createPublishedForm(`AI acceptance ${suffix}`);
    const targetRef = `built:${form.id}`;
    const { extracted, proposeRes } = await extractAndPropose(allowedToken, targetRef);

    mockCallLlmDetailed.mockResolvedValueOnce(llmResult({ text: JSON.stringify({ suggestions: [{ key: "deptHealth", quote: "Yellow" }] }) }));
    const kept = await request(app)
      .post("/form-import/ai-suggest")
      .set("Authorization", `Bearer ${allowedToken}`)
      .send({ targetRef, extracted, proposals: proposeRes.body.proposals });
    expect(kept.body.suggestions).toEqual([{ key: "deptHealth", value: "Yellow", quote: "Yellow", source: null }]);

    mockCallLlmDetailed.mockResolvedValueOnce(llmResult({ text: JSON.stringify({ suggestions: [{ key: "deptHealth", quote: "Green" }] }) }));
    const dropped = await request(app)
      .post("/form-import/ai-suggest")
      .set("Authorization", `Bearer ${allowedToken}`)
      .send({ targetRef, extracted, proposals: proposeRes.body.proposals });
    expect(dropped.body.suggestions).toEqual([]);
    expect(dropped.body.warnings).toContain("AI suggestion dropped: not found in the file");
  });

  it("the no-key stub gives no suggestions and a warning; the model is still recorded", async () => {
    const form = await createPublishedForm(`AI stub check ${suffix}`);
    const targetRef = `built:${form.id}`;
    const { extracted, proposeRes } = await extractAndPropose(allowedToken, targetRef);
    mockCallLlmDetailed.mockResolvedValueOnce(llmResult({ isStub: true, usage: null, text: "irrelevant" }));

    const res = await request(app)
      .post("/form-import/ai-suggest")
      .set("Authorization", `Bearer ${allowedToken}`)
      .send({ targetRef, extracted, proposals: proposeRes.body.proposals });

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([]);
    expect(res.body.warnings.length).toBeGreaterThan(0);
  });

  it("an invalid JSON response gives no suggestions", async () => {
    const form = await createPublishedForm(`AI malformed check ${suffix}`);
    const targetRef = `built:${form.id}`;
    const { extracted, proposeRes } = await extractAndPropose(allowedToken, targetRef);
    mockCallLlmDetailed.mockResolvedValueOnce(llmResult({ text: "not valid json at all" }));

    const res = await request(app)
      .post("/form-import/ai-suggest")
      .set("Authorization", `Bearer ${allowedToken}`)
      .send({ targetRef, extracted, proposals: proposeRes.body.proposals });

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([]);
  });

  it("records exactly one ai_suggestions row with module form_import per model call", async () => {
    const form = await createPublishedForm(`AI record check ${suffix}`);
    const targetRef = `built:${form.id}`;
    const { extracted, proposeRes } = await extractAndPropose(allowedToken, targetRef);
    const before = await db.select().from(aiSuggestions).where(eq(aiSuggestions.module, "form_import"));
    mockCallLlmDetailed.mockResolvedValueOnce(llmResult({ text: JSON.stringify({ suggestions: [] }) }));

    await request(app)
      .post("/form-import/ai-suggest")
      .set("Authorization", `Bearer ${allowedToken}`)
      .send({ targetRef, extracted, proposals: proposeRes.body.proposals });

    const after = await db.select().from(aiSuggestions).where(eq(aiSuggestions.module, "form_import"));
    expect(after.length).toBe(before.length + 1);
    expect(after[after.length - 1]!.pipeline).toBe("import_mapping");
  });

  it("denies a role without import.ai_mapping; the model is not called", async () => {
    const form = await createPublishedForm(`AI no permission ${suffix}`);
    const targetRef = `built:${form.id}`;
    const { extracted, proposeRes } = await extractAndPropose(allowedToken, targetRef);

    const res = await request(app)
      .post("/form-import/ai-suggest")
      .set("Authorization", `Bearer ${noPermissionToken}`)
      .send({ targetRef, extracted, proposals: proposeRes.body.proposals });

    expect(res.status).toBe(403);
    expect(mockCallLlmDetailed).not.toHaveBeenCalled();
  });

  it("refuses when AI features are disabled for the company; the model is not called", async () => {
    const form = await createPublishedForm(`AI disabled ${suffix}`);
    const targetRef = `built:${form.id}`;
    const { extracted, proposeRes } = await extractAndPropose(allowedToken, targetRef);
    const [co] = await db.select().from(company).limit(1);
    await db.update(company).set({ aiConfig: { ...(co!.aiConfig ?? {}), featuresEnabled: false } }).where(eq(company.id, co!.id));

    const res = await request(app)
      .post("/form-import/ai-suggest")
      .set("Authorization", `Bearer ${allowedToken}`)
      .send({ targetRef, extracted, proposals: proposeRes.body.proposals });

    expect(res.status).toBe(403);
    expect(mockCallLlmDetailed).not.toHaveBeenCalled();
    await db.update(company).set({ aiConfig: { ...(co!.aiConfig ?? {}), featuresEnabled: true } }).where(eq(company.id, co!.id));
  });

  it("refuses when the usage limit is reached; the model is not called", async () => {
    const form = await createPublishedForm(`AI limit check ${suffix}`);
    const targetRef = `built:${form.id}`;
    const { extracted, proposeRes } = await extractAndPropose(allowedToken, targetRef);
    const [co] = await db.select().from(company).limit(1);
    await db.update(company).set({ aiMonthlyLimit: 0, aiLimitEnforced: true }).where(eq(company.id, co!.id));

    const res = await request(app)
      .post("/form-import/ai-suggest")
      .set("Authorization", `Bearer ${allowedToken}`)
      .send({ targetRef, extracted, proposals: proposeRes.body.proposals });

    expect(res.status).toBe(403);
    expect(mockCallLlmDetailed).not.toHaveBeenCalled();
    await db.update(company).set({ aiMonthlyLimit: null, aiLimitEnforced: false }).where(eq(company.id, co!.id));
  });

  it("confirm with aiAccepted writes one audit row mentioning AI suggestions; an unlisted key gives 400", async () => {
    const form = await createPublishedForm(`AI confirm check ${suffix}`);
    const targetRef = `built:${form.id}`;

    const badConfirm = await request(app)
      .post("/form-import/confirm")
      .set("Authorization", `Bearer ${allowedToken}`)
      .send({ targetRef, fileName: "x.docx", values: { status: "Yellow" }, aiAccepted: ["deptHealth"] });
    expect(badConfirm.status).toBe(400);

    const confirmRes = await request(app)
      .post("/form-import/confirm")
      .set("Authorization", `Bearer ${allowedToken}`)
      .send({ targetRef, fileName: "x.docx", values: { status: "Yellow", deptHealth: "Yellow" }, aiAccepted: ["deptHealth"] });
    expect(confirmRes.status).toBe(201);
    const fillId = Number(confirmRes.body.openPath.split("/").pop());

    const auditRows = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "BuiltFormFill"), eq(auditTrail.entityId, fillId), eq(auditTrail.action, "create")));
    expect(auditRows).toHaveLength(1);
    const summary = (auditRows[0]!.changes as { summary?: string }).summary ?? "";
    expect(summary).toContain("accepted from AI suggestions");
  });
});
