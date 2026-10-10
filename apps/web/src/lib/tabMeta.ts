import { getQmsFormDefinition } from "../routes/QmsForms/qmsFormDefinitions";

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
  { test: /^\/executive\/list\/?$/, icon: "dashboard", title: () => "Records" },
  { test: /^\/executive\/?$/, icon: "dashboard", title: () => "Executive dashboard" },
  { test: /^\/kpis\/?$/, icon: "dashboard", title: () => "Quality Objectives & KPIs" },
  { test: /^\/ncr\/(\d+)$/, icon: "ncr", title: () => "NCR" },
  { test: /^\/ncr\/?$/, icon: "ncr", title: () => "NCR" },
  { test: /^\/capa\/(\d+)$/, icon: "capa", title: () => "CAPA" },
  { test: /^\/capa\/?$/, icon: "capa", title: () => "CAPA" },
  { test: /^\/validation-reports\/(\d+)$/, icon: "documents", title: () => "Validation" },
  { test: /^\/8d\/(\d+)$/, icon: "capa", title: () => "8D" },
  { test: /^\/8d/, icon: "capa", title: () => "8D" },
  { test: /^\/notifications\/?$/, icon: "default", title: () => "Notifications" },
  { test: /^\/documents\/folders\/?$/, icon: "documents", title: () => "Folder Explorer" },
  { test: /^\/scar-forms/, icon: "default", title: () => "SCAR" },
  { test: /^\/document-change-requests/, icon: "default", title: () => "Document changes" },
  { test: /^\/qms-forms\/([^/]+)\/\d+$/, icon: "documents", title: (match) => getQmsFormDefinition(match[1] ?? "")?.title ?? "Form" },
  { test: /^\/qms-forms\/[^/]+$/, icon: "documents", title: () => "Saved forms" },
  { test: /^\/qms-forms\/?$/, icon: "documents", title: () => "Blank Forms" },
  { test: /^\/blank-forms\/start\/[^/]+$/, icon: "documents", title: () => "Starting a blank" },
  { test: /^\/blank-forms\/?$/, icon: "documents", title: () => "Blank Forms" },
  { test: /^\/form-folders\/[^/]+\/?$/, icon: "documents", title: () => "Saved forms" },
  { test: /^\/form-folders\/?$/, icon: "documents", title: () => "Folders" },
  { test: /^\/management-system/, icon: "default", title: () => "Management System" },
  { test: /^\/risk\/dashboard\/?$/, icon: "default", title: () => "Risk dashboard" },
  { test: /^\/workers/, icon: "default", title: () => "Workers" },
  { test: /^\/form-builder\/fills\//, icon: "documents", title: () => "Filled form" },
  { test: /^\/form-builder\/template\//, icon: "documents", title: () => "Blank form" },
  { test: /^\/form-builder\/\d+/, icon: "default", title: () => "Form Builder" },
  { test: /^\/form-builder\/?$/, icon: "default", title: () => "Form Builder" },
  { test: /^\/workflow/, icon: "default", title: () => "Workflow Builder" },
  { test: /^\/ai\/?$/, icon: "default", title: () => "AI Insights" },
  { test: /^\/reporting\/imported-data\/(\d+)$/, icon: "default", title: () => "Imported file" },
  { test: /^\/reporting\/imported-data\/?$/, icon: "default", title: () => "Imported Data" },
  { test: /^\/reports\/?$/, icon: "default", title: () => "Reports" },
  { test: /^\/reporting\/?$/, icon: "default", title: () => "Reports" },
  { test: /^\/pareto\/?$/, icon: "default", title: () => "Pareto" },
  { test: /^\/iso-forms\/record\/(\d+)$/, icon: "documents", title: () => "ISO form" },
  { test: /^\/iso-forms\/frm-fai-001/, icon: "documents", title: () => "First Article Inspection" },
  { test: /^\/fai\/csa\/(\d+)$/, icon: "documents", title: () => "CSA FAI" },
  { test: /^\/fai\/csa\/?$/, icon: "documents", title: () => "CSA First Article" },
  { test: /^\/fai\/fuel-pump\/(\d+)$/, icon: "documents", title: () => "Fuel Pump FAI" },
  { test: /^\/fai\/fuel-pump\/?$/, icon: "documents", title: () => "Fuel Pump Module FAI" },
  { test: /^\/fai\/records\/(\d+)$/, icon: "documents", title: () => "FAI" },
  { test: /^\/fai\/plans/, icon: "documents", title: () => "Inspection plan" },
  { test: /^\/fai\/sources/, icon: "documents", title: () => "Source approval" },
  { test: /^\/fai\/pull/, icon: "documents", title: () => "Yearly pull" },
  { test: /^\/fai\/?$/, icon: "documents", title: () => "First Article" },
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
  { test: /^\/audits\/(\d+)$/, icon: "audit", title: () => "Audit" },
  { test: /^\/audits\/?$/, icon: "audit", title: () => "Audits" },
  { test: /^\/training\/employee\/(\d+)$/, icon: "training", title: () => "Employee Training" },
  { test: /^\/training\/(\d+)$/, icon: "training", title: () => "Course" },
  { test: /^\/training\/?$/, icon: "training", title: () => "Training" },
  { test: /^\/calibration\/(\d+)$/, icon: "calibration", title: () => "Equipment" },
  { test: /^\/calibration\/?$/, icon: "calibration", title: () => "Calibration" },
  { test: /^\/quarantine\/(\d+)$/, icon: "quarantine", title: (m) => `Quarantined item #${m[1]}` },
  { test: /^\/quarantine\/?$/, icon: "quarantine", title: () => "Quarantined items" },
  { test: /^\/erp\/(\d+)$/, icon: "erp", title: (m) => `PO #${m[1]}` },
  { test: /^\/erp\/?$/, icon: "erp", title: () => "ERP" },
  { test: /^\/rma\/(\d+)$/, icon: "rma", title: () => "RMA" },
  { test: /^\/rma\/?$/, icon: "rma", title: () => "RMAs" },
  { test: /^\/labor-claims\/(\d+)$/, icon: "default", title: () => "Labor Claim" },
  { test: /^\/labor-claims\/?$/, icon: "default", title: () => "Labor Claims" },
  // The page stays for a direct visit. The company flag hides it from menus; this only names the tab.
  { test: /^\/digital-twin/, icon: "digitaltwin", title: () => "Digital Twin" },
  { test: /^\/documents\/internal-audit-schedule\/?$/, icon: "documents", title: () => "LST-GEN-002" },
  { test: /^\/documents\/engineering-request-log\/?$/, icon: "documents", title: () => "LST-ENG-001" },
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
