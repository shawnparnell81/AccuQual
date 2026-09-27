// Cookie attributes for the sign-in cookies and the trusted-browser cookie.
// No database: these setters only write Set-Cookie headers.
import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/index.js";
import {
  CSRF_MARKER_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  TRUSTED_DEVICE_COOKIE_NAME,
  setRefreshCookie,
  setTrustedDeviceCookie,
} from "../src/modules/auth/auth.controller.js";

const app = express();
app.get("/session", (_req, res) => {
  setRefreshCookie(res, "refresh-token");
  res.end("ok");
});
app.get("/trust", (_req, res) => {
  setRefreshCookie(res, "refresh-token");
  setTrustedDeviceCookie(res, "device-token");
  res.end("ok");
});

function headerNamed(res: request.Response, name: string): string | undefined {
  const headers = res.headers["set-cookie"] as unknown as string[] | undefined;
  return headers?.find((header) => header.startsWith(`${name}=`));
}

function attributesOf(header: string): string {
  const semi = header.indexOf(";");
  expect(semi).toBeGreaterThan(0);
  return header.slice(semi).toLowerCase();
}

describe("sign-in cookie attributes", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("refresh and csrf cookies are browser-session cookies", async () => {
    const res = await request(app).get("/session");
    expect(res.status).toBe(200);
    for (const name of [REFRESH_COOKIE_NAME, CSRF_MARKER_COOKIE_NAME]) {
      const header = headerNamed(res, name);
      expect(header).toBeTruthy();
      const attrs = attributesOf(header!);
      expect(attrs).toContain("httponly");
      expect(attrs).toContain("path=/");
      expect(attrs).toContain("samesite=lax");
      expect(attrs).not.toContain("domain=");
      expect(attrs).not.toContain("secure");
      expect(attrs).not.toMatch(/max-age=/);
      expect(attrs).not.toMatch(/expires=/);
    }
  });

  it("the trusted-browser cookie stays persistent for 30 days on the same response", async () => {
    const res = await request(app).get("/trust");
    expect(res.status).toBe(200);

    const trusted = headerNamed(res, TRUSTED_DEVICE_COOKIE_NAME);
    expect(trusted).toBeTruthy();
    const trustedAttrs = attributesOf(trusted!);
    expect(trustedAttrs).toContain("httponly");
    expect(trustedAttrs).toContain("path=/");
    expect(trustedAttrs).toContain("samesite=lax");
    expect(trustedAttrs).not.toContain("domain=");
    expect(trustedAttrs).toContain("max-age=2592000");
    expect(trustedAttrs).toMatch(/expires=/);

    for (const name of [REFRESH_COOKIE_NAME, CSRF_MARKER_COOKIE_NAME]) {
      const attrs = attributesOf(headerNamed(res, name)!);
      expect(attrs).not.toMatch(/max-age=/);
      expect(attrs).not.toMatch(/expires=/);
    }
  });
});
