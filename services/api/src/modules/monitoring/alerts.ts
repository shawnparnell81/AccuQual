import { createClient } from "redis";
import { pool } from "../../db/index.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { metrics } from "./metrics.js";
import { sendAlert } from "./healthMonitor.js";

/**
 * The alert rules and the state machine that turns them into notifications.
 *
 * A rule answers one question ("is something wrong right now?"). The monitor
 * asks every minute, and only speaks when the answer CHANGES — one message when
 * a problem starts, one when it clears, and a reminder every few hours if it
 * is still going. That keeps a real outage from becoming a message a minute.
 *
 * Six rules (the "about five" a small team can actually act on):
 *   database          the database is unreachable
 *   api_errors        a burst of 5xx responses
 *   workers           a background worker has stopped reporting in
 *   workflow_failures workflow runs are failing
 *   login_attacks     a wave of failed sign-ins / account lockouts
 *   email_failures    outgoing email is failing
 */

export interface RuleResult {
  firing: boolean;
  message: string;
}
export interface AlertRule {
  key: string;
  title: string;
  evaluate(): Promise<RuleResult>;
}

export interface AlertSnapshot {
  key: string;
  title: string;
  firing: boolean;
  since: string | null;
  message: string;
}

interface AlertState {
  firing: boolean;
  since: number | null;
  lastNotifiedAt: number;
  message: string;
}

const REMINDER_MS = 4 * 60 * 60_000;
const states = new Map<string, AlertState>();
let registered: AlertRule[] = [];

// ---- Dependencies the rules read (injectable so they can be tested without a database or Redis) ---------------------------------------------------------------

export interface RuleDeps {
  pingDatabase(): Promise<{ ok: boolean; detail: string }>;
  /** name -> epoch ms of its last heartbeat, or null when it has never reported / the key expired. `error` when Redis itself is unreachable. */
  readHeartbeats(names: string[]): Promise<{ beats: Map<string, number | null>; error?: string }>;
  countFailedWorkflowRuns(sinceMs: number): Promise<number>;
  expectedWorkers: string[];
  now(): number;
}

export const HEARTBEAT_PREFIX = "accuqual:heartbeat:";
export const HEARTBEAT_STALE_MS = 90_000;

