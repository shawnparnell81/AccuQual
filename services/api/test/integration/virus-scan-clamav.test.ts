import { beforeAll, describe, expect, it } from "vitest";
import { scanBuffer, scannerStatus } from "../../src/lib/virusScan.js";
import { EICAR } from "../helpers/fakeClamd.js";

/**
 * Runs against a real ClamAV, and only when one is reachable (CLAMD_HOST / CLAMD_PORT, default 127.0.0.1:3310).
 * Without ClamAV every test here is skipped, so a machine without it still passes. The unit tests in
 * virus-scan-unit.test.ts cover the same client against a fake clamd.
 *
 * To run it locally:  docker run -d -p 3310:3310 clamav/clamav   (then CLAMD_PORT=3310 npx vitest run test/integration/virus-scan-clamav.test.ts)
 */
let available = false;
const saved = { enabled: process.env.VIRUS_SCAN_ENABLED };

beforeAll(async () => {
  process.env.VIRUS_SCAN_ENABLED = "true";
  available = (await scannerStatus()).up;
  if (!available) console.warn("ClamAV is not reachable; skipping the real-ClamAV test.");
});

describe("real ClamAV", () => {
  it("is up and reports its definitions date", async (ctx) => {
    if (!available) return ctx.skip();
    const status = await scannerStatus();
    expect(status.up).toBe(true);
    expect(status.engine).toMatch(/^ClamAV/);
    expect(new Date(status.definitionsDate ?? "").getTime()).toBeGreaterThan(Date.parse("2024-01-01"));
  });

  it("flags the EICAR test file by name and passes a clean file", async (ctx) => {
    if (!available) return ctx.skip();
    const infected = await scanBuffer(Buffer.from(EICAR));
    expect(infected.status).toBe("infected");
    expect(infected.status === "infected" && infected.virus).toMatch(/EICAR/i);
    expect(await scanBuffer(Buffer.from("A perfectly ordinary document."))).toEqual({ status: "clean" });
  });

  it("finds EICAR inside a zip, as a Word file is", async (ctx) => {
    if (!available) return ctx.skip();
    const { officePackage } = await import("../../src/modules/form-builder/docx.js");
    const docx = officePackage([{ name: "word/document.xml", data: Buffer.from("<w:document/>") }, { name: "word/media/note.txt", data: Buffer.from(EICAR) }]);
    expect((await scanBuffer(docx)).status).toBe("infected");
  });
});

process.on("exit", () => {
  if (saved.enabled === undefined) delete process.env.VIRUS_SCAN_ENABLED;
});
