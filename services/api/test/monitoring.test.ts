import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import request from "supertest";
import { createApp } from "../src/app.js";
import { RollingCounter, metrics } from "../src/modules/monitoring/metrics.js";
import { HEARTBEAT_STALE_MS, createRules, pingHeartbeat, resetAlertState, runAlertCycle, type AlertRule, type RuleDeps } from "../src/modules/monitoring/alerts.js";
import { getRequestContext, requestIdMiddleware } from "../src/modules/monitoring/requestContext.js";
import { scrubEvent } from "../src/modules/monitoring/sentry.js";
import { requestLogger } from "../src/middleware/requestLogger.js";
import { setEmailTransport, sendEmail } from "../src/modules/notifications/notification.service.js";
import { logger } from "../src/utils/logger.js";
import Transport from "winston-transport";

afterEach(() => {
  metrics.reset();
  resetAlertState();
});

describe("RollingCounter", () => {
  it("counts only what happened inside the window", () => {
    let now = 1_000_000;
    const c = new RollingCounter(60_000, 10_000, () => now);
    c.add(3);
    now += 30_000;
    c.add(2);
    expect(c.total()).toBe(5);
    expect(c.total(20_000)).toBe(2); // a shorter look-back
    now += 45_000; // the first burst is now 75 s old
    expect(c.total()).toBe(2);
    now += 120_000;
    expect(c.total()).toBe(0);
  });
});

describe("alert rules", () => {
  const deps = (over: Partial<RuleDeps> = {}): RuleDeps => ({
    pingDatabase: async () => ({ ok: true, detail: "Reachable" }),
    readHeartbeats: async (names) => ({ beats: new Map(names.map((n) => [n, 1_000_000])) }),
    countFailedWorkflowRuns: async () => 0,
    expectedWorkers: ["workflow", "ai"],
    now: () => 1_000_000 + 10_000,
    ...over,
  });
  const rule = (d: RuleDeps, key: string) => createRules(d).find((r) => r.key === key)!;

  it("database: fires when the database cannot be reached", async () => {
    expect((await rule(deps(), "database").evaluate()).firing).toBe(false);
    const down = await rule(deps({ pingDatabase: async () => ({ ok: false, detail: "ECONNREFUSED" }) }), "database").evaluate();
    expect(down).toMatchObject({ firing: true });
    expect(down.message).toContain("ECONNREFUSED");
  });

  it("api_errors: needs both a floor and a rate, so a quiet night's one failure is not an incident", async () => {
    const r = rule(deps(), "api_errors");
    for (let i = 0; i < 4; i++) metrics.recordRequest(500);
    for (let i = 0; i < 4; i++) metrics.recordRequest(200);
    expect((await r.evaluate()).firing).toBe(false); // 4 errors: under the floor
    metrics.reset();
    for (let i = 0; i < 6; i++) metrics.recordRequest(503);
    for (let i = 0; i < 200; i++) metrics.recordRequest(200);
    expect((await r.evaluate()).firing).toBe(false); // 6 errors but 3%: under the rate
    for (let i = 0; i < 10; i++) metrics.recordRequest(500);
    const burst = await r.evaluate();
    expect(burst.firing).toBe(true);
    expect(burst.message).toMatch(/16 server errors out of 216/);
  });

  it("workers: names the ones that stopped reporting, and reports an unreachable Redis instead of staying silent", async () => {
    expect((await rule(deps(), "workers").evaluate()).firing).toBe(false);
    const stale = await rule(deps({ readHeartbeats: async () => ({ beats: new Map([["workflow", 1_000_000], ["ai", 1_000_000 - HEARTBEAT_STALE_MS - 5_000]]) }) }), "workers").evaluate();
    expect(stale).toMatchObject({ firing: true, message: "Not reporting: ai" });
    const never = await rule(deps({ readHeartbeats: async () => ({ beats: new Map([["workflow", 1_000_000], ["ai", null]]) }) }), "workers").evaluate();
    expect(never.message).toBe("Not reporting: ai");
    const redis = await rule(deps({ readHeartbeats: async () => ({ beats: new Map(), error: "connect ECONNREFUSED" }) }), "workers").evaluate();
    expect(redis.firing).toBe(true);
    expect(redis.message).toContain("Redis");
    // Nothing configured to watch = nothing to say (local development).
    expect((await rule(deps({ expectedWorkers: [] }), "workers").evaluate()).firing).toBe(false);
  });

  it("workflow_failures, login_attacks and email_failures fire at their thresholds", async () => {
    expect((await rule(deps({ countFailedWorkflowRuns: async () => 2 }), "workflow_failures").evaluate()).firing).toBe(false);
    expect((await rule(deps({ countFailedWorkflowRuns: async () => 3 }), "workflow_failures").evaluate()).firing).toBe(true);

    const attacks = rule(deps(), "login_attacks");
    for (let i = 0; i < 24; i++) metrics.loginFailures.add();
    expect((await attacks.evaluate()).firing).toBe(false);
    metrics.loginFailures.add();
    expect((await attacks.evaluate()).firing).toBe(true);
    metrics.reset();
    for (let i = 0; i < 3; i++) metrics.lockouts.add();
    expect((await attacks.evaluate()).firing).toBe(true); // three lockouts is enough on its own

    const mail = rule(deps(), "email_failures");
    metrics.emailFailures.add(2);
    expect((await mail.evaluate()).firing).toBe(false);
    metrics.emailFailures.add();
    expect((await mail.evaluate()).firing).toBe(true);
  });
});

