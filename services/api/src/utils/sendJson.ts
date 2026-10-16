import { gzipSync } from "node:zlib";
import type { Request, Response } from "express";

const MIN_GZIP = 32 * 1024;

/**
 * JSON reply that is gzipped when it is large and the browser accepts gzip. A Master list is
 * over 1.6 MB of JSON; gzipped it is about a tenth of that, so it opens much sooner on a slow link.
 */
export function sendJson(req: Request, res: Response, body: unknown) {
  const text = JSON.stringify(body);
  const accepts = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
  res.setHeader("Vary", "Accept-Encoding");
  if (!accepts || text.length < MIN_GZIP) {
    res.type("application/json").send(text);
    return;
  }
  res.setHeader("Content-Encoding", "gzip");
  res.type("application/json").send(gzipSync(Buffer.from(text), { level: 6 }));
}
