import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import {
  PIN_MAX_ATTEMPTS,
  formatSignatureStamp,
  hashPin,
  missingPinBlocks,
  pinMatches,
  registerPinFailure,
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

  it("does not stamp after repeated wrong PINs and locks on the fifth", () => {
    let state = { count: 0, lockedUntil: null as Date | null };
    const now = new Date("2026-09-30T12:00:00Z");
    for (let attempt = 0; attempt < PIN_MAX_ATTEMPTS - 1; attempt++) {
      const next = registerPinFailure(state, now);
      expect(next.justLocked).toBe(false);
      expect(next.lockedUntil).toBeNull();
      state = next;
    }
    const locked = registerPinFailure(state, now);
    expect(locked.justLocked).toBe(true);
    expect(locked.count).toBe(0);
    expect(locked.lockedUntil!.getTime() - now.getTime()).toBe(15 * 60 * 1000);
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
