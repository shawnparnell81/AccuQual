import express from "express";
import request from "supertest";
import rateLimit, { MemoryStore } from "express-rate-limit";
import { describe, expect, it } from "vitest";
import { visitorIp } from "../../src/middleware/rateLimit.js";

function limitedApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 2,
      standardHeaders: true,
      legacyHeaders: false,
      store: new MemoryStore(),
      keyGenerator: (req) => `auth:${visitorIp(req)}`,
      message: { error: "TooManyRequests", message: "Too many auth attempts, try again later" },
    }),
  );
  app.get("/ping", (req, res) => {
    res.json({ ip: req.ip, visitor: visitorIp(req) });
  });
  return app;
}

describe("sign-in rate limit address", () => {
  it("uses Cloudflare's client address when that header is one IP", async () => {
    const app = limitedApp();
    const forwarded = "198.51.100.20, 203.0.113.50";
    const plain = await request(app).get("/ping").set("X-Forwarded-For", forwarded);
    expect(plain.status).toBe(200);
    expect(plain.body.visitor).toBe(plain.body.ip);

    const cloudflare = await request(app).get("/ping").set("X-Forwarded-For", forwarded).set("CF-Connecting-IP", "192.0.2.8");
    expect(cloudflare.body.visitor).toBe("192.0.2.8");
    expect(cloudflare.body.visitor).not.toBe(cloudflare.body.ip);
  });

  it("does not let a forged list in CF-Connecting-IP choose the bucket", async () => {
    const app = limitedApp();
    const forwarded = "198.51.100.20, 203.0.113.50";
    const spoofed = await request(app).get("/ping").set("X-Forwarded-For", forwarded).set("CF-Connecting-IP", "198.51.100.9, 203.0.113.9");
    expect(spoofed.body.visitor).toBe(spoofed.body.ip);
  });

  it("counts each visitor separately, including when they share a proxy", async () => {
    const app = limitedApp();
    const forwarded = "198.51.100.20, 203.0.113.50";
    const first = await request(app).get("/ping").set("X-Forwarded-For", forwarded).set("CF-Connecting-IP", "198.51.100.20");
    const second = await request(app).get("/ping").set("X-Forwarded-For", forwarded).set("CF-Connecting-IP", "198.51.100.20");
    const third = await request(app).get("/ping").set("X-Forwarded-For", forwarded).set("CF-Connecting-IP", "198.51.100.20");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);

    const other = await request(app).get("/ping").set("X-Forwarded-For", forwarded).set("CF-Connecting-IP", "203.0.113.10");
    expect(other.status).toBe(200);
    expect(other.body.visitor).toBe("203.0.113.10");
  });

  it("falls back to the address Express resolved from the trusted proxy", async () => {
    const app = limitedApp();
    const forwarded = "198.51.100.20, 203.0.113.50";
    const a = await request(app).get("/ping").set("X-Forwarded-For", forwarded);
    const b = await request(app).get("/ping").set("X-Forwarded-For", forwarded);
    const c = await request(app).get("/ping").set("X-Forwarded-For", forwarded);
    expect(a.body.visitor).toBe(a.body.ip);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(c.status).toBe(429);
  });
});
