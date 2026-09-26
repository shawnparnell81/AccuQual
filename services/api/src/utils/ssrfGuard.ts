import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "./appError.js";

const BLOCKED_HOSTNAMES = new Set(["localhost"]);

function isPrivateIp(ip: string): boolean {
  if (ip === "0.0.0.0" || ip === "::" || ip === "::1") return true;
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 — includes the cloud metadata endpoint
    return false;
  }
  const lower = ip.toLowerCase();
  return lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80"); // IPv6 unique-local / link-local
}

/**
 * Security-audit finding (S2, high): blocks SSRF via a company-configurable
 * outbound webhook URL — resolves the hostname and rejects any target that
 * resolves to a loopback/private/link-local address (including
 * 169.254.169.254, the cloud metadata endpoint), not just an obviously-local
 * hostname string, which a DNS record can trivially point around. The threat
 * model here is a malicious/compromised company admin's *configured* URL, not
 * a live DNS-rebinding attacker racing this check against the request that
 * follows it — that would need a second resolve-and-compare at connect time,
 * which Node's fetch doesn't expose a hook for.
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw AppError.badRequest("Webhook URL is not a valid URL");
  }
  if (url.protocol !== "https:") {
    throw AppError.badRequest("Webhook URL must use https:");
  }
  if (BLOCKED_HOSTNAMES.has(url.hostname.toLowerCase())) {
    throw AppError.badRequest("Webhook URL may not target a local hostname");
  }
  // WHATWG URL.hostname keeps the brackets around an IPv6 literal
  // ("[::1]"), but net.isIP() (and every address-shaped check above) needs
  // them stripped — found via a real CI failure: Linux's dns.lookup()
  // correctly rejects "[::1]" as an invalid hostname (ENOTFOUND), while
  // Windows silently tolerates and resolves it anyway, masking the bug
  // locally. Without this, every IPv6-literal webhook URL — private or
  // genuinely public — fell through to a DNS lookup that can never succeed.
  const bareHost = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(bareHost)) {
    if (isPrivateIp(bareHost)) throw AppError.badRequest("Webhook URL may not target a private or reserved address");
    return;
  }
  const { address } = await lookup(url.hostname);
  if (isPrivateIp(address)) {
    throw AppError.badRequest("Webhook URL resolves to a private or reserved address");
  }
}
