import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),

  REDIS_URL: z.string().default("redis://localhost:6379"),
  ELASTICSEARCH_URL: z.string().default("http://localhost:9200"),

  STORAGE_DRIVER: z.enum(["local", "azure"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./uploads"),
  AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
  AZURE_STORAGE_CONTAINER: z.string().default("accuqual-files"),

  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("claude-sonnet-5"),

  // AES-256-GCM key for encrypting a tenant's own stored AI provider API key
  // at rest (see modules/tenant/crypto.ts) — real encryption, not a fictional
  // "external key management service". Must be exactly 32 bytes; generate
  // with `openssl rand -hex 32`. Defaulted only so a fresh dev checkout
  // doesn't hard-fail before anyone has set one — never rely on the default
  // outside local dev.
  TENANT_AI_CONFIG_ENCRYPTION_KEY: z
    .string()
    .length(64, "must be 64 hex chars (32 bytes) — generate with `openssl rand -hex 32`")
    .default("00".repeat(32)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
export type Env = typeof env;
