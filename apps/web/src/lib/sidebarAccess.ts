import { faiValidationDocumentsHref, LEGACY_VALIDATION_REPORTS_PATH } from "./folderBrowse";
import { FRM_NCR_PATH } from "./qualityEntry";
import { ENGINEERING_PLANNER_URL, isExternalHref, isFolder, type SidebarNode } from "../components/layout/sidebarStructure";

/**
 * What GET /permissions/effective must say before a sidebar row is shown.
 * "open" is any signed-in person. Nothing here names a role.
 */
export type SidebarResource = string;

export interface SidebarAccess {
  /** Null while permissions have not loaded and there is no cached copy. */
  levels: Record<string, string> | null;
  /** False hides AI Insights. Omitted means the company still has AI on. */
  aiFeatures?: boolean;
}

const KEY_RESOURCE: Record<string, SidebarResource> = {
  home: "open",
  calendar: "open",
  executive: "executive.dashboard",
  notifications: "open",
  "document-control": "documents",
  "folder-explorer": "documents",
  "saved-form-folders": "documents",
  "form-folders": "documents",
  dcr: "open",
  "management-system": "management_review",
  drawings: "documents",
  apqp: "documents",
  quality: "open",
  "obsolete-archive": "documents",
  "controlled-lists": "documents",
  "master-document-list": "documents",
  "laboratory-scope": "documents",
  "internal-audit-schedule": "documents",
  "nonconformance-log": "documents",
  uploads: "documents",
  "qms-forms": "qms_forms",
  training: "training",
  workers: "worker_profile",
  inspections: "quality_inspection",
  "product-alerts": "documents",
  recalls: "documents",
  warranty: "warranty",
  "labor-claims": "labor_claims",
  repairs: "documents",
  sop: "open",
  "sop-procedures": "documents",
  "sop-policies": "documents",
  calibration: "calibration",
  "master-equipment-list": "calibration",
  audits: "audit",
  "internal-audits": "documents",
  "audit-plan": "documents",
  "audit-schedule": "documents",
  "audit-report": "documents",
  suppliers: "suppliers",
  "add-supplier": "suppliers",
  supplier_portal: "supplier_portal",
  scar: "scar",
  "ncr-capa": "open",
  ncr: "ncr",
  "frm-ncr-001": "ncr",
  capa: "capa",
  "8d": "eight_d",
  quarantine: "quarantine",
  "blank-forms": "documents",
  ppap: "ppap",
  risk: "risk",
  "risk-dashboard": "risk",
  "process-change": "change",
  crar: "crar",
  engineering: "open",
  feasibility: "feasibility",
  "engineering-planner": "open",
  "engineering-request-log": "documents",
  ecn: "documents",
  ecr: "documents",
  "work-instructions": "documents",
  "digital-twin": "open",
  equipment: "open",
  workflow: "workflow",
  "form-builder": "form_builder",
  ai: "open",
  reporting: "open",
  "admin-users": "admin_console",
  "admin-import": "admin_console",
  "admin-plants": "admin_console",
  "admin-permissions": "admin_console",
  "admin-login-history": "login_history",
  "admin-ai": "admin_console",
  "admin-supplier": "admin_console",
  "admin-quality": "admin_console",
  "admin-receiving": "admin_console",
  "admin-health": "admin_console",
  "admin-api": "admin_console",
  "admin-sso": "admin_console",
  "admin-export": "admin_console",
  "admin-company": "admin_console",
  pareto: "pareto",
  dashboard: "open",
  "imported-data": "import_data",
  "report-import": "import_data",
  "audit-log": "open",
  admin: "admin_console",
};

