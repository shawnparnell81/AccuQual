import "dotenv/config";
import { z } from "zod";
import { databaseSslBootProblem } from "../db/ssl.js";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().min(1),
  // PEM CA (or server certificate) used to verify the hosted Postgres TLS
  // certificate. Production refuses to boot when this is missing on a remote
  // database. Development and test still start without it. Empty string counts
  // as unset. See db/ssl.ts and DEPLOY.md.
  DATABASE_SSL_CA: z
    .string()
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value : undefined)),
  // Kept so existing environment files still load. Production now refuses to
  // boot without DATABASE_SSL_CA whether or not this flag is set.
  ACCUQUAL_REQUIRE_DB_SSL_CA: z.enum(["true", "false"]).optional().or(z.literal("").transform(() => undefined)),

  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  JWT_ACCESS_TTL: z.string().default("15m"),
  // No longer the length of a sign-in. The company session length (default 12 hours, Admin → Company Settings) is. The browser cookie ends sooner, when the browser closes. Kept so existing environment files still load.
  JWT_REFRESH_TTL: z.string().default("7d"),
  // No longer used. Kept so existing environment files still load.
  REMEMBER_ME_TTL: z.string().default("30d"),

  // No longer signs anyone out. Kept so existing environment files still load. Idle time does not end a sign-in; the company session length does.
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(1).default(30),
  // This many wrong passwords inside LOGIN_FAILURE_WINDOW_MINUTES lock the account for LOGIN_LOCKOUT_MINUTES.
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).default(5),
  LOGIN_FAILURE_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
  // Rejects passwords found in known breaches via the Have I Been Pwned range API (k-anonymity: only the first 5 hex chars of the SHA-1 leave the server). Fails open if the service is unreachable. Defaults to on, except under test.
  PASSWORD_BREACH_CHECK: z.enum(["true", "false"]).optional(),
  // How long a user whose company policy newly requires MFA may keep signing in before they must enroll.
  MFA_ENROLLMENT_GRACE_DAYS: z.coerce.number().int().min(0).default(7),
  // Public base URL of this API as the browser sees it — where the identity provider sends users back after SSO sign-in (`<this>/auth/sso/callback`). Defaults to FRONTEND_URL + "/api", which is both the compose nginx proxy and the Render static-site rewrite. Leave it unset on that deploy. Set it only when the browser calls the API on its own origin.
  API_PUBLIC_URL: z.string().optional(),

  // In-app Word/Excel editing (docs/onlyoffice.md). All optional: leave them unset and the editor stays off.
  // ONLYOFFICE_URL is the document server as the browser loads it. ONLYOFFICE_INTERNAL_URL is that same server
  // as this API reaches it (often http://onlyoffice on the compose network). ONLYOFFICE_API_BASE_URL is this API
  // as the document server reaches it. The JWT secret must match the document server's JWT_SECRET.
  ONLYOFFICE_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  ONLYOFFICE_INTERNAL_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  ONLYOFFICE_API_BASE_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  ONLYOFFICE_JWT_SECRET: z.string().min(1).optional().or(z.literal("").transform(() => undefined)),

  // No localhost default. Unset (or "") means Redis is not part of this
  // deploy. Filling in redis://localhost:6379 made /health call node-redis
  // against a port nothing listens on, and the client retries that forever.
  REDIS_URL: z.string().min(1).optional().or(z.literal("").transform(() => undefined)),

  STORAGE_DRIVER: z.enum(["local", "azure"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./uploads"),
  // Largest spreadsheet an administrator can import. The file is stored on disk and read in chunks.
  IMPORT_MAX_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
  AZURE_STORAGE_CONTAINER: z.string().default("accuqual-files"),

  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("claude-haiku-4-5-20251001"),

  // AES-256-GCM key for encrypting a company's own stored AI provider API key
  // at rest (see modules/company/crypto.ts) — real encryption, not a fictional
  // "external key management service". Must be exactly 32 bytes; generate
  // with `openssl rand -hex 32`. Defaulted only so a fresh dev checkout
  // doesn't hard-fail before anyone has set one — never rely on the default
  // outside local dev.
  AI_CONFIG_ENCRYPTION_KEY: z
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
  // Sender for BOTH transports. Must be an address on a domain the provider
  // has verified (ZeptoMail: @accuqualqms.com) or delivery is rejected.
  SMTP_FROM: z.string().default("AccuQual <noreply@accuqualqms.com>"),
  // ZeptoMail (agent `qms_transactional`) Send Mail token — env only, never
  // hard-coded. When set, notification.service.ts delivers through
  // ZeptoMail's REST API and ignores SMTP_*; unset falls back to SMTP_*,
  // then to log-only. Accepts the token with or without the
  // "Zoho-enczapikey " prefix ZeptoMail's dashboard shows.
  ZEPTOMAIL_SEND_TOKEN: z.string().optional(),
  // Where the public website contact form delivers. Unset = the form answers "not switched on" instead of pretending to send.
  CONTACT_INBOX_EMAIL: z.string().email().optional(),

  // Real deployment monitoring/alerting — optional, same graceful-degrade
  // pattern as SMTP above. Unset means healthMonitor.ts's in-process poller
  // still runs and still logs a real DB/Redis outage loudly, it just never
  // POSTs anywhere. Any endpoint accepting a Slack-style `{text}` JSON body
  // works — a Slack Incoming Webhook URL, Discord's Slack-compatible
  // `/slack` webhook suffix, or a custom endpoint — see healthMonitor.ts.
  ALERT_WEBHOOK_URL: z.string().optional(),
  // Error tracking (Sentry). Unset = disabled, nothing is sent anywhere. See modules/monitoring/sentry.ts for what is (and is not) sent.
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  // Shown on GET /system-health (Owner/Admin) and attached to error reports so a problem can be tied to a deploy. Set to the git commit in CI/hosting. Public /health does not include it.
  // On Render the deploy's git commit is provided automatically (RENDER_GIT_COMMIT).
  APP_VERSION: z.string().default(process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? process.env.GIT_SHA?.slice(0, 7) ?? "dev"),
  // A URL pinged once a minute while the database is reachable (Healthchecks.io, Better Stack, Uptime Kuma...). When the
  // pings stop — the process died, the host is down — that service alerts you. Unset = off.
  HEARTBEAT_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  // Comma-separated background workers that must keep reporting in ("workflow,ai,digital-twin"). Empty = don't monitor
  // them (right for local dev, and for a deployment that doesn't run the workers).
  MONITOR_EXPECTED_WORKERS: z.string().default(""),

  // Optional Cloudflare Access gate (middleware/cloudflareAccess.ts). Both must
  // be set or the gate stays off, so local, compose, and CI keep working.
  // Team domain is the Zero Trust team host (your-team.cloudflareaccess.com).
  // AUD is the Application Audience tag of the Access app on app.accuqualqms.com.
  CF_ACCESS_TEAM_DOMAIN: z.string().min(1).optional().or(z.literal("").transform(() => undefined)),
  CF_ACCESS_AUD: z.string().min(1).optional().or(z.literal("").transform(() => undefined)),
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
 * encryption at all for every company's stored BYOK API key. Fatal outside
 * development — never let this reach a shared/staging/production
 * environment silently. A loud warning (not fatal) in development/test so
 * local checkouts and CI keep working without anyone having to generate a
 * key just to run the app.
 */
if (env.AI_CONFIG_ENCRYPTION_KEY === DEFAULT_ENCRYPTION_KEY) {
  const message =
    "AI_CONFIG_ENCRYPTION_KEY is still the hardcoded default (00×32) — " +
    "every company's stored AI provider API key would be encrypted with a key anyone reading " +
    "this codebase already knows. Generate a real one with `openssl rand -hex 32`.";
  if (env.NODE_ENV === "production") {
    throw new Error(`❌ Refusing to start in production: ${message}`);
  }
  console.warn(`⚠️  ${message}`);
}

// Production verifies the hosted Postgres certificate. A remote production
// database without DATABASE_SSL_CA refuses to boot. Development and test
// still start, and local hosts never use TLS.
const sslProblem = databaseSslBootProblem({
  nodeEnv: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  caRaw: env.DATABASE_SSL_CA,
  requireCa: env.ACCUQUAL_REQUIRE_DB_SSL_CA === "true",
});
if (sslProblem?.fatal) {
  throw new Error(`❌ ${sslProblem.message}`);
}
if (sslProblem) {
  console.warn(`⚠️  ${sslProblem.message}`);
}
