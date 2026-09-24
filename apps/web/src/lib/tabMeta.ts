/**
 * Derives a tab's title/icon purely from its route — no extra fetch, so
 * every normal navigation (existing links, back button) can update the
 * active tab without a network round trip. Not exhaustive: an unmatched
 * route falls back to the raw path with a generic icon rather than
 * guessing — still functional, just plain, matching this app's own
 * "explicit placeholder over guessed behavior" convention elsewhere.
 * Global search results carry their own real title (record data already
 * fetched for the results list) and skip this entirely — see openTab callers.
 */

interface RoutePattern {
  test: RegExp;
  icon: string;
  title: (match: RegExpMatchArray) => string;
}

const ROUTE_PATTERNS: RoutePattern[] = [
  { test: /^\/ncr\/(\d+)$/, icon: "ncr", title: (m) => `Issue #${m[1]}` },
  { test: /^\/ncr\/?$/, icon: "ncr", title: () => "Issues" },
  { test: /^\/capa\/(\d+)$/, icon: "capa", title: (m) => `Fix #${m[1]}` },
  { test: /^\/capa\/?$/, icon: "capa", title: () => "Fixes" },
  { test: /^\/8d/, icon: "capa", title: () => "8D reports" },
  { test: /^\/suppliers\/(\d+)$/, icon: "supplier", title: (m) => `Supplier #${m[1]}` },
  { test: /^\/suppliers\/?$/, icon: "supplier", title: () => "Suppliers" },
  { test: /^\/inventory\/(\d+)$/, icon: "inventory", title: (m) => `Item #${m[1]}` },
  { test: /^\/inventory\/?$/, icon: "inventory", title: () => "Inventory" },
  { test: /^\/audits\/(\d+)$/, icon: "audit", title: (m) => `Audit #${m[1]}` },
  { test: /^\/audits\/?$/, icon: "audit", title: () => "Audits" },
  { test: /^\/training\/employee\/(\d+)$/, icon: "training", title: () => "Employee Training" },
  { test: /^\/training\/(\d+)$/, icon: "training", title: (m) => `Course #${m[1]}` },
  { test: /^\/training\/?$/, icon: "training", title: () => "Training" },
  { test: /^\/calibration\/(\d+)$/, icon: "calibration", title: (m) => `Equipment #${m[1]}` },
  { test: /^\/calibration\/?$/, icon: "calibration", title: () => "Calibration" },
  { test: /^\/quarantine\/(\d+)$/, icon: "quarantine", title: (m) => `Hold #${m[1]}` },
  { test: /^\/quarantine\/?$/, icon: "quarantine", title: () => "Quarantine" },
  { test: /^\/erp\/(\d+)$/, icon: "erp", title: (m) => `PO #${m[1]}` },
  { test: /^\/erp\/?$/, icon: "erp", title: () => "ERP" },
  { test: /^\/rma\/(\d+)$/, icon: "rma", title: (m) => `RMA #${m[1]}` },
  { test: /^\/rma\/?$/, icon: "rma", title: () => "RMAs" },
  { test: /^\/digital-twin/, icon: "digitaltwin", title: () => "Digital Twin" },
  { test: /^\/documents/, icon: "documents", title: () => "Documents" },
  { test: /^\/quality/, icon: "quality", title: () => "Quality" },
  { test: /^\/complaints/, icon: "capa", title: () => "Complaints" },
  { test: /^\/change/, icon: "default", title: () => "Change Requests" },
  { test: /^\/risk/, icon: "default", title: () => "Risk" },
  { test: /^\/ppap/, icon: "default", title: () => "PPAP" },
  { test: /^\/settings/, icon: "settings", title: () => "Settings" },
  { test: /^\/admin/, icon: "admin", title: () => "Admin" },
  { test: /^\/platform/, icon: "admin", title: () => "Platform Admin" },
  { test: /^\/$/, icon: "dashboard", title: () => "Dashboard" },
  { test: /^\/home\/?$/, icon: "dashboard", title: () => "Home" },
  { test: /^\/calendar\/?$/, icon: "dashboard", title: () => "Calendar" },
];

export function deriveTabMeta(pathname: string): { title: string; icon: string } {
  for (const pattern of ROUTE_PATTERNS) {
    const match = pathname.match(pattern.test);
    if (match) return { title: pattern.title(match), icon: pattern.icon };
  }
  return { title: pathname, icon: "default" };
}
