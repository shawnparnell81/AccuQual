// An origin that is not on ALLOWED_ORIGINS must be refused without a 500.
// The static-site rewrite forwards the browser Origin, so a marketing-host
// call to /auth/refresh used to surface as InternalServerError. The shell
// treated that as a retryable failure and never rendered.
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";

describe("CORS origin allowlist", () => {
  const app = createApp();
  const allowed = env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).find(Boolean);

  it("answers an unknown origin with the route's own status, and does not reflect it", async () => {
    const res = await request(app).post("/auth/refresh").set("Origin", "https://www.accuqualqms.com").set("X-AccuQual-Csrf", "1").send({});
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/refresh token/i);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("still reflects an allowed origin", async () => {
    expect(allowed).toBeTruthy();
    const res = await request(app).post("/auth/refresh").set("Origin", allowed!).set("X-AccuQual-Csrf", "1").send({});
    expect(res.status).toBe(401);
    expect(res.headers["access-control-allow-origin"]).toBe(allowed);
  });
});
