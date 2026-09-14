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

  // Comma-separated list of allowed frontend origins for CORS — see app.ts.
  // Defaulted to the real local Vite dev server so a fresh checkout still
  // works; never rely on this default outside local dev (see the boot guard
  // below, which only hard-fails on the encryption key, but the same
  // "don't ship the dev default" rule applies here too).
  ALLOWED_ORIGINS: z.string().default("http://localhost:5183"),

  // Used only to build links inside emails (password reset, onboarding) —
  // see modules/auth/auth.service.ts. Same default as ALLOWED_ORIGINS for
  // the same reason.
  FRONTEND_URL: z.string().default("http://localhost:5183"),

  // Real SMTP transport (Inspection Report R06) — all optional. Unset (the
  // default everywhere until someone configures it) means notification.
  // service.ts's logTransport stays active: every "email" is honestly
  // logged, never actually sent, exactly like every other AI/notification
  // feature in this app that has no real credentials configured. Setting
  // all four turns on real delivery via SmtpTransport with no code change
  // anywhere else — see notification.service.ts.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("AccuQual <no-reply@accuqual.local>"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
export type Env = typeof env;

const DEFAULT_ENCRYPTION_KEY = "00".repeat(32);

/**
 * Boot-time guard (Inspection Report SEC-01 / R02): the encryption key
 * defaulting to a well-known, published value is equivalent to no
 * encryption at all for every tenant's stored BYOK API key. Fatal outside
 * development — never let this reach a shared/staging/production
 * environment silently. A loud warning (not fatal) in development/test so
 * local checkouts and CI keep working without anyone having to generate a
 * key just to run the app.
 */
if (env.TENANT_AI_CONFIG_ENCRYPTION_KEY === DEFAULT_ENCRYPTION_KEY) {
  const message =
    "TENANT_AI_CONFIG_ENCRYPTION_KEY is still the hardcoded default (00×32) — " +
    "every tenant's stored AI provider API key would be encrypted with a key anyone reading " +
    "this codebase already knows. Generate a real one with `openssl rand -hex 32`.";
  if (env.NODE_ENV === "production") {
    throw new Error(`❌ Refusing to start in production: ${message}`);
  }
  console.warn(`⚠️  ${message}`);
}
