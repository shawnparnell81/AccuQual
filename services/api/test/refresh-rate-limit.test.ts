import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { env } from "../src/config/env.js";
import { createRefreshCoordinator, createRefreshRateLimiter, refreshRateLimitKey, REFRESH_RATE_LIMIT_MAX, REFRESH_RATE_WINDOW_MS, skipApiRateLimit } from "../src/middleware/rateLimit.js";
import { withSharedRefresh } from "../src/modules/auth/refreshFlight.js";
import { signRefreshToken } from "../src/utils/jwt.js";

function cookieFor(sub: string, jti: string) {
  const token = signRefreshToken({ sub, tokenVersion: 1, jti });
  return `accuqual_rt=${token}`;
}

function appWithLimit(limit: number) {
  const app = express();
  app.use(cookieParser());
  app.post("/auth/refresh", createRefreshRateLimiter({ limit, windowMs: 60_000 }), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("refresh rate limit", () => {
  it("fits a normal session and blocks a tight loop within a minute", () => {
    expect(REFRESH_RATE_WINDOW_MS).toBe(60_000);
    expect(REFRESH_RATE_LIMIT_MAX).toBeGreaterThanOrEqual(8);
    expect(REFRESH_RATE_LIMIT_MAX).toBeLessThanOrEqual(20);
  });

  it("returns 429 with Retry-After inside that minute once the budget is spent", async () => {
    const app = express();
    app.use(cookieParser());
    app.post("/auth/refresh", createRefreshRateLimiter({ limit: REFRESH_RATE_LIMIT_MAX, windowMs: REFRESH_RATE_WINDOW_MS }), (_req, res) => {
      res.json({ ok: true });
    });
    const cookie = cookieFor("42", "minute");
    for (let i = 0; i < REFRESH_RATE_LIMIT_MAX; i++) {
      expect((await request(app).post("/auth/refresh").set("Cookie", cookie)).status).toBe(200);
    }
    const blocked = await request(app).post("/auth/refresh").set("Cookie", cookie);
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("counts a signed refresh cookie by user, and an invalid one by address", () => {
    const req = (cookie?: string, ip = "203.0.113.8") => ({ cookies: cookie ? { accuqual_rt: cookie } : {}, ip }) as express.Request;

    const a = signRefreshToken({ sub: "15", tokenVersion: 1, jti: "one" });
    const rotated = signRefreshToken({ sub: "15", tokenVersion: 1, jti: "two" });
    expect(refreshRateLimitKey(req(a))).toBe("refresh-user-15");
    expect(refreshRateLimitKey(req(rotated))).toBe("refresh-user-15");
    expect(refreshRateLimitKey(req(signRefreshToken({ sub: "16", tokenVersion: 1, jti: "other" })))).toBe("refresh-user-16");

    const expired = jwt.sign({ sub: "15", tokenVersion: 1, jti: "old", exp: Math.floor(Date.now() / 1000) - 60 }, env.JWT_REFRESH_SECRET);
    const forged = jwt.sign({ sub: "15", tokenVersion: 1 }, "not-the-secret");
    expect(refreshRateLimitKey(req(expired))).toBe("refresh-ip-203.0.113.8");
    expect(refreshRateLimitKey(req(forged))).toBe("refresh-ip-203.0.113.8");
    expect(refreshRateLimitKey(req())).toBe("refresh-ip-203.0.113.8");
  });

  it("returns 429 with Retry-After once a user passes the limit, without blocking a different user", async () => {
    const app = appWithLimit(3);
    const mine = cookieFor("42", "jti-a");

    for (let i = 0; i < 3; i++) {
      const ok = await request(app).post("/auth/refresh").set("Cookie", mine);
      expect(ok.status).toBe(200);
    }

    const blocked = await request(app).post("/auth/refresh").set("Cookie", cookieFor("42", "jti-b"));
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/shortly/i);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);

    const someoneElse = await request(app).post("/auth/refresh").set("Cookie", cookieFor("99", "jti-c"));
    expect(someoneElse.status).toBe(200);
  });

  it("does not spend the general API budget on session renewal", () => {
    expect(skipApiRateLimit({ path: "/auth/refresh" } as express.Request)).toBe(true);
    expect(skipApiRateLimit({ path: "/auth/login" } as express.Request)).toBe(false);
    expect(skipApiRateLimit({ path: "/ncr" } as express.Request)).toBe(false);
  });

  it("concurrent refreshes produce a single refresh call and do not 429 the burst", async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = express();
    app.use(cookieParser());
    app.post("/auth/refresh", createRefreshCoordinator(createRefreshRateLimiter({ limit: 1, windowMs: 60_000 })), async (req, res) => {
      const body = await withSharedRefresh(req, async () => {
        calls += 1;
        await gate;
        return { ok: true };
      });
      res.json(body);
    });

    const cookie = cookieFor("42", "burst");
    const burst = Promise.all(Array.from({ length: 8 }, () => request(app).post("/auth/refresh").set("Cookie", cookie)));
    for (let i = 0; i < 50 && calls < 1; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(1);
    release();
    const results = await burst;
    for (const res of results) expect(res.status).toBe(200);
    expect(calls).toBe(1);

    const next = await request(app).post("/auth/refresh").set("Cookie", cookie);
    expect(next.status).toBe(429);
  });

  it("shares one address bucket for cookies that do not verify, and does not spend a real user's budget", async () => {
    const app = appWithLimit(2);
    const junk = { Cookie: "accuqual_rt=not-a-token" };

    expect((await request(app).post("/auth/refresh").set(junk)).status).toBe(200);
    expect((await request(app).post("/auth/refresh").set(junk)).status).toBe(200);
    const blocked = await request(app).post("/auth/refresh").set(junk);
    expect(blocked.status).toBe(429);

    const real = await request(app).post("/auth/refresh").set("Cookie", cookieFor("7", "still-fine"));
    expect(real.status).toBe(200);
  });
});
