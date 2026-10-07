/**
 * Saved open-page tabs. A path stays only when the app still has that page.
 * Purchasing screens (/erp, /erp/requisitions, purchase-order detail) and
 * sales accounts (/sales) and customer onboarding (/customers) now redirect
 * home, so restoring them was calling APIs that are no longer part of the
 * app. The NetSuite connector lives under Settings
 * (/settings/erp/presets, /settings/erp/sync-errors). Feasibility still has
 * its own page, so those tabs stay.
 */

interface SavedTab {
  id: string;
  path: string;
}

const EXACT = new Set([
  "/",
  "/home",
  "/blank-forms",
  "/form-folders",
  "/calendar",
  "/ncr",
  "/capa",
  "/8d",
  "/audits",
  "/documents",
  "/documents/folders",
  "/documents/uploads",
  "/training",
  "/workers",
  "/change",
  "/risk",
  "/risk/dashboard",
  "/feasibility",
  "/document-change-requests",
  "/qms-forms",
  "/scar-forms",
  "/quality-inspection-reports",
  "/ppap",
  "/notifications",
  "/management-system",
  "/management-system/management-review",
  "/management-system/context",
  "/pareto",
  "/suppliers",
  "/suppliers/new",
  "/calibration",
  "/quarantine",
  "/warranty",
  "/warranty/dashboard",
  "/crar",
  "/workflow",
  "/ai",
  "/digital-twin",
  "/settings",
  "/settings/navigation",
  "/settings/erp/presets",
  "/settings/erp/sync-errors",
  "/admin",
  "/admin/company-ai",
  "/admin/ai-usage",
  "/reporting",
  "/reports",
]);

/** One dynamic segment: a number, or (for a few list filters) any single path piece. */
const ONE_SEGMENT: RegExp[] = [
  /^\/ncr\/\d+$/,
  /^\/capa\/\d+$/,
  /^\/8d\/\d+$/,
  /^\/validation-reports\/\d+$/,
  /^\/audits\/\d+$/,
  /^\/folders\/[^/]+$/,
  /^\/form-folders\/[^/]+$/,
  /^\/blank-forms\/start\/[^/]+$/,
  /^\/documents\/\d+$/,
  /^\/training\/employee\/\d+$/,
  /^\/training\/\d+$/,
  /^\/workers\/\d+$/,
  /^\/change\/\d+$/,
  /^\/risk\/\d+$/,
  /^\/feasibility\/\d+$/,
  /^\/document-change-requests\/\d+$/,
  /^\/qms-forms\/[^/]+$/,
  /^\/qms-forms\/[^/]+\/\d+$/,
  /^\/scar-forms\/\d+$/,
  /^\/quality-inspection-reports\/\d+$/,
  /^\/ppap\/\d+$/,
  /^\/suppliers\/\d+$/,
  /^\/calibration\/\d+$/,
  /^\/quarantine\/\d+$/,
  /^\/rma\/\d+$/,
  /^\/warranty\/\d+$/,
  /^\/crar\/\d+$/,
  /^\/work-orders\/\d+$/,
  /^\/workflow\/\d+$/,
  /^\/admin\/[^/]+$/,
  /^\/settings\/erp\/presets\/[^/]+$/,
];

export function normalizeTabPath(path: string): string {
  const pathname = path.split("?")[0]?.split("#")[0] ?? "";
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname || "/";
}

/** True when this path still opens a real page (not a redirect left behind for an old bookmark). */
export function isLiveTabPath(path: string): boolean {
  const pathname = normalizeTabPath(path);
  if (EXACT.has(pathname)) return true;
  return ONE_SEGMENT.some((pattern) => pattern.test(pathname));
}

export function selectRestoredTabs<T extends SavedTab>(tabs: T[], activeId: string | null): { tabs: T[]; activeId: string | null } {
  const live = tabs.filter((tab) => typeof tab?.path === "string" && isLiveTabPath(tab.path));
  const active = live.some((tab) => tab.id === activeId) ? activeId : (live[0]?.id ?? null);
  return { tabs: live, activeId: active };
}
