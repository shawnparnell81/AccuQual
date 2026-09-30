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
 * CSA Validation and Fuel Pump Validation keep their seeded numbers; they are filed the same way.
 */
export const FILEABLE_FORM_KEYS = new Set<string>([...EDITABLE_FORM_NUMBER_KEYS, "frm-val-001", "frm-val-007"]);

/** ISO form_type -> blank-template key. Only the six records stored on iso_quality_forms. */
export const ISO_TYPE_TO_FORM_KEY: Record<string, string> = {
  psw: "frm-psw-001",
  turtle_diagram: "frm-prc-001",
  quality_alert: "frm-qa-001",
  first_article: "frm-fai-001",
  customer_scorecard: "frm-cus-001",
  failure_effectiveness: "frm-fae-001",
};

export const FORM_DATA_TYPE_TO_FORM_KEY: Record<string, string> = {
  gage_rr: "frm-msa-001",
  pareto_chart: "frm-par-001",
};

/**
 * Subject folder suggested when someone files a filled copy.
 * The first segments that already exist in Documents are used.
 * The user can pick a different folder.
 */
export const SUGGESTED_SUBJECT_PATH: Record<string, string[]> = {
  "frm-psw-001": ["Engineering", "Supplier Engineering", "Supplier PPAP Submissions"],
  "frm-prc-001": ["Quality", "Quality Manual & Policies"],
  "frm-qa-001": ["Quality", "Customer Quality"],
  "frm-fai-001": ["Quality", "Production & Inspection", "First Article Inspection (FAI)"],
  "frm-cus-001": ["Quality", "Customer Quality"],
  "frm-fae-001": ["Quality", "Corrective & Preventive Actions", "Effectiveness Checks"],
  "frm-msa-001": ["Quality", "Calibration & Equipment", "Gage R&R"],
  "frm-par-001": ["Quality", "Production & Inspection", "Pareto Charts"],
  "frm-val-001": ["Engineering", "Design & Development", "Design Validation"],
  "frm-val-007": ["Engineering", "Manufacturing Engineering", "Process Validation"],
};

export function recordLinkedPath(formKey: string, recordId: number): string {
  if (formKey === "frm-msa-001") return `/calibration/${recordId}`;
  if (formKey === "frm-par-001") return "/pareto";
  if (formKey === "frm-val-001" || formKey === "frm-val-007") return `/validation-reports/${recordId}`;
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