describe("alert state machine", () => {
  const flip = (initial: boolean) => {
    const state = { firing: initial, message: "boom" };
    const r: AlertRule = { key: "t", title: "Test", evaluate: async () => ({ firing: state.firing, message: state.message }) };
    return { state, r };
  };

  it("speaks when a problem starts and when it clears — not on every check in between", async () => {
    const { state, r } = flip(false);
    const sent: string[] = [];
    const send = async (m: string) => void sent.push(m);
    let now = 0;
    const tick = () => runAlertCycle([r], send, () => now);

    await tick();
    expect(sent).toEqual([]);
    state.firing = true;
    await tick();
    for (let i = 0; i < 5; i++) {
      now += 60_000;
      await tick();
    }
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^🔴 \[FIRING\] Test: boom/);

    state.firing = false;
    state.message = "fine";
    now += 60_000;
    await tick();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/^✅ \[RESOLVED\] Test: fine/);
    now += 60_000;
    await tick();
    expect(sent).toHaveLength(2);
  });

  it("reminds every four hours while a problem persists", async () => {
    const { r } = flip(true);
    const sent: string[] = [];
    let now = 0;
    const tick = () => runAlertCycle([r], async (m) => void sent.push(m), () => now);
    await tick();
    now += 3 * 3_600_000;
    await tick();
    expect(sent).toHaveLength(1);
    now += 1 * 3_600_000 + 1;
    await tick();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("STILL FIRING");
  });

  it("a check that itself throws is reported, never silently skipped", async () => {
    const sent: string[] = [];
    const broken: AlertRule = { key: "b", title: "Broken", evaluate: async () => Promise.reject(new Error("redis exploded")) };
    const snap = await runAlertCycle([broken], async (m) => void sent.push(m));
    expect(snap[0]).toMatchObject({ firing: true });
    expect(sent[0]).toContain("The check itself failed: redis exploded");
  });
});

describe("dead-man's-switch heartbeat", () => {
  it("pings the URL, does nothing without one, and never throws when the ping fails", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await pingHeartbeat("https://hc.example/ping/abc", fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith("https://hc.example/ping/abc", expect.objectContaining({ method: "GET" }));

    const none = vi.fn();
    await pingHeartbeat(undefined, none as unknown as typeof fetch);
    expect(none).not.toHaveBeenCalled();

    await expect(pingHeartbeat("https://hc.example/x", vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch)).resolves.toBeUndefined();
  });
});

