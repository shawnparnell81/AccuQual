export const SEARCH_TYPE_NAMES = ["NCR", "CAPA", "WO", "Audit", "Supplier", "Training", "Calibration", "RMA", "8D", "Document", "Change", "Risk", "PPAP"] as const;
export type SearchTypeName = (typeof SEARCH_TYPE_NAMES)[number];

const ALIASES: Record<SearchTypeName, string[]> = {
  NCR: ["ncr", "issue", "nonconformance"],
  CAPA: ["capa", "corrective"],
  WO: ["wo", "workorder", "work-order"],
  Audit: ["audit"],
  Supplier: ["supplier"],
  Training: ["training", "course"],
  Calibration: ["calibration", "gage", "gauge", "equipment"],
  RMA: ["rma"],
  "8D": ["8d", "eightd"],
  Document: ["document", "doc"],
  Change: ["change", "ecr"],
  Risk: ["risk"],
  PPAP: ["ppap"],
};

/** Empty filter matches every type. `type:ncr` matches NCR; `type:doc` matches Document. */
export function wantsRecordType(recordType: string, filter: string): boolean {
  const raw = filter.trim().toLowerCase();
  if (!raw) return true;
  const name = recordType.toLowerCase();
  if (name === raw || name.startsWith(raw)) return true;
  const aliases = ALIASES[recordType as SearchTypeName] ?? [];
  return aliases.some((alias) => alias === raw || alias.startsWith(raw));
}
