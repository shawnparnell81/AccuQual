/**
 * Who may change a document number: Engineering, a quality manager, and an
 * administrator or owner. Everyone else may read the number.
 */
export function canEditFormNumber(user: { roleName?: string | null; department?: string | null } | null | undefined): boolean {
  const role = user?.roleName;
  if (role === "admin" || role === "owner" || role === "quality_manager") return true;
  return user?.department === "engineering";
}

/** The eight quality and engineering forms. Other templates, including NCR and CAPA, keep their seeded number. */
export const EDITABLE_FORM_NUMBER_KEYS = new Set([
  "frm-psw-001",
  "frm-prc-001",
  "frm-qa-001",
  "frm-fai-001",
  "frm-cus-001",
  "frm-fae-001",
  "frm-msa-001",
  "frm-par-001",
]);

/**
 * Filled copies that can be saved into any Documents folder and opened again from there.
 * CSA VALIDATION REPORT and FUEL PUMP VALIDATION DOCUMENT have no Doc ID on the sheet. They are filed the same way.
 */
export const FILEABLE_FORM_KEYS = new Set<string>([
  ...EDITABLE_FORM_NUMBER_KEYS,
  "frm-val-001",
  "frm-val-007",
  "frm-val-008",
  "frm-val-009",
  "frm-val-010",
  "frm-val-011",
  "frm-val-002",
  "frm-val-003",
  "frm-val-004",
  "frm-val-005",
  "frm-val-006",
  "frm-gen-002",
  "lst-vis-001",
  "rpt-eng-001",
  "frm-trp-001",
  "frm-trp-002",
  "frm-tst-001",
  "frm-tst-002",
  "frm-dev-001",
  "frm-dev-002",
  "frm-dev-003",
  "frm-dev-004",
  "frm-dev-005",
  "frm-dev-006",
  "frm-dev-007",
  "frm-dev-008",
  "frm-dev-009",
  "frm-dev-010",
  "frm-dev-011",
  "frm-dev-012",
  "frm-dev-013",
  "frm-ecr-001",
  "frm-car-001",
  "frm-ncr-001",
  "frm-ncr-002",
  "frm-ncr-003",
  "frm-gen-001",
  "frm-trn-001",
  "frm-trn-002",
]);

/** ISO form_type -> blank-template key for sheets stored on iso_quality_forms. */
export const ISO_TYPE_TO_FORM_KEY: Record<string, string> = {
  psw: "frm-psw-001",
  turtle_diagram: "frm-prc-001",
  quality_alert: "frm-qa-001",
  first_article: "frm-fai-001",
  customer_scorecard: "frm-cus-001",
  failure_effectiveness: "frm-fae-001",
  audit_summary: "frm-gen-002",
  visitor_log: "lst-vis-001",
  monthly_engineering: "rpt-eng-001",
  salt_spray: "frm-trp-002",
  volume_water: "frm-tst-001",
  volume_heptane: "frm-tst-002",
  prototype_strut: "frm-trp-001",
  dev_csa: "frm-dev-001",
  dev_fuel_pump: "frm-dev-002",
  dev_gas_lift: "frm-dev-003",
  dev_coil: "frm-dev-004",
  dev_air_spring: "frm-dev-005",
  dev_air_strut: "frm-dev-006",
  dev_brake_wear: "frm-dev-007",
  dev_electronic_shock: "frm-dev-008",
  dev_air_compressor: "frm-dev-009",
  dev_fuel_injector: "frm-dev-010",
  dev_electric_lift: "frm-dev-011",
  dev_electronic_csa: "frm-dev-012",
  dev_shock: "frm-dev-013",
  engineering_change: "frm-ecr-001",
  scar_request: "frm-car-001",
  ncr_report: "frm-ncr-001",
  quarantine_notice: "frm-ncr-002",
  concession: "frm-ncr-003",
  internal_audit: "frm-gen-001",
  competency_training: "frm-trn-001",
  cross_training: "frm-trn-002",
};