export const defaultDeps: RuleDeps = {
  async pingDatabase() {
    try {
      await pool.query("SELECT 1");
      return { ok: true, detail: "Reachable" };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  },
  async readHeartbeats(names) {
    const client = createClient({ url: env.REDIS_URL, socket: { connectTimeout: 3000 } });
    client.on("error", () => undefined);
    try {
      await client.connect();
      const values = await client.mGet(names.map((n) => HEARTBEAT_PREFIX + n));
      return { beats: new Map(names.map((n, i) => [n, values[i] ? Number(values[i]) : null])) };
    } catch (err) {
      return { beats: new Map(), error: (err as Error).message };
    } finally {
      await client.quit().catch(() => undefined);
    }
  },
  async countFailedWorkflowRuns(sinceMs) {
    // Owner connection on purpose: this counts across every tenant, which no tenant-scoped session may do.
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM workflow_runs WHERE status = 'failed' AND simulated = false AND finished_at > $1", [new Date(sinceMs)]);
    return rows[0]?.n ?? 0;
  },
  expectedWorkers: env.MONITOR_EXPECTED_WORKERS.split(",").map((s) => s.trim()).filter(Boolean),
  now: Date.now,
};

export function createRules(deps: RuleDeps = defaultDeps): AlertRule[] {
  return [
    {
      key: "database",
      title: "Database",
      async evaluate() {
        const r = await deps.pingDatabase();
        return { firing: !r.ok, message: r.ok ? "Reachable" : `Database unreachable — ${r.detail}` };
      },
    },
    {
      key: "api_errors",
      title: "API errors",
      async evaluate() {
        const window = 5 * 60_000;
        const errors = metrics.serverErrors.total(window);
        const total = metrics.requests.total(window);
        const rate = total > 0 ? errors / total : 0;
        // Both a floor and a rate: three failures out of five requests overnight is noise; five out of a hundred is an incident.
        const firing = errors >= 5 && rate >= 0.05;
        return { firing, message: firing ? `${errors} server errors out of ${total} requests in the last 5 minutes (${(rate * 100).toFixed(0)}%)` : `${errors} server errors / ${total} requests in 5 min` };
      },
    },
    {
      key: "workers",
      title: "Background workers",
      async evaluate() {
        if (deps.expectedWorkers.length === 0) return { firing: false, message: "No workers are configured to be monitored" };
        const { beats, error } = await deps.readHeartbeats(deps.expectedWorkers);
        if (error) return { firing: true, message: `Can't reach Redis, so background workers can't be checked — ${error}` };
        const stale = deps.expectedWorkers.filter((n) => {
          const at = beats.get(n);
          return !at || deps.now() - at > HEARTBEAT_STALE_MS;
        });
        return { firing: stale.length > 0, message: stale.length ? `Not reporting: ${stale.join(", ")}` : `All ${deps.expectedWorkers.length} workers reporting` };
      },
    },
    {
      key: "workflow_failures",
      title: "Workflow runs",
      async evaluate() {
        const failed = await deps.countFailedWorkflowRuns(deps.now() - 15 * 60_000);
        return { firing: failed >= 3, message: failed >= 3 ? `${failed} workflow runs failed in the last 15 minutes` : `${failed} failed runs in 15 min` };
      },
    },
    {
      key: "login_attacks",
      title: "Sign-in attacks",
      async evaluate() {
        const failures = metrics.loginFailures.total(10 * 60_000);
        const lockouts = metrics.lockouts.total(15 * 60_000);
        const firing = failures >= 25 || lockouts >= 3;
        return { firing, message: firing ? `${failures} failed sign-ins in 10 minutes, ${lockouts} accounts locked in 15 — possible password guessing` : `${failures} failed sign-ins / ${lockouts} lockouts` };
      },
    },
    {
      key: "email_failures",
      title: "Outgoing email",
      async evaluate() {
        const failed = metrics.emailFailures.total(15 * 60_000);
        return { firing: failed >= 3, message: failed >= 3 ? `${failed} emails failed to send in the last 15 minutes` : `${failed} email failures in 15 min` };
      },
    },
  ];
}

// ---- The state machine -----------------------------------------------------------------------------------------------------------------------------

type Sender = (message: string) => Promise<void>;

/** Evaluates every rule once and notifies on transitions. A rule that itself throws is reported as firing rather than silently skipped. */
export async function runAlertCycle(rules: AlertRule[] = registered.length ? registered : (registered = createRules()), send: Sender = (m) => sendAlert(m), now: () => number = Date.now): Promise<AlertSnapshot[]> {
  for (const rule of rules) {
    let result: RuleResult;
    try {
      result = await rule.evaluate();
    } catch (err) {
      result = { firing: true, message: `The check itself failed: ${(err as Error).message}` };
    }
    const prev = states.get(rule.key);
    const t = now();
    if (result.firing && !prev?.firing) {
      states.set(rule.key, { firing: true, since: t, lastNotifiedAt: t, message: result.message });
      await send(`🔴 [FIRING] ${rule.title}: ${result.message}`);
    } else if (result.firing && prev?.firing) {
      const remind = t - prev.lastNotifiedAt >= REMINDER_MS;
      states.set(rule.key, { ...prev, message: result.message, lastNotifiedAt: remind ? t : prev.lastNotifiedAt });
      if (remind) await send(`🔴 [STILL FIRING] ${rule.title}: ${result.message} (since ${new Date(prev.since!).toISOString()})`);
    } else if (!result.firing && prev?.firing) {
      states.set(rule.key, { firing: false, since: null, lastNotifiedAt: t, message: result.message });
      await send(`✅ [RESOLVED] ${rule.title}: ${result.message}`);
    } else {
      states.set(rule.key, { firing: false, since: null, lastNotifiedAt: prev?.lastNotifiedAt ?? 0, message: result.message });
    }
  }
  return alertSnapshot(rules);
}

export function alertSnapshot(rules: AlertRule[] = registered): AlertSnapshot[] {
  return rules.map((r) => {
    const s = states.get(r.key);
    return { key: r.key, title: r.title, firing: s?.firing ?? false, since: s?.since ? new Date(s.since).toISOString() : null, message: s?.message ?? "Not checked yet" };
  });
}

/** Every rule with its current state — what the admin System Health screen shows. Rules that have not run yet report "Not checked yet". */
export function currentAlerts(): AlertSnapshot[] {
  return alertSnapshot(createRules());
}

export function resetAlertState(): void {
  states.clear();
  registered = [];
}

/**
 * Dead-man's switch: while the database is reachable, ping an external "heartbeat" URL (Healthchecks.io, Better Stack,
 * Uptime Kuma...). If the pings STOP — the process crashed, the host is down, the network is gone — that service alerts
 * you. This covers exactly what an in-process monitor cannot: its own death.
 */
export async function pingHeartbeat(url: string | undefined = env.HEARTBEAT_URL, fetcher: typeof fetch = fetch): Promise<void> {
  if (!url) return;
  try {
    const res = await fetcher(url, { method: "GET", signal: AbortSignal.timeout(5000) });
    if (!res.ok) logger.warn(`[health-monitor] heartbeat URL responded ${res.status}`);
  } catch (err) {
    logger.warn("[health-monitor] couldn't reach the heartbeat URL", { err: String(err) });
  }
}

/** One monitoring tick: evaluate the rules, then (if the database is fine) tell the external dead-man's switch we're alive. */
export async function monitorTick(): Promise<void> {
  const snapshot = await runAlertCycle();
  if (!snapshot.find((s) => s.key === "database")?.firing) await pingHeartbeat();
}
