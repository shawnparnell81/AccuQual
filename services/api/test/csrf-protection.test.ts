// The app-wide CSRF guard (middleware/csrf.ts): cookie-carried, state-changing requests need the anti-CSRF header; everything else passes untouched.
// The first block exercises the middleware alone; the second proves it is really mounted on the real app, ahead of every route (none of those hit the database).
import { describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { csrfProtection } from "../src/middleware/csrf.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { createApp } from "../src/app.js";
import { REFRESH_COOKIE_NAME } from "../src/modules/auth/auth.controller.js";
import { SSO_COOKIE } from "../src/modules/sso/oidc.js";

function tinyApp() {
  const app = express();
  app.use(cookieParser());
  app.use(csrfProtection);
  app.all("/thing", (_req, res) => res.json({ reached: true }));
  app.use(errorHandler);
  return app;
}

const REFRESH = `${REFRESH_COOKIE_NAME}=abc`;
const SSO = `${SSO_COOKIE}=abc`;
const MUTATING = ["post", "put", "patch", "delete"] as const;

describe("csrfProtection middleware", () => {
  for (const method of MUTATING) {
    it(`${method.toUpperCase()} carried by the refresh cookie with no header is refused (403)`, async () => {
      const res = await request(tinyApp())[method]("/thing").set("Cookie", REFRESH);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/anti-CSRF header/i);
    });
  }

  it("refuses when only the SSO flow cookie carries the request", async () => {
    const res = await request(tinyApp()).post("/thing").set("Cookie", SSO);
    expect(res.status).toBe(403);
  });

  it("lets a cookie-carried request through when the header is present (any value)", async () => {
    const res = await request(tinyApp()).post("/thing").set("Cookie", REFRESH).set("X-AccuQual-Csrf", "1");
    expect(res.status).toBe(200);
    expect(res.body.reached).toBe(true);
  });

  it("does not care about a request carried by a Bearer token, even with our cookie also present", async () => {
    const res = await request(tinyApp()).post("/thing").set("Cookie", REFRESH).set("Authorization", "Bearer x");
    expect(res.status).toBe(200);
  });

  it("does not touch a request with no cookie at all (login, webhooks, ingest keys, workers)", async () => {
    const res = await request(tinyApp()).post("/thing");
    expect(res.status).toBe(200);
  });

  it("ignores unrelated cookies", async () => {
    const res = await request(tinyApp()).post("/thing").set("Cookie", "analytics_id=1; theme=dark");
    expect(res.status).toBe(200);
  });

  for (const method of ["get", "head", "options"] as const) {
    it(`${method.toUpperCase()} bypasses the guard even with the cookie`, async () => {
      const res = await request(tinyApp())[method]("/thing").set("Cookie", REFRESH);
      expect(res.status).toBe(200);
    });
  }
});

describe("csrfProtection on the real app", () => {
  const app = createApp();

  it("guards a route that never opted in: cookie, no bearer, no header -> 403 before the handler", async () => {
    const res = await request(app).post("/quarantine").set("Cookie", REFRESH).send({});
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/anti-CSRF header/i);
  });

  it("the same route with no cookie is not the guard's business (auth answers instead)", async () => {
    const res = await request(app).post("/quarantine").send({});
    expect(res.status).toBe(401);
  });

  it("refresh with the cookie and no header is still refused", async () => {
    const res = await request(app).post("/auth/refresh").set("Cookie", REFRESH);
    expect(res.status).toBe(403);
  });

  it("GET routes bypass it", async () => {
    const res = await request(app).get("/health/live").set("Cookie", REFRESH);
    expect(res.status).toBe(200);
  });
});