export const FORM_DATA_TYPE_TO_FORM_KEY: Record<string, string> = {
  gage_rr: "frm-msa-001",
  pareto_chart: "frm-par-001",
};

/**
 * Subject folder suggested when someone files a filled copy.
 * Paths start at ISO Compliance Documents, because that folder is the content root.
 * The first segments that already exist in Documents are used.
 * The user can pick a different folder.
 */
const ISO_SUBJECT_ROOT = "ISO Compliance Documents";

function subjectPath(...parts: string[]): string[] {
  return [ISO_SUBJECT_ROOT, ...parts];
}

export const SUGGESTED_SUBJECT_PATH: Record<string, string[]> = {
  "frm-psw-001": subjectPath("Engineering", "Supplier Engineering", "Supplier PPAP Submissions"),
  "frm-prc-001": subjectPath("Quality", "Quality Manual & Policies"),
  "frm-qa-001": subjectPath("Quality", "Product Alerts"),
  "frm-fai-001": subjectPath("Quality", "FAI"),
  "frm-cus-001": subjectPath("Quality", "Customer Quality"),
  "frm-fae-001": subjectPath("Quality", "Corrective & Preventive Actions", "Effectiveness Checks"),
  "frm-msa-001": subjectPath("Quality", "Calibration & Equipment", "Gage R&R"),
  "frm-par-001": subjectPath("Quality", "Production & Inspection", "Pareto Charts"),
  "frm-val-001": subjectPath("Engineering", "CSA", "Validation"),
  "frm-val-007": subjectPath("Engineering", "Fuel", "Validation"),
  "frm-val-010": subjectPath("Engineering", "Air Suspension", "Validation"),
  "frm-val-011": subjectPath("Engineering", "Air Suspension", "Validation"),
  "frm-val-008": subjectPath("Engineering", "Fuel", "Validation"),
  "frm-val-009": subjectPath("Engineering", "Manufacturing Engineering", "Process Validation"),
  "frm-val-002": subjectPath("Engineering", "Shocks", "Validation"),
  "frm-val-003": subjectPath("Engineering", "Design & Development", "Design Validation"),
  "frm-val-004": subjectPath("Engineering", "Gas/Electric Lifts", "Validation"),
  "frm-val-005": subjectPath("Engineering", "Gas/Electric Lifts", "Validation"),
  "frm-val-006": subjectPath("Engineering", "Design & Development", "Design Validation"),
  "frm-gen-002": subjectPath("Audits"),
  "lst-vis-001": subjectPath("Quality", "Records", "Inspection Records"),
  "rpt-eng-001": subjectPath("Engineering", "Technical Records"),
  "frm-trp-002": subjectPath("Quality", "Records", "Inspection Records"),
  "frm-tst-001": subjectPath("Engineering", "Technical Records"),
  "frm-tst-002": subjectPath("Engineering", "Technical Records"),
  "frm-trp-001": subjectPath("Engineering", "Design & Development", "Design Validation"),
  "frm-dev-001": subjectPath("Engineering", "CSA", "Development"),
  "frm-dev-002": subjectPath("Engineering", "Fuel", "Development"),
  "frm-dev-003": subjectPath("Engineering", "Gas/Electric Lifts", "Development"),
  "frm-dev-004": subjectPath("Engineering", "Design & Development"),
  "frm-dev-005": subjectPath("Engineering", "Air Suspension", "Development"),
  "frm-dev-006": subjectPath("Engineering", "Air Suspension", "Development"),
  "frm-dev-007": subjectPath("Engineering", "Design & Development"),
  "frm-dev-008": subjectPath("Engineering", "Shocks", "Development"),
  "frm-dev-009": subjectPath("Engineering", "Design & Development"),
  "frm-dev-010": subjectPath("Engineering", "Fuel", "Development"),
  "frm-dev-011": subjectPath("Engineering", "Gas/Electric Lifts", "Development"),
  "frm-dev-012": subjectPath("Engineering", "CSA", "Development"),
  "frm-dev-013": subjectPath("Engineering", "Shocks", "Development"),
  "frm-ecr-001": subjectPath("Engineering", "Engineering Change Control", "Engineering Change Requests (ECR)"),
  "frm-car-001": subjectPath("Quality", "Corrective & Preventive Actions"),
  "frm-ncr-001": subjectPath("NCR"),
  "frm-ncr-002": subjectPath("NCR"),
  "frm-ncr-003": subjectPath("NCR"),
  "frm-gen-001": subjectPath("Audits"),
  "frm-trn-001": subjectPath("Quality", "Training"),
  "frm-trn-002": subjectPath("Quality", "Training"),
};

