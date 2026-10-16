import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import {
  PIN_MAX_ATTEMPTS,
  formatSignatureStamp,
  hashPin,
  missingPinBlocks,
  pinMatches,
  PinRepeatGuard,
  pinLockActive,
  retainSignatureValues,
  writeSignatureValue,
} from "../src/modules/signatures/signaturePin.js";

describe("signature PIN", () => {
  it("stores a hash that verifies the PIN and rejects a wrong one", async () => {
    const hash = await hashPin("1357");
    expect(hash).not.toBe("1357");
    expect(hash.startsWith("$2")).toBe(true);
    expect(await pinMatches("1357", hash)).toBe(true);
    expect(await pinMatches("9999", hash)).toBe(false);
    expect(await pinMatches("1357", null)).toBe(false);
    expect(await pinMatches("135", hash)).toBe(false);
    expect(await bcrypt.compare("1357", hash)).toBe(true);
  });

  it("locks at the fifth wrong PIN in a row and stays locked until reset", () => {
    const now = new Date("2026-09-30T12:00:00Z");
    for (let count = 0; count < PIN_MAX_ATTEMPTS; count++) expect(pinLockActive({ count, lockedUntil: null }, now)).toBe(false);
    expect(PIN_MAX_ATTEMPTS).toBe(5);
    expect(pinLockActive({ count: 5, lockedUntil: null }, new Date("2030-01-01T00:00:00Z"))).toBe(true);
    expect(pinLockActive({ count: 0, lockedUntil: new Date("2026-09-30T12:05:00Z") }, now)).toBe(true);
    expect(pinLockActive({ count: 0, lockedUntil: new Date("2026-09-30T11:55:00Z") }, now)).toBe(false);
  });

  it("treats the same wrong PIN repeated within seconds as one attempt and shares overlapping checks", async () => {
    const guard = new PinRepeatGuard();
    const key = guard.key(7, "1111");
    expect(key).not.toContain("1111");
    expect(guard.key(8, "1111")).not.toBe(key);
    expect(guard.isRepeat(key, 1000)).toBe(false);
    guard.remember(key, 1000);
    expect(guard.isRepeat(key, 5000)).toBe(true);
    expect(guard.isRepeat(key, 11_000)).toBe(false);
    guard.forgetUser([key]);
    expect(guard.isRepeat(key, 2000)).toBe(false);
    let runs = 0;
    const work = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 20));
      return runs;
    };
    const [a, b] = await Promise.all([guard.once(key, work), guard.once(key, work)]);
    expect(runs).toBe(1);
    expect(a).toBe(b);
  });

  it("stamps the display name with the company time and keeps that stamp on a later save", () => {
    const signedAt = new Date("2026-09-30T16:05:00Z");
    const stamp = formatSignatureStamp("Shawn Parnell", signedAt, "America/New_York");
    expect(stamp.startsWith("Shawn Parnell — ")).toBe(true);
    expect(stamp).toContain("2026");
    expect(stamp).toMatch(/EDT|EST/);

    const written = writeSignatureValue({ signoffs: [{}] }, "signoffs.0.signature", stamp, "2026-09-30");
    const row = (written.signoffs as { signature: string; date: string }[])[0]!;
    expect(row.signature).toBe(stamp);
    expect(row.date).toBe("2026-09-30");

    const saved = retainSignatureValues(written, { signoffs: [{ signature: "forged name", date: "2026-09-30", note: "kept" }] });
    const kept = (saved.signoffs as { signature: string; note: string }[])[0]!;
    expect(kept.signature).toBe(stamp);
    expect(kept.note).toBe("kept");
  });

  it("refuses a path that is not a signature field", () => {
    expect(() => writeSignatureValue({}, "title", "x", "2026-09-30")).toThrow(/not recognized/);
  });

  it("blocks the app until a PIN is set, and leaves the setup routes open", () => {
    expect(missingPinBlocks(false, "/ncr", true)).toBe(true);
    expect(missingPinBlocks(false, "/auth/signature-pin", true)).toBe(false);
    expect(missingPinBlocks(false, "/auth/me", true)).toBe(false);
    expect(missingPinBlocks(false, "/ncr", false)).toBe(false);
    expect(missingPinBlocks(true, "/ncr", true)).toBe(false);
  });
});
