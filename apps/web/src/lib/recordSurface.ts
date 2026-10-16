export type RecordSurfaceKind = "list" | "form";

export interface RecordSurface {
  kind: RecordSurfaceKind;
  /** Permission module. "any" means every signed-in user can already edit this page. */
  access: string;
  /** The page-level Edit button. A form can still print when this is false. */
  edit?: boolean;
}

interface SurfaceRule {
  test: RegExp;
  kind: RecordSurfaceKind;
  access: string;
  edit?: boolean;
}

const RULES: SurfaceRule[] = [
  { test: /^\/documents\/master-list$/, kind: "list", access: "documents" },
  { test: /^\/documents\/laboratory-scope$/, kind: "list", access: "documents" },
  { test: /^\/documents\/internal-audit-schedule$/, kind: "list", access: "documents" },
  { test: /^\/documents\/development-log$/, kind: "list", access: "documents" },
  { test: /^\/documents\/nonconformance-log$/, kind: "list", access: "documents" },
  { test: /^\/documents\/engineering-request-log$/, kind: "list", access: "documents" },
  { test: /^\/calibration\/master-list$/, kind: "list", access: "calibration" },
  { test: /^\/iso-forms\/record\/new$/, kind: "form", access: "documents", edit: false },
  { test: /^\/qms-forms\/[^/]+\/new$/, kind: "form", access: "qms_forms", edit: false },
  { test: /^\/validation-reports\/new$/, kind: "form", access: "documents", edit: false },
  { test: /^\/fai-inspection\/(?:records|plans)\/new$/, kind: "form", access: "fai", edit: false },
  { test: /^\/fai-inspection\/(?:records|plans)\/\d+$/, kind: "form", access: "fai" },
  { test: /^\/complaints\/\d+$/, kind: "form", access: "complaints" },
  { test: /^\/quality\/\d+$/, kind: "form", access: "any", edit: false },
  { test: /^\/reporting\/imported-data\/\d+$/, kind: "form", access: "any", edit: false },
  { test: /^\/reports$/, kind: "form", access: "any", edit: false },
  { test: /^\/iso-forms\/record\/\d+$/, kind: "form", access: "documents", edit: false },
  { test: /^\/qms-forms\/[^/]+\/\d+$/, kind: "form", access: "qms_forms" },
  { test: /^\/ncr\/\d+$/, kind: "form", access: "ncr", edit: false },
  { test: /^\/capa\/\d+$/, kind: "form", access: "capa" },
  { test: /^\/8d\/\d+$/, kind: "form", access: "eight_d" },
  { test: /^\/validation-reports\/\d+$/, kind: "form", access: "documents", edit: false },
  { test: /^\/audits\/\d+$/, kind: "form", access: "audit" },
  { test: /^\/training\/employee\/\d+$/, kind: "form", access: "training" },
  { test: /^\/training\/\d+$/, kind: "form", access: "training" },
  { test: /^\/workers\/\d+$/, kind: "form", access: "worker_profile" },
  { test: /^\/change\/\d+$/, kind: "form", access: "change" },
  { test: /^\/risk\/\d+$/, kind: "form", access: "risk" },
  { test: /^\/feasibility\/\d+$/, kind: "form", access: "feasibility" },
  { test: /^\/document-change-requests\/\d+$/, kind: "form", access: "any" },
  { test: /^\/scar-forms\/\d+$/, kind: "form", access: "scar" },
  { test: /^\/quality-inspection-reports\/\d+$/, kind: "form", access: "quality_inspection" },
  { test: /^\/ppap\/\d+$/, kind: "form", access: "ppap" },
  { test: /^\/suppliers\/\d+$/, kind: "form", access: "suppliers" },
  { test: /^\/calibration\/\d+$/, kind: "form", access: "calibration" },
  { test: /^\/quarantine\/\d+$/, kind: "form", access: "quarantine" },
  { test: /^\/crar\/\d+$/, kind: "form", access: "crar" },
  { test: /^\/warranty\/\d+$/, kind: "form", access: "warranty" },
  { test: /^\/labor-claims\/\d+$/, kind: "form", access: "labor_claims" },
  { test: /^\/work-orders\/\d+$/, kind: "form", access: "work_orders" },
  { test: /^\/rma\/\d+$/, kind: "form", access: "rma" },
  { test: /^\/documents\/\d+$/, kind: "form", access: "documents" },
  { test: /^\/management-system\/management-review$/, kind: "form", access: "management_review" },
  { test: /^\/management-system\/context$/, kind: "form", access: "context_of_org" },
  { test: /^\/pareto$/, kind: "form", access: "any" },
  { test: /^\/kpis$/, kind: "list", access: "any" },
  { test: /^\/form-builder\/fills\/\d+$/, kind: "form", access: "documents", edit: false },
  { test: /^\/form-builder\/template\/\d+$/, kind: "form", access: "documents", edit: false },
];

export function recordSurface(pathname: string): RecordSurface | null {
  const path = pathname.split("?")[0] ?? pathname;
  const rule = RULES.find((item) => item.test.test(path));
  if (!rule) return null;
  return { kind: rule.kind, access: rule.access, ...(rule.edit === false ? { edit: false as const } : {}) };
}

/** Record detail pages that open read-only until Edit. */
export function isLockedRecordPath(pathname: string): boolean {
  const surface = recordSurface(pathname);
  if (!surface || surface.kind !== "form" || surface.access === "any") return false;
  return /\/\d+$/.test(pathname.split("?")[0] ?? pathname) && !/^\/(?:qms-forms|form-builder|training\/employee|reporting)\//.test(pathname);
}

/** Where Edit, Save and Cancel are recorded for record pages without a lock of their own. */
export function recordEditPath(pathname: string): string | null {
  const path = pathname.split("?")[0] ?? pathname;
  const complaint = /^\/complaints\/(\d+)$/.exec(path);
  if (complaint) return `/complaints/${complaint[1]}/begin-edit`;
  const fai = /^\/fai-inspection\/(records|plans)\/(\d+)$/.exec(path);
  if (fai) return `/record-edits/fai-${fai[1]}/${fai[2]}`;
  const generic = /^\/(suppliers|ppap|warranty|crar|rma|work-orders|feasibility|quality-inspection-reports|workers|documents)\/(\d+)$/.exec(path);
  return generic ? `/record-edits/${generic[1]}/${generic[2]}` : null;
}
