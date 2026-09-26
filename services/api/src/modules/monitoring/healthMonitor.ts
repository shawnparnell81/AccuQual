import { pool } from "../../db/index.js";
import { env } from "../../config/env.js";
import { configuredRedisUrl, createBoundedRedisClient, DEPENDENCY_TIMEOUT_MS, disconnectQuiet, withTimeout } from "../../lib/redisConnect.js";
import { logger } from "../../utils/logger.js";
import { monitorTick, resetAlertState } from "./alerts.js";

export type DependencyStatus = "ok" | "critical" | "not configured";

export interface DependencyCheck {
  status: DependencyStatus;
  latencyMs: number;
  detail: string;
}

export interface ReadinessReport {
  /**
   * Driven by `database` ONLY — the one dependency this app's real
   * deployment (render.yaml/DEPLOY.md) confirms is always provisioned
   * (Supabase). `render.yaml` defines no managed Redis service today, so
   * treating an unreachable Redis as a hard failure here would make
   * Render's own `healthCheckPath` fail (and restart-loop) an otherwise
   * healthy app in any environment where Redis genuinely isn't deployed —
   * exactly the class of self-inflicted outage this endpoint must never
   * cause. `redis` is still reported below for real visibility (a
   * genuinely down event bus does degrade the Workflow Engine — see
   * eventBus.ts's own publishEvent, which already catches and logs rather
   * than throwing), it just doesn't flip the overall status.
   */
  status: DependencyStatus;
  database: DependencyCheck;
  redis: DependencyCheck;
  checkedAt: string;
}

async function pingDatabase(): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    await withTimeout(pool.query("SELECT 1"), DEPENDENCY_TIMEOUT_MS, "Database");
    return { status: "ok", latencyMs: Date.now() - start, detail: "Reachable" };
  } catch (err) {
    return { status: "critical", latencyMs: Date.now() - start, detail: `Unreachable: ${(err as Error).message}` };
  }
}

/**
 * Tests only. `null` probes as if REDIS_URL were unset. A string is used
 * instead of the env value, so a suite can point at a closed port without
 * stopping the Redis CI actually uses.
 */
let redisUrlOverride: string | null | undefined;
let redisUrlOverrideActive = false;

export function setRedisUrlOverrideForTests(url: string | null): void {
  redisUrlOverrideActive = true;
  redisUrlOverride = url;
}

export function clearRedisUrlOverrideForTests(): void {
  redisUrlOverrideActive = false;
  redisUrlOverride = undefined;
}

function redisUrlForProbe(): string | undefined {
  if (redisUrlOverrideActive) return redisUrlOverride ?? undefined;
  return configuredRedisUrl();
}

/**
 * A short-lived, dedicated connection for this one ping — deliberately NOT
 * lib/eventBus.ts's shared, lazily-connected singleton client, so a Redis
 * outage here can never be confused with, or itself disrupt, that separate,
 * longer-lived publish path.
 *
 * node-redis retries forever unless `reconnectStrategy` is false, and
 * `connectTimeout` only bounds one attempt — `connect()` itself never
 * rejects while those retries run. That is what hung Render's GET /health.
 * The strategy is off, and the whole probe is raced against a 3s timeout.
 */
async function pingRedis(): Promise<DependencyCheck> {
  const url = redisUrlForProbe();
  if (!url) {
    return { status: "not configured", latencyMs: 0, detail: "not configured" };
  }
  const start = Date.now();
  const client = createBoundedRedisClient(url);
  client.on("error", () => undefined); // surfaced via the catch below, not this handler
  try {
    await withTimeout(
      (async () => {
        await client.connect();
        await client.ping();
      })(),
      DEPENDENCY_TIMEOUT_MS,
      "Redis"
    );
    return { status: "ok", latencyMs: Date.now() - start, detail: "Reachable" };
  } catch (err) {
    return { status: "critical", latencyMs: Date.now() - start, detail: `Unreachable: ${(err as Error).message}` };
  } finally {
    await disconnectQuiet(client);
  }
}

export async function checkReadiness(): Promise<ReadinessReport> {
  const [database, redis] = await Promise.all([pingDatabase(), pingRedis()]);
  return { status: database.status, database, redis, checkedAt: new Date().toISOString() };
}

/**
 * Real alerting (opt-in, same graceful-degrade pattern as
 * notification.service.ts's EmailTransport): always logs loudly regardless
 * of configuration, and additionally POSTs a Slack-compatible `{text}` body
 * when ALERT_WEBHOOK_URL is set — a Slack Incoming Webhook, Discord's
 * Slack-compatible webhook suffix, or any custom endpoint that accepts the
 * same shape all work with no code change. Never throws — a broken alert
 * channel must never take down the poller that's trying to report a real
 * outage.
 */
/**
 * `webhookUrl` defaults to the real env-configured value — the parameter
 * exists purely so tests can exercise the "configured" path directly rather
 * than fighting config/env.ts's own already-parsed, frozen-at-import
 * singleton (see health-monitor.test.ts).
 */
export async function sendAlert(message: string, webhookUrl: string | undefined = env.ALERT_WEBHOOK_URL): Promise<void> {
  logger.error(`[health-monitor] ${message}`);
  if (!webhookUrl) return;
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `AccuQual: ${message}` }),
    });
    if (!response.ok) logger.error(`[health-monitor] alert webhook responded ${response.status}`);
  } catch (err) {
    logger.error("[health-monitor] failed to deliver alert webhook", err);
  }
}

/**
 * This app has no background job/cron infrastructure anywhere (see
 * reporting.scheduler.ts's own comment on why an in-process interval is the
 * real, working choice for this app's deployment shape — one long-lived
 * Render web service process, not a horizontally-scaled fleet). Same
 * reasoning applies here: an in-process poller that re-checks readiness and
 * alerts on a real state CHANGE (not every tick, which would spam a real
 * webhook once a minute for as long as an outage lasts) is the smallest
 * real thing that works, not a stand-in for a proper external monitor.
 * Complements, not replaces, an external uptime checker pointed at
 * GET /health (see DEPLOY.md) — this only alerts while the process itself
 * is still up and running; it can't tell anyone the process crashed or the
 * whole Render instance is unreachable, which only an external check can.
 */
const POLL_INTERVAL_MS = 60 * 1000;
let pollHandle: ReturnType<typeof setInterval> | null = null;

/** Runs every alert rule (database, error burst, workers, workflow failures, sign-in attacks, email) — see alerts.ts. */
async function pollReadiness(): Promise<void> {
  try {
    await monitorTick();
  } catch (err) {
    logger.error("[health-monitor] alert cycle itself failed", err);
  }
}

/** Called once from server startup (see index.ts) — a no-op if called twice. Never runs during tests (vitest never calls this). */
export function startHealthMonitor(): void {
  if (pollHandle) return;
  pollHandle = setInterval(() => void pollReadiness(), POLL_INTERVAL_MS);
}

export function stopHealthMonitor(): void {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = null;
  resetAlertState();
}
