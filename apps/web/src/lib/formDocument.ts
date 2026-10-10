/**
 * Engineering, a quality manager, and an administrator or owner may change a
 * document number. Everyone else can read it.
 */
export function canEditFormNumber(user: { roleName?: string | null; department?: string | null } | null | undefined): boolean {
  const role = user?.roleName;
  if (role === "admin" || role === "owner" || role === "quality_manager") return true;
  return user?.department === "engineering";
}

/** Eight quality forms whose document number can be changed in the app. */
export const EDITABLE_FORM_KEYS = new Set([
  "frm-psw-001",
  "frm-prc-001",
  "frm-qa-001",
  "frm-fai-001",
  "frm-cus-001",
  "frm-fae-001",
  "frm-msa-001",
  "frm-par-001",
]);

/** Filled copies that can be saved into a Documents folder and opened from Folder Explorer. */
export const FILEABLE_FORM_KEYS = new Set<string>([
  ...EDITABLE_FORM_KEYS,
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
  "frm-dwg-001",
  "frm-pcr-001",
  "frm-doc-001",
  "frm-car-001",
  "frm-ncr-001",
  "frm-ncr-002",
  "frm-ncr-003",
  "frm-gen-001",
  "frm-trn-001",
  "frm-trn-002",
]);

export const FORM_KEY_BY_TYPE: Record<string, string> = {
  psw: "frm-psw-001",
  turtle_diagram: "frm-prc-001",
  quality_alert: "frm-qa-001",
  first_article: "frm-fai-001",
  customer_scorecard: "frm-cus-001",
  failure_effectiveness: "frm-fae-001",
  gage_rr: "frm-msa-001",
  pareto_chart: "frm-par-001",
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
  drawing_change: "frm-dwg-001",
  process_change: "frm-pcr-001",
  document_change: "frm-doc-001",
  scar_request: "frm-car-001",
  ncr_report: "frm-ncr-001",
  quarantine_notice: "frm-ncr-002",
  concession: "frm-ncr-003",
  internal_audit: "frm-gen-001",
  competency_training: "frm-trn-001",
  cross_training: "frm-trn-002",
};

/** List-page line. A type that is not fileable must not claim it can go into Documents. */
export function filledCopyFolderSentence(formKey: string): string {
  if (FILEABLE_FORM_KEYS.has(formKey)) return "A filled copy can be saved into any Documents folder.";
  return "A filled copy is stored on this form. It is not saved into a Documents folder.";
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** Print and sheet header. A blank number stays a revision with no document id. */
export function sheetRevision(formNumber: unknown, rev: unknown = "A"): string {
  const letter = textOf(rev).trim().replace(/^Rev:\s*/i, "") || "A";
  const number = textOf(formNumber).trim();
  return number ? `Doc ID: ${number} · Rev: ${letter}` : `Rev: ${letter}`;
}

/** The template revision stored on a filled instance. Falls back when the row has no stamp yet. */
export function instanceRevision(data: unknown, fallback = "A"): string {
  if (!data || typeof data !== "object") return fallback;
  const stamp = (data as { _formTemplate?: { revision?: unknown } })._formTemplate;
  const revision = stamp && typeof stamp.revision === "string" ? stamp.revision.trim().replace(/^Rev:\s*/i, "") : "";
  return revision || fallback;
}

/** Header document-id cell. A hardcoded FRM number is not shown until someone sets one. */
export function documentIdText(label: string | undefined, documentNumber: unknown, slot = false): string {
  const number = textOf(documentNumber).trim();
  const text = label ?? "";
  if (slot || /^FRM-[A-Z0-9-]+$/.test(text)) return number;
  if (text === "Doc ID:" || /^Doc ID:\s/.test(text)) return number ? `Doc ID: ${number}` : "Doc ID:";
  return text;
}

export function revisionLabel(formNumber: unknown, rev: unknown = "A"): string {
  const number = textOf(formNumber).trim();
  const letter = textOf(rev).trim() || "A";
  return number ? `${number} Rev ${letter}` : `Rev ${letter}`;
}