export type ValidationKind =
  | "csa"
  | "fuel_pump"
  | "air_strut"
  | "air_spring"
  | "fuel_injector"
  | "brake_wear"
  | "shock"
  | "air_compressor"
  | "electric_lift"
  | "gas_lift"
  | "coil_spring";

const NAMED_KINDS = new Set<ValidationKind>([
  "fuel_pump",
  "air_strut",
  "air_spring",
  "fuel_injector",
  "brake_wear",
  "shock",
  "air_compressor",
  "electric_lift",
  "gas_lift",
  "coil_spring",
]);

/** Missing formType stays CSA so older rows keep their sheet. */
export function validationKind(data: unknown): ValidationKind {
  const raw = data && typeof data === "object" ? (data as { formType?: unknown }).formType : undefined;
  if (typeof raw === "string" && NAMED_KINDS.has(raw as ValidationKind)) return raw as ValidationKind;
  return "csa";
}

const KIND_KEY: Record<ValidationKind, string> = {
  csa: "frm-val-001",
  fuel_pump: "frm-val-007",
  air_strut: "frm-val-010",
  air_spring: "frm-val-011",
  fuel_injector: "frm-val-008",
  brake_wear: "frm-val-009",
  shock: "frm-val-002",
  air_compressor: "frm-val-003",
  electric_lift: "frm-val-004",
  gas_lift: "frm-val-005",
  coil_spring: "frm-val-006",
};

export function validationFormKeyFor(data: unknown): string {
  return KIND_KEY[validationKind(data)];
}

const VALIDATION_KEY_KIND: Record<string, ValidationKind> = {
  "frm-val-001": "csa",
  "frm-val-007": "fuel_pump",
  "frm-val-008": "fuel_injector",
  "frm-val-009": "brake_wear",
  "frm-val-010": "air_strut",
  "frm-val-011": "air_spring",
  "frm-val-002": "shock",
  "frm-val-003": "air_compressor",
  "frm-val-004": "electric_lift",
  "frm-val-005": "gas_lift",
  "frm-val-006": "coil_spring",
};

export function validationKindForKey(formKey: string): ValidationKind | null {
  return VALIDATION_KEY_KIND[formKey] ?? null;
}

const VALIDATION_RECORD_KEYS = new Set(Object.keys(VALIDATION_KEY_KIND));

export function recordLinkedPath(formKey: string, recordId: number): string {
  if (formKey === "frm-msa-001") return `/calibration/${recordId}`;
  if (formKey === "frm-par-001") return "/pareto";
  if (VALIDATION_RECORD_KEYS.has(formKey)) return `/validation-reports/${recordId}`;
  return `/iso-forms/record/${recordId}`;
}

export interface FolderNode {
  id: number;
  name: string;
  parentId: number | null;
}

/** Deepest folder that matches the start of `path`. Null when even the first name is missing. */
export function resolveFolderPath(folders: FolderNode[], path: string[]): number | null {
  let parentId: number | null = null;
  let found: number | null = null;
  for (const name of path) {
    const next = folders.find((folder) => folder.parentId === parentId && folder.name === name);
    if (!next) break;
    found = next.id;
    parentId = next.id;
  }
  return found;
}

export function folderPathNames(folders: FolderNode[], folderId: number | null): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  let current = folderId === null ? undefined : byId.get(folderId);
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return names;
}