/** Longest prefix wins. "/" is exact, so it does not swallow every path. */
const PATH_RESOURCES: [string, SidebarResource][] = [
  ["/quality-inspection-reports", "quality_inspection"],
  ["/document-change-requests", "open"],
  ["/blank-forms", "documents"],
  ["/documents", "documents"],
  ["/form-folders", "documents"],
  ["/folders", "documents"],
  ["/management-system", "management_review"],
  ["/iso-forms/frm-ncr-001", "ncr"],
  ["/iso-forms", "qms_forms"],
  ["/qms-forms", "qms_forms"],
  ["/scar-forms", "scar"],
  ["/supplier-portal", "supplier_portal"],
  ["/calibration", "calibration"],
  ["/quarantine", "quarantine"],
  ["/feasibility", "feasibility"],
  ["/reporting", "open"],
  ["/notifications", "open"],
  ["/settings/erp", "admin_console"],
  ["/settings", "open"],
  ["/form-builder", "form_builder"],
  ["/workflow", "workflow"],
  ["/warranty", "warranty"],
  ["/labor-claims", "labor_claims"],
  ["/workers", "worker_profile"],
  ["/training", "training"],
  ["/suppliers", "suppliers"],
  ["/change", "change"],
  ["/audits", "audit"],
  ["/admin", "admin_console"],
  ["/pareto", "pareto"],
  ["/crar", "crar"],
  ["/capa", "capa"],
  ["/risk", "risk"],
  ["/ppap", "ppap"],
  ["/ncr", "ncr"],
  ["/8d", "eight_d"],
  ["/ai", "open"],
  ["/digital-twin", "open"],
  ["/audit-log", "open"],
  ["/calendar", "open"],
  ["/executive", "executive.dashboard"],
  ["/home", "open"],
  ["/rma", "rma"],
  ["/work-orders", "work_orders"],
];

const ROUTE_PATTERNS = [
  /^\/$/,
  /^\/home$/,
  /^\/executive$/,
  /^\/calendar$/,
  /^\/audit-log$/,
  /^\/ncr$/,
  /^\/ncr\/\d+$/,
  /^\/capa$/,
  /^\/capa\/\d+$/,
  /^\/8d$/,
  /^\/8d\/\d+$/,
  /^\/validation-reports\/\d+$/,
  /^\/iso-forms\/record\/\d+$/,
  /^\/iso-forms\/[A-Za-z0-9-]+$/,
  /^\/blank-forms$/,
  /^\/blank-forms\/start\/[A-Za-z0-9-]+$/,
  /^\/audits$/,
  /^\/audits\/\d+$/,
  /^\/folders\/[A-Za-z0-9-]+$/,
  /^\/documents$/,
  /^\/documents\/master-list$/,
  /^\/documents\/laboratory-scope$/,
  /^\/documents\/internal-audit-schedule$/,
  /^\/documents\/nonconformance-log$/,
  /^\/documents\/engineering-request-log$/,
  /^\/documents\/development-log$/,
  /^\/documents\/import$/,
  /^\/documents\/folders$/,
  /^\/documents\/uploads$/,
  /^\/documents\/\d+$/,
  /^\/form-folders$/,
  /^\/form-folders\/[A-Za-z0-9_-]+$/,
  /^\/training$/,
  /^\/training\/employee\/\d+$/,
  /^\/training\/\d+$/,
  /^\/workers$/,
  /^\/workers\/\d+$/,
  /^\/change$/,
  /^\/change\/\d+$/,
  /^\/risk$/,
  /^\/risk\/dashboard$/,
  /^\/risk\/\d+$/,
  /^\/feasibility$/,
  /^\/feasibility\/\d+$/,
  /^\/document-change-requests$/,
  /^\/document-change-requests\/\d+$/,
  /^\/qms-forms$/,
  /^\/qms-forms\/[A-Za-z0-9_-]+$/,
  /^\/qms-forms\/[A-Za-z0-9_-]+\/\d+$/,
  /^\/scar-forms$/,
  /^\/scar-forms\/\d+$/,
  /^\/quality-inspection-reports$/,
  /^\/quality-inspection-reports\/\d+$/,
  /^\/ppap$/,
  /^\/ppap\/\d+$/,
  /^\/suppliers$/,
  /^\/suppliers\/new$/,
  /^\/suppliers\/\d+$/,
  /^\/calibration$/,
  /^\/calibration\/master-list$/,
  /^\/calibration\/\d+$/,
  /^\/quarantine$/,
  /^\/quarantine\/\d+$/,
  /^\/warranty$/,
  /^\/warranty\/dashboard$/,
  /^\/warranty\/\d+$/,
  /^\/labor-claims$/,
  /^\/labor-claims\/\d+$/,
  /^\/crar$/,
  /^\/crar\/\d+$/,
  /^\/rma\/\d+$/,
  /^\/work-orders\/\d+$/,
  /^\/supplier-portal$/,
  /^\/workflow$/,
  /^\/workflow\/\d+$/,
  /^\/form-builder$/,
  /^\/form-builder\/\d+$/,
  /^\/form-builder\/template\/\d+$/,
  /^\/form-builder\/fills\/\d+$/,
  /^\/ai$/,
  /^\/digital-twin$/,
  /^\/settings$/,
  /^\/settings\/navigation$/,
  /^\/settings\/erp\/presets$/,
  /^\/settings\/erp\/presets\/\d+$/,
  /^\/settings\/erp\/sync-errors$/,
  /^\/admin$/,
  /^\/admin\/[a-z0-9-]+$/,
  /^\/reporting$/,
  /^\/reporting\/imported-data$/,
  /^\/reporting\/imported-data\/\d+$/,
  /^\/notifications$/,
  /^\/pareto$/,
  /^\/management-system$/,
  /^\/verify\/[^/]+$/,
];

