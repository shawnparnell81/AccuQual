import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const BLOCKED_NAMES = new Set(["localhost", "metadata", "metadata.google.internal"]);

/** True for loopback, link-local, private, and metadata addresses. Hostnames are checked by the caller. */
export function blockedAddress(address: string): boolean {
  const raw = address.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (!raw || BLOCKED_NAMES.has(raw) || raw.endsWith(".localhost") || raw.endsWith(".local") || /^\d+$/.test(raw)) return true;
  if (raw === "::1" || raw === "::" || raw === "0.0.0.0") return true;
  if (raw.startsWith("fe80:") || raw.startsWith("fc") || raw.startsWith("fd")) return true;
  const v4 = raw.startsWith("::ffff:") ? raw.slice("::ffff:".length) : raw;
  const parts = v4.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** Accepts only an http(s) URL whose host is not already a blocked address. */
export function logoUrlAllowed(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (blockedAddress(url.hostname)) return null;
  return url;
}

/** Resolves the host and refuses a public name that points at a private address. */
export async function assertPublicLogoUrl(raw: string): Promise<URL> {
  const url = logoUrlAllowed(raw);
  if (!url) throw new Error("blocked");
  if (isIP(url.hostname)) return url;
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (records.length === 0 || records.some((record) => blockedAddress(record.address))) throw new Error("blocked");
  return url;
}

/** Fetches a logo, following a few redirects and re-checking each target. */
export async function fetchPublicImage(raw: string): Promise<{ type: string; bytes: Buffer }> {
  let current = await assertPublicLogoUrl(raw);
  for (let hop = 0; hop < 3; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "image/*" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("redirect");
        current = await assertPublicLogoUrl(new URL(location, current).toString());
        continue;
      }
      if (response.status !== 200) throw new Error("status");
      const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      if (!type.startsWith("image/")) throw new Error("type");
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > MAX_LOGO_BYTES) throw new Error("size");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES) throw new Error("size");
      return { type, bytes };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("redirects");
}
