import { ensureTestCompany } from "../../../services/api/test/helpers/company.js";
// Real-DB test. Full-System
// Audit finding H6: ai-worker had zero test coverage at all — no regression
// protection for handleJob's own routing (an "embed" job -> embedAndStore,
// anything else logged and dropped) or for embedAndStore's write.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { handleJob } from "../src/jobHandler.js";
import { db, pool } from "../src/db.js";
import { aiEmbeddings } from "../../../services/api/src/drizzle/schema/ai.js";

async function makeCompany() {
  const co = await ensureTestCompany();
  return co.id;
}

describe("ai-worker job handling", () => {
  beforeEach(async () => {
    await makeCompany();
    await db.delete(aiEmbeddings);
  });

  afterAll(async () => {
    await db.delete(aiEmbeddings);
    await pool.end();
  });

  it("a real 'embed' job calls through to embedAndStore and writes a row", async () => {
    await handleJob({ job: "embed", entityType: "NCR", entityId: "42", content: "Fixture defect on line 2" });

    const rows = await db.select().from(aiEmbeddings).where(and(eq(aiEmbeddings.entityType, "NCR"), eq(aiEmbeddings.entityId, 42)));
    expect(rows.length).toBe(1);
    expect(rows[0]?.content).toBe("Fixture defect on line 2");
  });

  it("a job missing required fields (no content) is dropped, not partially processed", async () => {
    await expect(handleJob({ job: "embed", entityType: "NCR", entityId: "1" })).resolves.toBeUndefined();

    const rows = await db.select().from(aiEmbeddings);
    expect(rows.length).toBe(0);
  });

  it("a job type this worker doesn't recognize is logged and dropped, not thrown", async () => {
    await expect(handleJob({ job: "something_else", entityType: "NCR", entityId: "1", content: "x" })).resolves.toBeUndefined();

    const rows = await db.select().from(aiEmbeddings);
    expect(rows.length).toBe(0);
  });

  it("embed jobs for different records land as separate rows", async () => {
    await handleJob({ job: "embed", entityType: "CAPA", entityId: "7", content: "First record content" });
    await handleJob({ job: "embed", entityType: "CAPA", entityId: "8", content: "Second record content" });

    const rows = await db.select().from(aiEmbeddings);
    expect(rows.map((r) => r.content).sort()).toEqual(["First record content", "Second record content"]);
  });
});
