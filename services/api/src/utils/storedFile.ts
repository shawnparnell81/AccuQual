import { createReadStream, existsSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import type { Response } from "express";
import { isInsideStorage } from "../modules/documents/documentVersioning.js";
import { AppError } from "./appError.js";
import { inlineMime } from "./fileSniff.js";

async function readFileHead(filePath: string, length = 16): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function asciiFileName(fileName: string): string {
  const cleaned = fileName.replace(/[\r\n"]/g, "_").replace(/[^\x20-\x7e]/g, "_");
  return cleaned.slice(0, 180) || "download";
}

/**
 * Sends a stored upload. Images and PDFs may be shown in the browser.
 * Everything else, and every template, is a download. The sandbox policy
 * stops a file from running as a page if someone opens the link directly.
 */
export async function sendStoredFile(
  res: Response,
  filePath: string,
  fileName: string,
  storedMime: string | null | undefined,
  mode: "preview" | "download",
): Promise<void> {
  if (!isInsideStorage(filePath) || !existsSync(filePath)) throw AppError.notFound("File");
  const head = await readFileHead(filePath);
  const sniffed = inlineMime(head);
  const inline = mode === "preview" && sniffed !== null;
  const unsafeStored = storedMime != null && /html|svg|xml|javascript/i.test(storedMime);
  const contentType = sniffed ?? (storedMime && !unsafeStored ? storedMime : "application/octet-stream");
  const size = (await stat(filePath)).size;
  const disposition = inline ? "inline" : "attachment";
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", String(size));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", `${disposition}; filename="${asciiFileName(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  createReadStream(filePath).pipe(res);
}
