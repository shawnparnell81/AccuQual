import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { checkReadiness, sendAlert, startHealthMonitor, stopHealthMonitor } from "../src/modules/monitoring/healthMonitor.js";
import { pool } from "../src/db/index.js";

const app = createApp();

afterAll(async () => {
  await pool.end();
});

describe("GET /health", () => {
  it("returns 200 with a real readiness report when the database and Redis are both reachable", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ service: "accuqual-api", status: "ok" });
    expect(res.body.database).toMatchObject({ status: "ok" });
    expect(res.body.redis.status).toMatch(/ok|critical/); // real Redis reachability, not asserted as always up
    expect(res.body.checkedAt).toBeTruthy();
  });
});

describe("checkReadiness", () => {
  it("pings the real database and reports latency", async () => {
    const report = await checkReadiness();
    expect(report.database.status).toBe("ok");
    expect(report.database.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("overall status is driven by the database check alone, not Redis", async () => {
    // Even if Redis were unreachable, `status` must still mirror `database`
    // — see healthMonitor.ts's own comment on why a possibly-unprovisioned
    // Redis must never flip Render's health check to failing.
    const report = await checkReadiness();
    expect(report.status).toBe(report.database.status);
  });
});

describe("sendAlert", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never calls fetch when no webhook URL is configured (log-only, graceful degrade)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await sendAlert("test message", undefined);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a Slack-compatible {text} payload when a webhook URL is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await sendAlert("database unreachable", "https://hooks.example.com/services/T000/B000/xyz");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("https://hooks.example.com/services/T000/B000/xyz");
    expect(JSON.parse(init.body)).toMatchObject({ text: "AccuQual: database unreachable" });
  });

  it("never throws when the webhook endpoint itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(sendAlert("test", "https://hooks.example.com/broken")).resolves.toBeUndefined();
  });
});

describe("startHealthMonitor / stopHealthMonitor", () => {
  afterEach(() => {
    stopHealthMonitor();
    vi.restoreAllMocks();
  });

  it("registers exactly one interval, even if called twice", () => {
    const spy = vi.spyOn(global, "setInterval");
    startHealthMonitor();
    startHealthMonitor();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("stop clears the interval so a subsequent start registers a new one", () => {
    const spy = vi.spyOn(global, "setInterval");
    startHealthMonitor();
    stopHealthMonitor();
    startHealthMonitor();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
