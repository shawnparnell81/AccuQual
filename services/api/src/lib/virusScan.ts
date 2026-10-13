import net from "node:net";
import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";

/**
 * Virus scanning through ClamAV's clamd daemon, speaking its INSTREAM protocol over a socket (no extra
 * dependency). Every function here reads its settings when it is called, so a test or an operator can
 * change them without restarting the module.
 *
 *   VIRUS_SCAN_ENABLED  "true" / "false". Unset means on in production and off everywhere else, so local
 *                       development and tests run without ClamAV.
 *   CLAMD_SOCKET        a unix socket path, if clamd listens on one.
 *   CLAMD_HOST / CLAMD_PORT   otherwise a TCP address. Defaults to 127.0.0.1:3310, which is where the API
 *                       image starts clamd.
 */
export type ScanResult = { status: "clean" } | { status: "infected"; virus: string } | { status: "error"; message: string };

const CHUNK_BYTES = 64 * 1024;
const CONNECT_TIMEOUT_MS = 5_000;
const SCAN_TIMEOUT_MS = 120_000;
/** clamd takes a while to load its signatures after a (re)start. A few quick retries ride out that window. */
const CONNECT_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;

export function virusScanEnabled(): boolean {
  const flag = process.env.VIRUS_SCAN_ENABLED?.trim().toLowerCase();
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  return process.env.NODE_ENV === "production";
}

function target(): net.NetConnectOpts {
  const socketPath = process.env.CLAMD_SOCKET?.trim();
  if (socketPath) return { path: socketPath };
  const port = Number(process.env.CLAMD_PORT) || 3310;
  return { host: process.env.CLAMD_HOST?.trim() || "127.0.0.1", port };
}

function connect(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(target());
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out connecting to the virus scanner."));
    }, CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      // A later socket error is reported through the reply or the write that was in flight, never as an uncaught event.
      socket.on("error", () => undefined);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function connectWithRetry(): Promise<net.Socket> {
  let last: unknown;
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    try {
      return await connect();
    } catch (err) {
      last = err;
      if (attempt < CONNECT_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  throw last instanceof Error ? last : new Error("The virus scanner is not reachable.");
}

/** Collects clamd's reply, which ends with a NUL (the "z" command prefix) or when clamd closes the socket. */
function readReply(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("The virus scanner took too long to answer."));
    }, SCAN_TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timer);
      resolve(data.replace(/\0+$/, "").trim());
    };
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.includes("\0")) finish();
    });
    socket.once("end", finish);
    socket.once("close", finish);
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function writeAll(socket: net.Socket, chunk: Buffer): Promise<void> {
  if (socket.destroyed) return;
  if (!socket.write(chunk)) await new Promise<void>((resolve) => socket.once("drain", resolve).once("close", resolve).once("error", () => resolve()));
}

async function* chunksOf(source: Buffer | Readable): AsyncGenerator<Buffer> {
  if (Buffer.isBuffer(source)) {
    for (let offset = 0; offset < source.length; offset += CHUNK_BYTES) yield source.subarray(offset, offset + CHUNK_BYTES);
    return;
  }
  for await (const piece of source) {
    const buf = Buffer.isBuffer(piece) ? piece : Buffer.from(piece as string);
    for (let offset = 0; offset < buf.length; offset += CHUNK_BYTES) yield buf.subarray(offset, offset + CHUNK_BYTES);
  }
}

/** Turns clamd's one-line reply into a result. "stream: Eicar-Signature FOUND" is infected; "stream: OK" is clean; anything else is an error. */
export function parseScanReply(reply: string): ScanResult {
  const text = reply.trim();
  const found = /^[^:]*:\s*(.+?)\s+FOUND$/i.exec(text);
  if (found) return { status: "infected", virus: found[1]! };
  if (/:\s*OK$/i.test(text) || text === "OK") return { status: "clean" };
  return { status: "error", message: text || "The virus scanner gave no answer." };
}

async function instream(source: Buffer | Readable): Promise<ScanResult> {
  let socket: net.Socket | null = null;
  try {
    socket = await connectWithRetry();
    const reply = readReply(socket);
    reply.catch(() => undefined);
    await writeAll(socket, Buffer.from("zINSTREAM\0"));
    for await (const chunk of chunksOf(source)) {
      const header = Buffer.alloc(4);
      header.writeUInt32BE(chunk.length, 0);
      await writeAll(socket, Buffer.concat([header, chunk]));
      if (socket.destroyed) break;
    }
    if (!socket.destroyed) await writeAll(socket, Buffer.alloc(4));
    return parseScanReply(await reply);
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "The virus scanner failed." };
  } finally {
    socket?.destroy();
  }
}

/** Scans bytes already in memory. Never throws: a scanner problem comes back as status "error". */
export function scanBuffer(buffer: Buffer): Promise<ScanResult> {
  return instream(buffer);
}

/** Scans a file on disk by streaming it, so a large upload is never held in memory twice. */
export function scanFile(path: string): Promise<ScanResult> {
  return instream(createReadStream(path));
}

async function command(word: string): Promise<string> {
  const socket = await connect();
  try {
    const reply = readReply(socket);
    reply.catch(() => undefined);
    socket.write(`z${word}\0`);
    return await reply;
  } finally {
    socket.destroy();
  }
}

export interface ScannerStatus {
  /** VIRUS_SCAN_ENABLED resolves to on. */
  enabled: boolean;
  /** clamd answered PING. Always false when scanning is off. */
  up: boolean;
  engine?: string;
  definitionsVersion?: string;
  /** When the virus definitions were published (ISO), from clamd's own version line. */
  definitionsDate?: string;
  error?: string;
}

/** "ClamAV 1.4.3/27800/Tue Oct 13 07:25:00 2026" -> engine, definitions number and date. */
export function parseVersionLine(line: string): { engine?: string; definitionsVersion?: string; definitionsDate?: string } {
  const [engine, version, published] = line.trim().split("/");
  const date = published ? new Date(`${published} UTC`) : null;
  return {
    engine: engine || undefined,
    definitionsVersion: version || undefined,
    definitionsDate: date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined,
  };
}

/** For the Admin health details: is scanning on, is clamd up, and how old are its definitions. */
export async function scannerStatus(): Promise<ScannerStatus> {
  const enabled = virusScanEnabled();
  if (!enabled) return { enabled, up: false };
  try {
    if ((await command("PING")) !== "PONG") return { enabled, up: false, error: "The virus scanner did not answer PING." };
    return { enabled, up: true, ...parseVersionLine(await command("VERSION")) };
  } catch (err) {
    return { enabled, up: false, error: err instanceof Error ? err.message : "The virus scanner is not reachable." };
  }
}