describe("request ids", () => {
  it("every response carries X-Request-Id; a sane caller-supplied id is kept, a hostile one is replaced", async () => {
    const app = createApp();
    const fresh = await request(app).get("/health/live");
    expect(fresh.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

    const kept = await request(app).get("/health/live").set("X-Request-Id", "client-trace-12345");
    expect(kept.headers["x-request-id"]).toBe("client-trace-12345");

    // (Node itself refuses CR/LF in a header, so the hostile cases worth testing are the ones that can be sent.)
    for (const bad of ["has spaces <script>", "x".repeat(200), "short"]) {
      const res = await request(app).get("/health/live").set("X-Request-Id", bad);
      expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("an error body carries the same id as the header, so a user can quote it", async () => {
    const res = await request(createApp()).get("/auth/me"); // no token -> 401
    expect(res.status).toBe(401);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
  });

  it("puts the request id on every log line written while handling the request", async () => {
    const lines: Record<string, unknown>[] = [];
    class Capture extends Transport {
      override log(info: Record<string, unknown>, next: () => void) {
        lines.push(info);
        next();
      }
    }
    const capture = new Capture();
    logger.add(capture);
    try {
      const res = await request(createApp()).get("/auth/me");
      const id = res.headers["x-request-id"];
      expect(lines.some((l) => l.message === "request" && l.requestId === id)).toBe(true);
    } finally {
      logger.remove(capture);
    }
  });

  it("the context is available inside the request and gone outside it", () => {
    expect(getRequestContext()).toBeUndefined();
    let inside: string | undefined;
    requestIdMiddleware({ header: () => undefined } as never, { setHeader: () => undefined } as never, () => {
      inside = getRequestContext()?.requestId;
    });
    expect(inside).toMatch(/^[0-9a-f-]{36}$/);
    expect(getRequestContext()).toBeUndefined();
  });
});

describe("what feeds the alerts", () => {
  it("counts every request except health checks, and counts 5xx separately", () => {
    const fire = (path: string, status: number) => {
      const res = Object.assign(new EventEmitter(), { statusCode: status, getHeader: () => "rid-123456789" });
      requestLogger({ method: "GET", path } as never, res as never, () => undefined);
      res.emit("finish");
    };
    fire("/ncr", 200);
    fire("/ncr", 500);
    fire("/health", 200);
    fire("/health/live", 200);
    expect(metrics.requests.total()).toBe(2);
    expect(metrics.serverErrors.total()).toBe(1);
  });

  it("counts failed emails", async () => {
    setEmailTransport({ send: async () => "failed" });
    try {
      await sendEmail({ to: "a@b.c", subject: "s", body: "b" });
      await sendEmail({ to: "a@b.c", subject: "s", body: "b" });
      expect(metrics.emailFailures.total()).toBe(2);
      setEmailTransport({ send: async () => "sent" });
      await sendEmail({ to: "a@b.c", subject: "s", body: "b" });
      expect(metrics.emailFailures.total()).toBe(2);
    } finally {
      setEmailTransport(null);
    }
  });
});

describe("error reports never carry customer data", () => {
  it("strips bodies, cookies, auth headers and query strings, and reduces the user to an id", () => {
    const event = {
      type: undefined,
      request: {
        url: "https://app.example/ncr/5?token=secret&q=customer",
        query_string: "token=secret",
        data: { description: "customer complaint text" },
        cookies: { accuqual_rt: "refresh-token" },
        headers: { Authorization: "Bearer abc", Cookie: "accuqual_rt=abc", "X-Device-Key": "1.deadbeef", "User-Agent": "Chrome" },
      },
      user: { id: "42", email: "person@customer.com", ip_address: "1.2.3.4" },
    };
    const clean = scrubEvent(event as never) as typeof event;
    expect(clean.request.data).toBeUndefined();
    expect(clean.request.cookies).toBeUndefined();
    expect(clean.request.query_string).toBeUndefined();
    expect(clean.request.url).toBe("https://app.example/ncr/5");
    expect(clean.request.headers).toEqual({ "User-Agent": "Chrome" });
    expect(clean.user).toEqual({ id: "42" });
    expect(JSON.stringify(clean)).not.toMatch(/secret|customer|refresh-token|person@|1\.2\.3\.4|deadbeef/);
  });
});

describe("GET /health", () => {
  it("reports the version and uptime; /health/live answers without touching a dependency", async () => {
    const app = createApp();
    const full = await request(app).get("/health");
    expect(full.body).toMatchObject({ service: "accuqual-api", version: expect.any(String), uptimeSeconds: expect.any(Number) });
    const live = await request(app).get("/health/live");
    expect(live.status).toBe(200);
    expect(live.body.status).toBe("ok");
  });
});
