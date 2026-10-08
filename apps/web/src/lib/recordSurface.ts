export type RecordSurfaceKind = "list" | "form";

export interface RecordSurface {
  kind: RecordSurfaceKind;
  /** Permission module. "any" means every signed-in user can already edit this page. */
  access: string;
}

interface SurfaceRule {
  test: RegExp;
  kind: RecordSurfaceKind;
  access: string;
}

const RULES: SurfaceRule[] = [
  { test: /^\/documents\/master-list$/, kind: "list", access: "documents" },
  { test: /^\/documents\/laboratory-scope$/, kind: "list", access: "documents" },
  { test: /^\/documents\/development-log$/, kind: "list", access: "documents" },
  { test: /^\/documents\/nonconformance-log$/, kind: "list", access: "documents" },
  { test: /^\/calibration\/master-list$/, kind: "list", access: "calibration" },
  { test: /^\/iso-forms\/record\/\d+$/, kind: "form", access: "documents" },
  { test: /^\/qms-forms\/[^/]+\/\d+$/, kind: "form", access: "qms_forms" },
  { test: /^\/ncr\/\d+$/, kind: "form", access: "ncr" },
  { test: /^\/capa\/\d+$/, kind: "form", access: "capa" },
  { test: /^\/8d\/\d+$/, kind: "form", access: "eight_d" },
  { test: /^\/validation-reports\/\d+$/, kind: "form", access: "documents" },
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
  { test: /^\/work-orders\/\d+$/, kind: "form", access: "work_orders" },
  { test: /^\/rma\/\d+$/, kind: "form", access: "rma" },
  { test: /^\/documents\/\d+$/, kind: "form", access: "documents" },
  { test: /^\/management-system\/management-review$/, kind: "form", access: "management_review" },
  { test: /^\/management-system\/context$/, kind: "form", access: "context_of_org" },
  { test: /^\/pareto$/, kind: "form", access: "any" },
  { test: /^\/form-builder\/\d+$/, kind: "form", access: "form_builder" },
  { test: /^\/form-builder\/fills\/\d+$/, kind: "form", access: "documents" },
  { test: /^\/form-builder\/template\/\d+$/, kind: "form", access: "documents" },
];

export function recordSurface(pathname: string): RecordSurface | null {
  const path = pathname.split("?")[0] ?? pathname;
  const rule = RULES.find((item) => item.test.test(path));
  if (!rule) return null;
  return { kind: rule.kind, access: rule.access };
}
