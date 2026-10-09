import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { formatLocation, lookupIpLocation, placeName } from "../../src/modules/auth/ipLocation.js";
import { isUndefinedTable } from "../../src/modules/auth/loginEvents.js";
import { signInClientFromRequest } from "../../src/modules/auth/signInClient.js";
import { deviceLabel, isWindows11, parseUserAgent } from "../../src/modules/auth/userAgent.js";

const CHROME_129 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.90 Safari/537.36";

function ipApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.get("/who", (req, res) => {
    res.json(signInClientFromRequest(req));
  });
  return app;
}

describe("login history user agent", () => {
  it("reads Chrome 129 on Windows 11 as a desktop when the platform hint says 11", () => {
    const parsed = parseUserAgent(CHROME_129, "15.0.0");
    expect(parsed).toEqual({ browser: "Chrome", browserVersion: "129", os: "Windows 11", deviceType: "desktop" });
    expect(deviceLabel(parsed)).toBe("Chrome 129 on Windows 11, Desktop");
    expect(isWindows11("15.0.0")).toBe(true);
    expect(isWindows11('"13.0.0"')).toBe(true);
    expect(isWindows11("10.0.0")).toBe(false);
  });

  it("keeps Windows 10 when the platform hint is missing", () => {
    expect(parseUserAgent(CHROME_129).os).toBe("Windows 10");
  });

  it("names Edge, Firefox, Safari, a phone, and a tablet", () => {
    expect(parseUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0").browser).toBe("Edge");
    expect(parseUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv/128.0) Gecko/20100101 Firefox/128.0")).toMatchObject({ browser: "Firefox", browserVersion: "128" });
    expect(parseUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15")).toMatchObject({
      browser: "Safari",
      browserVersion: "17",
      os: "macOS 10.15",
      deviceType: "desktop",
    });
    expect(parseUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).toMatchObject({
      os: "iOS 17",
      deviceType: "mobile",
    });
    expect(parseUserAgent("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1").deviceType).toBe("tablet");
    expect(parseUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36").deviceType).toBe("tablet");
  });
});

describe("login history location", () => {
  it("turns known place names into English and skips blank markers", () => {
    expect(placeName("美国")).toBe("United States");
    expect(placeName("西雅图")).toBe("Seattle");
    expect(placeName("内网IP")).toBeNull();
    expect(placeName("0")).toBeNull();
    expect(formatLocation({ city: "西雅图", region: "华盛顿", country: "美国" })).toBe("Seattle, Washington, United States");
  });

  it("leaves private addresses blank and looks up a public address offline", () => {
    expect(lookupIpLocation("127.0.0.1").label).toBe("");
    expect(lookupIpLocation("10.1.2.3").label).toBe("");
    expect(lookupIpLocation("192.168.1.8").country).toBeNull();
    expect(lookupIpLocation(null).label).toBe("");
    const google = lookupIpLocation("8.8.8.8");
    expect(google.country).toBe("United States");
    expect(google.label).toContain("United States");
  });
});

describe("login history missing table", () => {
  it("recognizes a missing-table error wrapped by the query driver", () => {
    expect(isUndefinedTable({ code: "42P01" })).toBe(true);
    expect(isUndefinedTable({ message: "failed", cause: { code: "42P01" } })).toBe(true);
    expect(isUndefinedTable({ code: "23505" })).toBe(false);
    expect(isUndefinedTable(new Error("no"))).toBe(false);
  });
});

describe("login history client address", () => {
  it("uses the address the trusted proxy appended, not a spoofed earlier hop", async () => {
    const app = ipApp();
    const listed = await request(app).get("/who").set("X-Forwarded-For", "198.51.100.9, 203.0.113.44");
    expect(listed.body.ip).toBe("203.0.113.44");

    const proxyThenClient = await request(app).get("/who").set("X-Forwarded-For", "203.0.113.10, 10.0.0.5");
    expect(proxyThenClient.body.ip).toBe("10.0.0.5");

    const single = await request(app).get("/who").set("X-Forwarded-For", "203.0.113.10");
    expect(single.body.ip).toBe("203.0.113.10");
  });

  it("prefers a single Cloudflare client address and keeps the browser hint", async () => {
    const res = await request(ipApp())
      .get("/who")
      .set("X-Forwarded-For", "198.51.100.9, 203.0.113.44")
      .set("CF-Connecting-IP", "192.0.2.8")
      .set("User-Agent", CHROME_129)
      .set("Sec-CH-UA-Platform-Version", "15.0.0");
    expect(res.body).toEqual({ ip: "192.0.2.8", userAgent: CHROME_129, platformVersion: "15.0.0" });
  });
});
