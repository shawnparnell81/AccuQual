import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, totpAt, totpCounter, verifyTotp } from "../src/utils/totp.js";

// RFC 6238 appendix B: the shared secret is ASCII "12345678901234567890"; the RFC lists 8-digit codes.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC 6238 SHA-1 test vectors", () => {
    const vectors: [number, string][] = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [seconds, expected] of vectors) {
      expect(totpAt(RFC_SECRET, totpCounter(seconds * 1000), 8)).toBe(expected);
    }
  });

  it("base32 round-trips", () => {
    const bytes = Buffer.from("hello, world — 你好");
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("accepts the current and adjacent step, rejects others", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const c = totpCounter(now);
    expect(verifyTotp(secret, totpAt(secret, c), null, now)).toBe(c);
    expect(verifyTotp(secret, totpAt(secret, c - 1), null, now)).toBe(c - 1);
    expect(verifyTotp(secret, totpAt(secret, c + 1), null, now)).toBe(c + 1);
    expect(verifyTotp(secret, totpAt(secret, c - 2), null, now)).toBeNull();
    expect(verifyTotp(secret, "000000x", null, now)).toBeNull();
    expect(verifyTotp(secret, "12345", null, now)).toBeNull();
  });

  it("refuses a code whose step was already used (replay)", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const c = totpCounter(now);
    const code = totpAt(secret, c);
    expect(verifyTotp(secret, code, c, now)).toBeNull();
    expect(verifyTotp(secret, code, c - 1, now)).toBe(c);
  });

  it("builds an otpauth URI authenticator apps understand", () => {
    const uri = otpauthUri("JBSWY3DPEHPK3PXP", "jane@acme.com");
    expect(uri).toContain("otpauth://totp/AccuQual:jane%40acme.com");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=AccuQual");
  });
});
