export type DeviceType = "desktop" | "mobile" | "tablet";

export interface ParsedUserAgent {
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  deviceType: DeviceType;
}

/** Major version only, so the history reads "Chrome 129" rather than a long build number. */
function major(version: string | undefined): string | null {
  if (!version) return null;
  const head = version.split(".")[0];
  return head && /^\d+$/.test(head) ? head : null;
}

function match(ua: string, pattern: RegExp): string | null {
  return major(pattern.exec(ua)?.[1]);
}

/**
 * Browser name and major version. Edge and Opera include "Chrome" in the
 * string, so those are checked first. Safari's version is the Version token,
 * not the Safari token.
 */
function browserOf(ua: string): { name: string | null; version: string | null } {
  if (/Edg\//.test(ua) || /Edge\//.test(ua)) return { name: "Edge", version: match(ua, /Edg(?:e)?\/(\d+)/) };
  if (/OPR\/|Opera/.test(ua)) return { name: "Opera", version: match(ua, /(?:OPR|Opera)\/(\d+)/) };
  if (/Chromium\//.test(ua)) return { name: "Chromium", version: match(ua, /Chromium\/(\d+)/) };
  if (/Chrome\//.test(ua)) return { name: "Chrome", version: match(ua, /Chrome\/(\d+)/) };
  if (/Firefox\//.test(ua)) return { name: "Firefox", version: match(ua, /Firefox\/(\d+)/) };
  if (/Safari\//.test(ua)) return { name: "Safari", version: match(ua, /Version\/(\d+)/) };
  return { name: null, version: null };
}

/** Windows 11 still sends "Windows NT 10.0". The platform-version hint is 13 or higher for Windows 11. */
export function isWindows11(platformVersion: string | null | undefined): boolean {
  if (!platformVersion) return false;
  const majorVersion = Number.parseInt(platformVersion.replace(/"/g, "").trim().split(".")[0] ?? "", 10);
  return Number.isFinite(majorVersion) && majorVersion >= 13;
}

function osOf(ua: string, platformVersion: string | null | undefined): string | null {
  if (/Windows 11/.test(ua) || (/Windows NT 10\.0/.test(ua) && isWindows11(platformVersion))) return "Windows 11";
  if (/Windows NT 10\.0/.test(ua)) return "Windows 10";
  if (/Windows NT 6\.3/.test(ua)) return "Windows 8.1";
  if (/Windows NT 6\.2/.test(ua)) return "Windows 8";
  if (/Windows NT 6\.1/.test(ua)) return "Windows 7";
  if (/Windows/.test(ua)) return "Windows";

  const ios = /(?:CPU )?iPhone OS (\d+)[_.](\d+)|CPU OS (\d+)[_.](\d+)/.exec(ua);
  if (/iPhone|iPad|iPod/.test(ua)) {
    const version = ios?.[1] ?? ios?.[3];
    return version ? `iOS ${version}` : "iOS";
  }

  const android = /Android (\d+)/.exec(ua);
  if (android) return `Android ${android[1]}`;

  const mac = /Mac OS X (\d+)[_.](\d+)/.exec(ua);
  if (mac) return `macOS ${mac[1]}.${mac[2]}`;
  if (/Mac OS X/.test(ua)) return "macOS";

  if (/CrOS/.test(ua)) return "Chrome OS";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

function deviceOf(ua: string): DeviceType {
  if (/iPad|Tablet|PlayBook|Silk\//.test(ua)) return "tablet";
  if (/Android/.test(ua) && !/Mobile/.test(ua)) return "tablet";
  if (/Mobile|iPhone|iPod|Android/.test(ua)) return "mobile";
  return "desktop";
}

export function parseUserAgent(userAgent: string | null | undefined, platformVersion?: string | null): ParsedUserAgent {
  const ua = userAgent?.trim() ?? "";
  if (!ua) return { browser: null, browserVersion: null, os: null, deviceType: "desktop" };
  const browser = browserOf(ua);
  return {
    browser: browser.name,
    browserVersion: browser.version,
    os: osOf(ua, platformVersion),
    deviceType: deviceOf(ua),
  };
}

export function deviceLabel(parsed: { browser: string | null; browserVersion: string | null; os: string | null; deviceType: string | null }): string {
  if (!parsed.browser && !parsed.os && !parsed.deviceType) return "";
  const browser = parsed.browser ? (parsed.browserVersion ? `${parsed.browser} ${parsed.browserVersion}` : parsed.browser) : "Unknown browser";
  const os = parsed.os ?? "Unknown OS";
  const kind = parsed.deviceType === "mobile" ? "Mobile" : parsed.deviceType === "tablet" ? "Tablet" : "Desktop";
  return `${browser} on ${os}, ${kind}`;
}
