// Real-DB test (see services/api/test/integration/tenant-isolation.test.ts's
// header comment on this repo's "real over mocked" convention). Full-System
// Audit finding H6: ai-worker had zero test coverage at all — no regression
// protection for handleJob's own routing (an "embed" job -> embedAndStore,
// anything else logged and dropped) or for embedAndStore's tenant-scoped
// write.
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { handleJob } from "../src/jobHandler.js";
import { db, pool } from "../src/db.js";
import { tenants } from "../../../services/api/src/drizzle/schema/tenants.js";
import { aiEmbeddings } from "../../../services/api/src/drizzle/schema/ai.js";

const suffix = Date.now();
const tenantIds: number[] = [];

async function makeTenant(label: string) {
  const [tenant] = await db.insert(tenants).values({ name: `AI Worker Test ${label} ${suffix}`, code: `ai-worker-${label}-${suffix}-${Math.random().toString(36).slice(2, 7)}` }).returning();
  tenantIds.push(tenant!.id);
  return tenant!.id;
}

describe("ai-worker job handling", () => {
  afterAll(async () => {
    await db.delete(aiEmbeddings).where(inArray(aiEmbeddings.tenantId, tenantIds));
    await db.delete(tenants).where(inArray(tenants.id, tenantIds));
    await pool.end();
  });

  it("a real 'embed' job calls through to embedAndStore and writes a tenant-scoped row", async () => {
    const tenantId = await makeTenant("embed-job");
    await handleJob({ job: "embed", tenantId: String(tenantId), entityType: "NCR", entityId: "42", content: "Fixture defect on line 2" });

    const rows = await db.select().from(aiEmbeddings).where(and(eq(aiEmbeddings.tenantId, tenantId), eq(aiEmbeddings.entityType, "NCR"), eq(aiEmbeddings.entityId, 42)));
    expect(rows.length).toBe(1);
    expect(rows[0]?.content).toBe("Fixture defect on line 2");
  });

  it("a job missing required fields (no content) is dropped, not partially processed", async () => {
    const tenantId = await makeTenant("missing-content");
    await expect(handleJob({ job: "embed", tenantId: String(tenantId), entityType: "NCR", entityId: "1" })).resolves.toBeUndefined();

    const rows = await db.select().from(aiEmbeddings).where(eq(aiEmbeddings.tenantId, tenantId));
    expect(rows.length).toBe(0);
  });

  it("a job type this worker doesn't recognize is logged and dropped, not thrown", async () => {
    const tenantId = await makeTenant("unknown-job");
    await expect(handleJob({ job: "something_else", tenantId: String(tenantId), entityType: "NCR", entityId: "1", content: "x" })).resolves.toBeUndefined();

    const rows = await db.select().from(aiEmbeddings).where(eq(aiEmbeddings.tenantId, tenantId));
    expect(rows.length).toBe(0);
  });

  it("two different tenants' embed jobs land as separate, correctly tenant-scoped rows", async () => {
    const tenantA = await makeTenant("multi-a");
    const tenantB = await makeTenant("multi-b");
    await handleJob({ job: "embed", tenantId: String(tenantA), entityType: "CAPA", entityId: "7", content: "Tenant A content" });
    await handleJob({ job: "embed", tenantId: String(tenantB), entityType: "CAPA", entityId: "7", content: "Tenant B content" });

    const rowsA = await db.select().from(aiEmbeddings).where(eq(aiEmbeddings.tenantId, tenantA));
    const rowsB = await db.select().from(aiEmbeddings).where(eq(aiEmbeddings.tenantId, tenantB));
    expect(rowsA.length).toBe(1);
    expect(rowsB.length).toBe(1);
    expect(rowsA[0]?.content).toBe("Tenant A content");
    expect(rowsB[0]?.content).toBe("Tenant B content");
  });
});
