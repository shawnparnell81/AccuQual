import { AppError } from "../../utils/appError.js";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

export interface DownloadAllowlist {
  /** Browser-facing document server, e.g. http://localhost:8080 */
  publicBase: string;
  /** Address the API uses to reach the document server, e.g. http://onlyoffice */
  internalBase?: string;
}

function httpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw AppError.badRequest("Saved-file URL is not valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw AppError.badRequest("Saved-file URL must be http or https");
  if (url.username || url.password) throw AppError.badRequest("Saved-file URL must not include credentials");
  return url;
}

/**
 * The document server tells us where to fetch the saved bytes. That URL is only accepted when it
 * points at the configured document server. A loopback host (the server describing itself as
 * localhost from inside its own container) is rewritten onto the internal address first.
 */
export function resolveSavedFileUrl(raw: string, allowed: DownloadAllowlist): URL {
  let url = httpUrl(raw);
  const pub = httpUrl(allowed.publicBase);
  const internal = allowed.internalBase ? httpUrl(allowed.internalBase) : null;
  if (LOOPBACK.has(url.hostname) && internal && url.origin !== pub.origin && url.origin !== internal.origin) {
    url = new URL(url.pathname + url.search, internal.origin);
  }
  if (url.origin !== pub.origin && url.origin !== internal?.origin) {
    throw AppError.badRequest("Refusing to download a saved file from outside the document server");
  }
  return url;
}

/** Follows redirects only while each hop stays on the document server. */
export async function downloadSavedFile(raw: string, allowed: DownloadAllowlist, maxBytes: number): Promise<Buffer> {
  let current = raw;
  for (let hop = 0; hop < 3; hop++) {
    const url = resolveSavedFileUrl(current, allowed);
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw AppError.badRequest("Document server redirect had no location");
      current = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) throw AppError.badRequest("Document server did not return the saved file");
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > maxBytes) throw AppError.badRequest("The saved file is larger than 15 MB.");
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > maxBytes) throw AppError.badRequest("The saved file is larger than 15 MB.");
    return bytes;
  }
  throw AppError.badRequest("Document server redirected too many times");
}
