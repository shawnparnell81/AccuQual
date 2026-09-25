import { and, eq, sql } from "drizzle-orm";
import { aiEmbeddings } from "../../drizzle/schema/ai.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import type { TenantDb } from "../../lib/tenantScope.js";

/**
 * Generates a text embedding and upserts it into the pgvector-backed
 * `ai_embeddings` table so records (NCRs, CAPA actions, audit findings,
 * supplier issues, training materials, documents) can be retrieved by
 * semantic similarity for the AI pipelines below. Always tenant-scoped —
 * per the Multi-Tenant Patch Pack, embeddings and retrieval must never mix
 * data across tenants.
 */
export async function embedAndStore(db: TenantDb, entityType: string, entityId: number, content: string): Promise<void> {
  const embedding = await generateEmbedding(content);
  await db.insert(aiEmbeddings).values({ entityType, entityId, content, embedding });
}

export async function findSimilar(db: TenantDb, entityType: string, content: string, limit = 5) {
  const embedding = await generateEmbedding(content);
  return db
    .select()
    .from(aiEmbeddings)
    .where(and(sql`${aiEmbeddings.entityType} = ${entityType}`))
    .orderBy(sql`${aiEmbeddings.embedding} <-> ${JSON.stringify(embedding)}`)
    .limit(limit);
}

async function generateEmbedding(content: string): Promise<number[]> {
  if (!env.OPENAI_API_KEY) {
    logger.warn("OPENAI_API_KEY not set — using a deterministic pseudo-embedding for development");
    return pseudoEmbedding(content);
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: content }),
  });

  if (!response.ok) throw new Error(`Embedding API error: ${response.status}`);
  const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
  return data.data[0]?.embedding ?? pseudoEmbedding(content);
}

/** Cheap hash-based vector so local dev works without an API key. Not semantically meaningful. */
function pseudoEmbedding(content: string, dimensions = 1536): number[] {
  const vec = new Array(dimensions).fill(0);
  for (let i = 0; i < content.length; i++) {
    vec[i % dimensions] += content.charCodeAt(i) / 255;
  }
  return vec;
}
