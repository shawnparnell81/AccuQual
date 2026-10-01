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
  { test: /^\/ncr\/(\d+)$/, icon: "ncr", title: (m) => `NCR #${m[1]}` },
  { test: /^\/ncr\/?$/, icon: "ncr", title: () => "NCR" },
  { test: /^\/capa\/(\d+)$/, icon: "capa", title: (m) => `CAPA #${m[1]}` },
  { test: /^\/capa\/?$/, icon: "capa", title: () => "CAPA" },
  { test: /^\/validation-reports\/(\d+)$/, icon: "documents", title: (m) => `Validation #${m[1]}` },
  { test: /^\/8d\/(\d+)$/, icon: "capa", title: (m) => `8D #${m[1]}` },
  { test: /^\/8d/, icon: "capa", title: () => "8D" },
  { test: /^\/notifications\/?$/, icon: "default", title: () => "Notifications" },
  { test: /^\/documents\/folders\/?$/, icon: "documents", title: () => "Folder Explorer" },
  { test: /^\/scar-forms/, icon: "default", title: () => "SCAR" },
  { test: /^\/document-change-requests/, icon: "default", title: () => "Document changes" },
  { test: /^\/qms-forms/, icon: "default", title: () => "QMS Forms" },
  { test: /^\/blank-forms\/?$/, icon: "documents", title: () => "Blank Forms" },
  { test: /^\/management-system/, icon: "default", title: () => "Management System" },
  { test: /^\/risk\/dashboard\/?$/, icon: "default", title: () => "Risk dashboard" },
  { test: /^\/workers/, icon: "default", title: () => "Workers" },
  { test: /^\/workflow/, icon: "default", title: () => "Workflow Builder" },
  { test: /^\/ai\/?$/, icon: "default", title: () => "AI Insights" },
  { test: /^\/reporting\/?$/, icon: "default", title: () => "Reporting" },
  { test: /^\/pareto\/?$/, icon: "default", title: () => "Pareto" },
  { test: /^\/iso-forms\/record\/(\d+)$/, icon: "documents", title: (match) => `Form #${match[1]}` },
  { test: /^\/iso-forms\/frm-fai-001/, icon: "documents", title: () => "First Article Inspection" },
  { test: /^\/iso-forms\/frm-psw-001/, icon: "documents", title: () => "Part Submission Warrant" },
  { test: /^\/iso-forms\/frm-prc-001/, icon: "documents", title: () => "Turtle Diagram" },
  { test: /^\/iso-forms\/frm-qa-001/, icon: "documents", title: () => "Quality Alert" },
  { test: /^\/iso-forms\/frm-cus-001/, icon: "documents", title: () => "Customer Scorecard" },
  { test: /^\/iso-forms\/frm-fae-001/, icon: "documents", title: () => "Failure Effectiveness" },
  { test: /^\/iso-forms/, icon: "documents", title: () => "ISO Form" },
  { test: /^\/supplier-portal/, icon: "supplier", title: () => "Supplier Portal" },
  { test: /^\/suppliers\/new$/, icon: "supplier", title: () => "ADD SUPPLIER" },
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
  { test: /^\/quarantine\/(\d+)$/, icon: "quarantine", title: (m) => `Quarantined item #${m[1]}` },
  { test: /^\/quarantine\/?$/, icon: "quarantine", title: () => "Quarantined items" },
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
