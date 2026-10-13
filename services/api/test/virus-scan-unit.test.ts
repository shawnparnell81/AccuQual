import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { parseScanReply, parseVersionLine, scanBuffer, scanFile, scannerStatus, virusScanEnabled } from "../src/lib/virusScan.js";
import { EICAR, EICAR_VIRUS_NAME, startFakeClamd, type FakeClamd } from "./helpers/fakeClamd.js";

let clamd: FakeClamd;
const saved = { ...process.env };

beforeAll(async () => {
  clamd = await startFakeClamd(new Date("2026-10-13T07:25:00Z"));
});

afterAll(async () => {
  await clamd.close();
});

afterEach(() => {
  clamd.setMode("normal");
  process.env.VIRUS_SCAN_ENABLED = "true";
  process.env.CLAMD_HOST = "127.0.0.1";
  process.env.CLAMD_PORT = String(clamd.port);
  delete process.env.CLAMD_SOCKET;
});

describe("virus scan client (clamd INSTREAM, against a fake clamd)", () => {
  beforeAll(() => {
    process.env.VIRUS_SCAN_ENABLED = "true";
    process.env.CLAMD_HOST = "127.0.0.1";
    process.env.CLAMD_PORT = String(clamd.port);
  });

  it("returns clean for an ordinary file", async () => {
    expect(await scanBuffer(Buffer.from("just a procedure document"))).toEqual({ status: "clean" });
  });

  it("returns infected with the virus name for the EICAR test string", async () => {
    expect(await scanBuffer(Buffer.from(EICAR))).toEqual({ status: "infected", virus: EICAR_VIRUS_NAME });
    // EICAR in the middle of other bytes is still found.
    expect(await scanBuffer(Buffer.concat([Buffer.alloc(100_000, 65), Buffer.from(EICAR), Buffer.alloc(100_000, 66)]))).toEqual({ status: "infected", virus: EICAR_VIRUS_NAME });
  });

  it("streams a large buffer in several chunks", async () => {
    expect(await scanBuffer(Buffer.alloc(3 * 1024 * 1024, 7))).toEqual({ status: "clean" });
  });

  it("scans a file on disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scan-"));
    try {
      await writeFile(join(dir, "ok.txt"), "fine");
      await writeFile(join(dir, "bad.txt"), EICAR);
      expect(await scanFile(join(dir, "ok.txt"))).toEqual({ status: "clean" });
      expect(await scanFile(join(dir, "bad.txt"))).toEqual({ status: "infected", virus: EICAR_VIRUS_NAME });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns an error, never a throw, when clamd replies ERROR or drops the connection", async () => {
    clamd.setMode("error-reply");
    const replied = await scanBuffer(Buffer.from("x"));
    expect(replied.status).toBe("error");
    clamd.setMode("drop");
    const dropped = await scanBuffer(Buffer.from("x"));
    expect(dropped.status).toBe("error");
  });

  it("returns an error when nothing is listening", async () => {
    process.env.CLAMD_PORT = "1";
    const result = await scanBuffer(Buffer.from("x"));
    expect(result.status).toBe("error");
  }, 20_000);

  it("reports status: up with the definitions date, and down when unreachable", async () => {
    const up = await scannerStatus();
    expect(up).toMatchObject({ enabled: true, up: true, engine: "ClamAV 1.4.6", definitionsVersion: "28152" });
    expect(up.definitionsDate).toBe("2026-10-13T07:25:00.000Z");
    process.env.CLAMD_PORT = "1";
    const down = await scannerStatus();
    expect(down).toMatchObject({ enabled: true, up: false });
    expect(down.error).toBeTruthy();
  });
});

describe("virus scan settings and parsing", () => {
  it("VIRUS_SCAN_ENABLED wins; unset means on only in production", () => {
    process.env.VIRUS_SCAN_ENABLED = "false";
    expect(virusScanEnabled()).toBe(false);
    process.env.VIRUS_SCAN_ENABLED = "true";
    expect(virusScanEnabled()).toBe(true);
    delete process.env.VIRUS_SCAN_ENABLED;
    process.env.NODE_ENV = "production";
    expect(virusScanEnabled()).toBe(true);
    process.env.NODE_ENV = "development";
    expect(virusScanEnabled()).toBe(false);
    process.env.NODE_ENV = saved.NODE_ENV;
  });

  it("an off scanner reports enabled: false and never connects", async () => {
    process.env.VIRUS_SCAN_ENABLED = "false";
    expect(await scannerStatus()).toEqual({ enabled: false, up: false });
  });

  it("parses clamd replies", () => {
    expect(parseScanReply("stream: OK")).toEqual({ status: "clean" });
    expect(parseScanReply("stream: Win.Test.EICAR_HDB-1 FOUND")).toEqual({ status: "infected", virus: "Win.Test.EICAR_HDB-1" });
    expect(parseScanReply("INSTREAM size limit exceeded. ERROR").status).toBe("error");
    expect(parseScanReply("").status).toBe("error");
    expect(parseVersionLine("ClamAV 1.4.6/28152/Tue Oct 13 07:25:00 2026")).toEqual({ engine: "ClamAV 1.4.6", definitionsVersion: "28152", definitionsDate: "2026-10-13T07:25:00.000Z" });
  });
});