/** Pages that are real routes but are not on the default menu. */
/** Real routes that are still not a default menu row. Settings stays on the bar itself. */
export const EXTRA_SIDEBAR_PAGES: { key: string; label: string; path: string }[] = [
  { key: "page-settings", label: "Settings", path: "/settings" },
  { key: "page-warranty-dashboard", label: "Warranty dashboard", path: "/warranty/dashboard" },
];

export function resourceForPath(path: string | undefined): SidebarResource {
  if (!path || isExternalHref(path)) return "open";
  const pathname = path.split("?")[0] || "/";
  if (pathname === "/") return "open";
  const match = PATH_RESOURCES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return match?.[1] ?? "open";
}

export function resourceForSidebarNode(node: { key: string; path?: string; adminOnly?: boolean }): SidebarResource {
  if (node.adminOnly || node.key === "admin") return "admin_console";
  return KEY_RESOURCE[node.key] ?? (node.path ? resourceForPath(node.path) : "open");
}

export function sidebarAllows(resource: SidebarResource, access: SidebarAccess): boolean {
  if (resource === "open") return true;
  if (!access.levels) return false;
  const level = access.levels[resource];
  return level === "read" || level === "edit";
}

function routeExists(pathname: string): boolean {
  return ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

/**
 * A saved path the app can still open.
 * Retired list pages and unknown routes are dropped.
 * Renames become the page that replaced them.
 */
export function acceptSidebarPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("\\") || trimmed.includes("#")) return null;
  if (trimmed === ENGINEERING_PLANNER_URL) return trimmed;
  if (isExternalHref(trimmed) || trimmed.startsWith("//")) return null;
  if (!trimmed.startsWith("/")) return null;

  const next = trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
  if (next === LEGACY_VALIDATION_REPORTS_PATH) return faiValidationDocumentsHref();
  if (next === "/reports" || next.startsWith("/reports/")) return "/reporting";
  if (next === "/onboarding" || next.startsWith("/onboarding/")) return "/settings";
  if (next === "/quality" || next.startsWith("/quality/")) return FRM_NCR_PATH;
  if (next === "/complaints" || next.startsWith("/complaints/")) return FRM_NCR_PATH;
  if (next === "/sales" || next.startsWith("/sales/") || next === "/customers" || next.startsWith("/customers/")) return null;

  const queryAt = next.indexOf("?");
  const pathname = queryAt === -1 ? next : next.slice(0, queryAt);
  const query = queryAt === -1 ? "" : next.slice(queryAt + 1);
  if (query.includes("?")) return null;
  if (!routeExists(pathname)) return null;
  if (!query) return pathname;
  if (pathname !== "/documents/folders") return null;
  if (!/^(folder=\d+|name=[A-Za-z0-9._~%-]{1,120})$/.test(query)) return null;
  return `${pathname}?${query}`;
}

/** Hides rows this person cannot open. A folder with no remaining children is dropped. */
export function filterSidebarByAccess(nodes: SidebarNode[], access: SidebarAccess): SidebarNode[] {
  const out: SidebarNode[] = [];
  for (const node of nodes) {
    if (node.key === "ai" && access.aiFeatures === false) continue;
    if (node.key === "admin-login-history" && !sidebarAllows("login_history", access)) continue;
    if (isFolder(node)) {
      const children = filterSidebarByAccess(node.children, access);
      const allowed = sidebarAllows(resourceForSidebarNode(node), access);
      const path = node.path ? acceptSidebarPath(node.path) : null;
      const keepPath = allowed && path ? path : undefined;
      if (!keepPath && children.length === 0) continue;
      out.push(keepPath === node.path ? { ...node, children } : { ...node, path: keepPath, children });
      continue;
    }
    if (!sidebarAllows(resourceForSidebarNode(node), access)) continue;
    const path = acceptSidebarPath(node.path);
    if (!path) continue;
    out.push(path === node.path ? node : { ...node, path });
  }
  return out;
}
