import net from "node:net";

/** The standard EICAR antivirus test string, built from two halves so a developer's own antivirus does not quarantine this file. */
export const EICAR = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}", "$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join("");
export const EICAR_VIRUS_NAME = "Win.Test.EICAR_HDB-1";

export type FakeClamdMode = "normal" | "error-reply" | "drop";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** clamd's VERSION line: "ClamAV 1.4.6/28152/Tue Oct 13 07:25:00 2026". */
function versionLine(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = `${DAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} ${date.getUTCFullYear()}`;
  return `ClamAV 1.4.6/28152/${stamp}`;
}

export interface FakeClamd {
  port: number;
  /** How many INSTREAM scans were run. */
  scans: () => number;
  setMode: (mode: FakeClamdMode) => void;
  close: () => Promise<void>;
}

/** Splits clamd's INSTREAM stream (length-prefixed chunks ending with a zero length) and returns the file bytes once complete. */
function readInstream(buffer: Buffer): { done: boolean; data: Buffer } {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (length === 0) return { done: true, data: Buffer.concat(parts) };
    if (offset + 4 + length > buffer.length) break;
    parts.push(buffer.subarray(offset + 4, offset + 4 + length));
    offset += 4 + length;
  }
  return { done: false, data: Buffer.alloc(0) };
}

/**
 * A stand-in for clamd that speaks the same protocol the API uses (PING, VERSION, INSTREAM) and flags the EICAR
 * string, so the real client code is exercised without ClamAV installed.
 */
export async function startFakeClamd(definitionsDate: Date = new Date()): Promise<FakeClamd> {
  let mode: FakeClamdMode = "normal";
  let scans = 0;
  const server = net.createServer((socket) => {
    let pending = Buffer.alloc(0);
    socket.on("error", () => undefined);
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      const text = pending.toString("latin1");
      if (text.startsWith("zPING\0")) {
        socket.end("PONG\0");
        return;
      }
      if (text.startsWith("zVERSION\0")) {
        socket.end(`${versionLine(definitionsDate)}\0`);
        return;
      }
      const prefix = "zINSTREAM\0";
      if (!text.startsWith(prefix)) return;
      const stream = readInstream(pending.subarray(prefix.length));
      if (!stream.done) return;
      scans += 1;
      if (mode === "drop") {
        socket.destroy();
        return;
      }
      if (mode === "error-reply") {
        socket.end("INSTREAM size limit exceeded. ERROR\0");
        return;
      }
      socket.end(stream.data.includes(Buffer.from(EICAR)) ? `stream: ${EICAR_VIRUS_NAME} FOUND\0` : "stream: OK\0");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    scans: () => scans,
    setMode: (next) => {
      mode = next;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
