import { generateKeyPairSync, type JsonWebKey, type KeyObject } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { errorHandler } from "../src/middleware/errorHandler.js";
import {
  cloudflareAccessGate,
  extractAccessToken,
  indexAccessCerts,
  normalizeTeamDomain,
  resetAccessCertCache,
  verifyAccessJwt,
  type AccessCerts,
} from "../src/middleware/cloudflareAccess.js";
import { createApp } from "../src/app.js";

const TEAM = "https://accuqual.cloudflareaccess.com";
const AUD = "aud-tag";
const KID = "test-kid";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
function certsFor(key: KeyObject, kid: string): AccessCerts {
  const exported = key.export({ format: "jwk" }) as JsonWebKey;
  return { keys: [{ kid, kty: "RSA", n: exported.n, e: exported.e }] };
}

function sign(overrides: jwt.SignOptions = {}, payload: jwt.JwtPayload = { email: "owner@example.com" }): string {
  return jwt.sign(payload, privateKey, {
    algorithm: "RS256",
    issuer: TEAM,
    audience: AUD,
    expiresIn: "5m",
    keyid: KID,
    ...overrides,
  });
}

function gatedApp(loadCerts: (url: string) => Promise<AccessCerts>, config: { teamDomain: string; audience: string } | null) {
  const app = express();
  app.use(cookieParser());
  app.use(cloudflareAccessGate({ config, loadCerts }));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/health/live", (_req, res) => res.json({ ok: true }));
  app.get("/records", (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe("Cloudflare Access token verification", () => {
  beforeEach(() => resetAccessCertCache());

  it("accepts a token signed by the team key for this audience", async () => {
    await expect(
      verifyAccessJwt({
        token: sign(),
        teamDomain: "accuqual.cloudflareaccess.com",
        audience: AUD,
        loadCerts: async () => certsFor(publicKey, KID),
      })
    ).resolves.toBeUndefined();
  });

  it("rejects a token for a different audience", async () => {
    await expect(
      verifyAccessJwt({
        token: sign({ audience: "someone-else" }),
        teamDomain: TEAM,
        audience: AUD,
        loadCerts: async () => certsFor(publicKey, KID),
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects an expired token", async () => {
    await expect(
      verifyAccessJwt({
        token: sign({ expiresIn: -120 }),
        teamDomain: TEAM,
        audience: AUD,
        loadCerts: async () => certsFor(publicKey, KID),
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects a token signed by a different key", async () => {
    const forged = jwt.sign({ email: "owner@example.com" }, other.privateKey, {
      algorithm: "RS256",
      issuer: TEAM,
      audience: AUD,
      expiresIn: "5m",
      keyid: KID,
    });
    await expect(
      verifyAccessJwt({
        token: forged,
        teamDomain: TEAM,
        audience: AUD,
        loadCerts: async () => certsFor(publicKey, KID),
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("refreshes certs once when the key id is not in the cached set", async () => {
    let calls = 0;
    await verifyAccessJwt({
      token: sign(),
      teamDomain: TEAM,
      audience: AUD,
      loadCerts: async () => {
        calls += 1;
        return calls === 1 ? certsFor(other.publicKey, "old-kid") : certsFor(publicKey, KID);
      },
    });
    expect(calls).toBe(2);
  });

  it("fails closed when the cert endpoint cannot be reached", async () => {
    await expect(
      verifyAccessJwt({
        token: sign(),
        teamDomain: TEAM,
        audience: AUD,
        loadCerts: async () => {
          throw new Error("network down");
        },
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("reads a PEM public cert when the response has no JWK for that key id", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "cf-access-"));
    const keyPath = join(dir, "key.pem");
    const certPath = join(dir, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath, "-days", "1", "-nodes", "-subj", "/CN=access-test"], { stdio: "pipe" });
    const pemKey = readFileSync(keyPath);
    const pemCert = readFileSync(certPath, "utf8");
    const token = jwt.sign({ email: "owner@example.com" }, pemKey, {
      algorithm: "RS256",
      issuer: TEAM,
      audience: AUD,
      expiresIn: "5m",
      keyid: "pem-kid",
    });
    await expect(
      verifyAccessJwt({
        token,
        teamDomain: TEAM,
        audience: AUD,
        loadCerts: async () => ({ public_certs: [{ kid: "pem-kid", cert: pemCert }] }),
      })
    ).resolves.toBeUndefined();
    expect(indexAccessCerts({ public_certs: [{ kid: "pem-kid", cert: pemCert }] }).has("pem-kid")).toBe(true);
  });
});

describe("normalizeTeamDomain", () => {
  it("adds https and drops a trailing slash", () => {
    expect(normalizeTeamDomain("accuqual.cloudflareaccess.com/")).toBe(TEAM);
    expect(normalizeTeamDomain(`${TEAM}/`)).toBe(TEAM);
  });

  it("rejects a non-https team domain", () => {
    expect(() => normalizeTeamDomain("http://accuqual.cloudflareaccess.com")).toThrow(/https/);
  });
});

describe("extractAccessToken", () => {
  it("prefers the assertion header over the cookie", () => {
    const req = {
      headers: { "cf-access-jwt-assertion": "from-header" },
      cookies: { CF_Authorization: "from-cookie" },
    } as unknown as express.Request;
    expect(extractAccessToken(req)).toBe("from-header");
  });
});

describe("cloudflareAccessGate", () => {
  const loadCerts = async () => certsFor(publicKey, KID);
  const config = { teamDomain: TEAM, audience: AUD };

  beforeEach(() => resetAccessCertCache());

  it("does nothing when the gate is not configured", async () => {
    const res = await request(gatedApp(loadCerts, null)).get("/records");
    expect(res.status).toBe(200);
  });

  it("requires a token on data routes when configured", async () => {
    const res = await request(gatedApp(loadCerts, config)).get("/records");
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/required/i);
  });

  it("accepts the header and ignores a bad cookie", async () => {
    const res = await request(gatedApp(loadCerts, config))
      .get("/records")
      .set("Cf-Access-Jwt-Assertion", sign())
      .set("Cookie", "CF_Authorization=not-a-jwt");
    expect(res.status).toBe(200);
  });

  it("accepts the CF_Authorization cookie when the header is absent", async () => {
    const res = await request(gatedApp(loadCerts, config)).get("/records").set("Cookie", `CF_Authorization=${sign()}`);
    expect(res.status).toBe(200);
  });

  it("leaves /health and /health/live open with no token", async () => {
    const app = gatedApp(loadCerts, config);
    expect((await request(app).get("/health")).status).toBe(200);
    expect((await request(app).get("/health/live")).status).toBe(200);
  });

  it("fails closed when the team domain is not https", async () => {
    const res = await request(gatedApp(loadCerts, { teamDomain: "http://accuqual.cloudflareaccess.com", audience: AUD }))
      .get("/records")
      .set("Cf-Access-Jwt-Assertion", sign());
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/misconfigured/i);
  });
});

describe("cloudflareAccessGate on the real app", () => {
  it("stays off when CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are unset, so CI is not locked out", async () => {
    const res = await request(createApp()).post("/quarantine").send({});
    expect(res.status).toBe(401);
  });
});
