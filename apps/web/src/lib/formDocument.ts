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
};

/** Print and sheet header. A blank number stays a revision with no document id. */
export function sheetRevision(formNumber: string | undefined, rev = "A"): string {
  const letter = rev.trim().replace(/^Rev:\s*/i, "") || "A";
  const number = (formNumber ?? "").trim();
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
export function documentIdText(label: string | undefined, documentNumber: string | undefined, slot = false): string {
  const number = (documentNumber ?? "").trim();
  const text = label ?? "";
  if (slot || /^FRM-[A-Z0-9-]+$/.test(text)) return number;
  if (text === "Doc ID:" || /^Doc ID:\s/.test(text)) return number ? `Doc ID: ${number}` : "Doc ID:";
  return text;
}

export function revisionLabel(formNumber: string | undefined, rev = "A"): string {
  const number = (formNumber ?? "").trim();
  return number ? `${number} Rev ${rev}` : `Rev ${rev}`;
}
