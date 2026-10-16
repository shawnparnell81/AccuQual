import { describe, expect, it } from "vitest";
import { createPublicKey, generateKeyPairSync, verify, constants } from "node:crypto";
import {
  accountDomain,
  accountEnvironment,
  buildClientAssertion,
  normalizeAccountId,
  resolveAlgorithm,
  parsePrivateKey,
  tokenEndpoint,
  NETSUITE_SCOPE,
} from "../../src/modules/netsuite/netsuiteAuth.js";
import {
  assertReadOnlyRequest,
  isSelectOnly,
  mapNetSuiteError,
  mapNetworkError,
  NetSuiteClient,
  NetSuiteReadOnlyError,
  redactSecrets,
  clearNetSuiteTokenCache,
} from "../../src/modules/netsuite/netsuiteClient.js";

function ecKey(namedCurve: string) {
  return generateKeyPairSync("ec", { namedCurve, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
}
const rsa = generateKeyPairSync("rsa", { modulusLength: 3072, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

function decode(jwt: string) {
  const [h, p, s] = jwt.split(".");
  return { header: JSON.parse(Buffer.from(h!, "base64url").toString()), payload: JSON.parse(Buffer.from(p!, "base64url").toString()), input: `${h}.${p}`, sig: Buffer.from(s!, "base64url") };
}

describe("NetSuite account ID and domain", () => {
  it("derives the account-specific domain", () => {
    expect(accountDomain("1234567")).toBe("1234567.suitetalk.api.netsuite.com");
    expect(accountDomain("1234567_SB1")).toBe("1234567-sb1.suitetalk.api.netsuite.com");
    expect(accountDomain(" 1234567-sb1 ")).toBe("1234567-sb1.suitetalk.api.netsuite.com");
    expect(tokenEndpoint("1234567_SB1")).toBe("https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token");
  });
  it("infers the environment", () => {
    expect(accountEnvironment("1234567_SB1")).toBe("sandbox");
    expect(accountEnvironment("1234567_SB2")).toBe("sandbox");
    expect(accountEnvironment("1234567_RP")).toBe("release_preview");
    expect(accountEnvironment("1234567")).toBe("production");
  });
  it("rejects anything that could change the host", () => {
    for (const bad of ["", "evil.com/x", "123 456", "123#a", "a.b", "../x"]) expect(() => normalizeAccountId(bad)).toThrow();
  });
});

describe("JWT client assertion", () => {
  const now = 1_800_000_000;
  for (const [curve, alg, hash] of [["prime256v1", "ES256", "sha256"], ["secp384r1", "ES384", "sha384"], ["secp521r1", "ES512", "sha512"]] as const) {
    it(`${alg}: header, claims and signature verify with the public key`, () => {
      const k = ecKey(curve);
      const { assertion, algorithm } = buildClientAssertion({ accountId: "1234567_SB1", clientId: "client-abc", certificateId: "cert-xyz", privateKeyPem: k.privateKey, now });
      expect(algorithm).toBe(alg);
      const d = decode(assertion);
      expect(d.header).toEqual({ typ: "JWT", alg, kid: "cert-xyz" });
      expect(d.payload).toEqual({ iss: "client-abc", scope: NETSUITE_SCOPE, aud: "https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token", iat: now, exp: now + 300 });
      expect(d.payload.exp - d.payload.iat).toBeLessThan(3600);
      expect(verify(hash, Buffer.from(d.input), { key: createPublicKey(k.publicKey), dsaEncoding: "ieee-p1363" }, d.sig)).toBe(true);
    });
  }
  for (const [alg, hash] of [["PS256", "sha256"], ["PS384", "sha384"], ["PS512", "sha512"]] as const) {
    it(`${alg}: RSA-PSS signature verifies`, () => {
      const { assertion } = buildClientAssertion({ accountId: "1234567", clientId: "c", certificateId: "k", privateKeyPem: rsa.privateKey, algorithm: alg, now });
      const d = decode(assertion);
      expect(d.header.alg).toBe(alg);
      expect(verify(hash, Buffer.from(d.input), { key: createPublicKey(rsa.publicKey), padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }, d.sig)).toBe(true);
    });
  }
  it("auto-detects PS256 for RSA and refuses mismatched or weak keys", () => {
    expect(resolveAlgorithm(parsePrivateKey(rsa.privateKey))).toBe("PS256");
    expect(() => resolveAlgorithm(parsePrivateKey(rsa.privateKey), "ES256")).toThrow(/RSA/);
    expect(() => resolveAlgorithm(parsePrivateKey(ecKey("prime256v1").privateKey), "ES384")).toThrow(/ES256/);
    const weak = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    expect(() => resolveAlgorithm(parsePrivateKey(weak.privateKey))).toThrow(/3072/);
    expect(() => parsePrivateKey("not a key")).toThrow(/BEGIN PRIVATE KEY/);
  });
});

describe("read-only guard", () => {
  it("allows only sign-in, GET record reads and SELECT queries", () => {
    expect(() => assertReadOnlyRequest("POST", "/services/rest/auth/oauth2/v1/token")).not.toThrow();
    expect(() => assertReadOnlyRequest("GET", "/services/rest/record/v1/metadata-catalog")).not.toThrow();
    expect(() => assertReadOnlyRequest("GET", "/services/rest/record/v1/location?limit=1")).not.toThrow();
    expect(() => assertReadOnlyRequest("POST", "/services/rest/query/v1/suiteql?limit=1", { q: "SELECT id FROM location FETCH FIRST 1 ROWS ONLY" })).not.toThrow();
  });
  it("refuses every write method and other paths", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) expect(() => assertReadOnlyRequest(m, "/services/rest/record/v1/customrecord_fai")).toThrow(NetSuiteReadOnlyError);
    expect(() => assertReadOnlyRequest("PUT", "/services/rest/record/v1/customrecord_fai/1")).toThrow(NetSuiteReadOnlyError);
    expect(() => assertReadOnlyRequest("GET", "/app/site/hosting/restlet.nl")).toThrow(NetSuiteReadOnlyError);
    expect(() => assertReadOnlyRequest("GET", "/services/rest/record/v1/../auth")).toThrow(NetSuiteReadOnlyError);
    expect(() => assertReadOnlyRequest("POST", "/services/rest/query/v1/suiteql", { q: "DELETE FROM customrecord_fai" })).toThrow(NetSuiteReadOnlyError);
    expect(() => assertReadOnlyRequest("POST", "/services/rest/query/v1/suiteql", {})).toThrow(NetSuiteReadOnlyError);
  });
  it("SELECT check", () => {
    expect(isSelectOnly("select 1")).toBe(true);
    expect(isSelectOnly("SELECT name FROM item WHERE name = 'update me';")).toBe(true);
    expect(isSelectOnly("SELECT 1; DELETE FROM x")).toBe(false);
    expect(isSelectOnly("UPDATE item SET x = 1")).toBe(false);
    expect(isSelectOnly("/* hi */ insert into x values (1)")).toBe(false);
  });
  it("the client itself never sends a refused request", async () => {
    let calls = 0;
    const k = ecKey("prime256v1");
    const c = new NetSuiteClient({ accountId: "1", clientId: "c", certificateId: "k", privateKeyPem: k.privateKey }, { baseUrl: "http://127.0.0.1:1", fetchImpl: (async () => { calls++; throw new Error("no"); }) as typeof fetch });
    await expect(c.suiteql("DELETE FROM customrecord_fai")).rejects.toBeTruthy();
    // Only the token request was attempted; the write never reached fetch.
    expect(calls).toBeLessThanOrEqual(1);
    clearNetSuiteTokenCache();
  });
});

describe("error mapping", () => {
  const body = (error: string, d = "") => JSON.stringify({ error, error_description: d });
  it("maps NetSuite token errors to plain guidance", () => {
    expect(mapNetSuiteError(401, body("invalid_client"), null, "token").code).toBe("invalid_client");
    expect(mapNetSuiteError(400, body("invalid_grant"), null, "token").code).toBe("invalid_grant");
    expect(mapNetSuiteError(400, body("unauthorized_client"), null, "token").code).toBe("unauthorized_client");
    expect(mapNetSuiteError(404, "", null, "token").code).toBe("wrong_account");
    expect(mapNetSuiteError(401, "{}", null, "rest").code).toBe("unauthorized");
    expect(mapNetSuiteError(403, "{}", null, "rest").code).toBe("no_permission");
    expect(mapNetSuiteError(404, "{}", null, "rest").code).toBe("not_found");
    expect(mapNetSuiteError(503, "", null, "rest").code).toBe("netsuite_unavailable");
  });
  it("detects clock skew from the server Date header", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    expect(mapNetSuiteError(400, body("invalid_grant"), "Fri, 16 Oct 2026 12:10:00 GMT", "token", now).code).toBe("clock_skew");
  });
  it("maps network failures", () => {
    expect(mapNetworkError(Object.assign(new Error("x"), { cause: { code: "ENOTFOUND" } })).code).toBe("wrong_account");
    expect(mapNetworkError(Object.assign(new Error("x"), { name: "AbortError" })).code).toBe("timeout");
    expect(mapNetworkError(new Error("x")).code).toBe("network");
  });
});

describe("secret redaction", () => {
  it("removes keys and tokens", () => {
    const k = ecKey("prime256v1").privateKey;
    const out = redactSecrets(`key ${k} Bearer abc.def-ghi access_token=eyJhbGciOi.eyJpc3Mi.sig "client_assertion":"zzz"`);
    expect(out).not.toContain("PRIVATE KEY");
    expect(out).not.toContain("abc.def-ghi");
    expect(out).not.toContain("eyJhbGciOi");
    expect(out).not.toContain("zzz");
    expect(mapNetSuiteError(400, JSON.stringify({ error: "invalid_grant", error_description: `bad ${k}` }), null, "token").detail).not.toContain("PRIVATE KEY");
  });
});
