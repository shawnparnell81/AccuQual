/**
 * www.accuqualqms.com and the apex host are the public marketing page.
 * app.accuqualqms.com is the application. Both names are served by the same
 * static site, so the split is decided here rather than by a different deploy.
 *
 * The inline script in apps/web/index.html uses the same host list so the
 * landing page can open before this bundle loads. Keep the two in sync.
 */
export const MARKETING_HOSTS = ["www.accuqualqms.com", "accuqualqms.com"] as const;

export const APP_ORIGIN = "https://app.accuqualqms.com";

/** Signed-out home on the marketing host. A real file, not an app route. */
export const MARKETING_HOME = "/welcome/index.html";

export function isMarketingHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return (MARKETING_HOSTS as readonly string[]).includes(host);
}

/**
 * Where a document on a marketing host should go. Null means stay: this is
 * the app host, or the request is already the landing page itself.
 * Sign-in pages go to the app. Everything else is the landing page, which
 * must not wait on a session check.
 */
export function marketingDocumentTarget(hostname: string, pathname: string, search = "", hash = ""): string | null {
  if (!isMarketingHost(hostname)) return null;
  if (pathname === "/welcome" || pathname.startsWith("/welcome/")) return null;
  if (pathname === "/login" || pathname === "/forgot-password" || pathname === "/reset-password") {
    return `${APP_ORIGIN}${pathname}${search}${hash}`;
  }
  return MARKETING_HOME;
}
