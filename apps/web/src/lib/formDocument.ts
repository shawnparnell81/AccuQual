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

export const FORM_KEY_BY_TYPE: Record<string, string> = {
  psw: "frm-psw-001",
  turtle_diagram: "frm-prc-001",
  quality_alert: "frm-qa-001",
  first_article: "frm-fai-001",
  customer_scorecard: "frm-cus-001",
  failure_effectiveness: "frm-fae-001",
  gage_rr: "frm-msa-001",
  pareto_chart: "frm-par-001",
};

/** Print and sheet header. A blank number stays "Rev: A". */
export function sheetRevision(formNumber: string | undefined): string {
  const number = (formNumber ?? "").trim();
  return number ? `Doc ID: ${number} · Rev: A` : "Rev: A";
}

export function revisionLabel(formNumber: string | undefined, rev = "A"): string {
  const number = (formNumber ?? "").trim();
  return number ? `${number} Rev ${rev}` : `Rev ${rev}`;
}
