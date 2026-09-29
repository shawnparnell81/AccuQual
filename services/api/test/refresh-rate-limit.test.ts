import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { env } from "../src/config/env.js";
import { createRefreshRateLimiter, refreshRateLimitKey, REFRESH_RATE_LIMIT_MAX } from "../src/middleware/rateLimit.js";
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
  it("is loose enough for a normal session and still finite", () => {
    expect(REFRESH_RATE_LIMIT_MAX).toBeGreaterThanOrEqual(30);
    expect(REFRESH_RATE_LIMIT_MAX).toBeLessThanOrEqual(120);
  });

  it("counts a signed refresh cookie by user, and an invalid one by address", () => {
    const req = (cookie?: string, ip = "203.0.113.8", cf?: string) =>
      ({
        cookies: cookie ? { accuqual_rt: cookie } : {},
        ip,
        header: (name: string) => (name.toLowerCase() === "cf-connecting-ip" ? cf : undefined),
      }) as express.Request;

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
    // A bad cookie falls back to the visitor, not the proxy address in front of the API.
    expect(refreshRateLimitKey(req(forged, "203.0.113.50", "198.51.100.20"))).toBe("refresh-ip-198.51.100.20");
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
