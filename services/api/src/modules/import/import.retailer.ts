import type { AnyImportEntity, ImportField } from "./import.entities.js";

/** Optional on purpose. A retailer file is not required to use these names. */
export const RETAILER_FIELDS: ImportField[] = [
  { key: "report_date", label: "Report date", help: "Optional. Leave unmapped when the file has no date column.", example: "2026-10-01", aliases: ["date", "invoice date", "period", "report period"] },
  { key: "part_number", label: "Part number", example: "FP-100", aliases: ["part", "item", "sku", "product", "item number"] },
  { key: "description", label: "Description", example: "Fuel pump", aliases: ["desc", "part description", "item description"] },
  { key: "store_or_customer", label: "Store or customer", example: "Store 42", aliases: ["store", "customer", "account", "retailer", "location"] },
  { key: "returns_count", label: "Returns", help: "How many returns, when the file has a count.", example: "3", aliases: ["returns", "return qty", "qty returned", "return count", "quantity"] },
  { key: "warranty_amount", label: "Warranty amount", example: "120.00", aliases: ["warranty", "warranty $", "warranty dollars", "warranty cost"] },
  { key: "labor_amount", label: "Labor amount", example: "40.00", aliases: ["labor", "labor $", "labor dollars", "labor cost"] },
  { key: "total_amount", label: "Total amount", example: "160.00", aliases: ["total", "amount", "extended", "net", "extended amount"] },
  { key: "claim_number", label: "Claim number", example: "CLM-100", aliases: ["claim", "claim no", "claim #", "rma"] },
  { key: "notes", label: "Notes", example: "Core returned", aliases: ["note", "comment", "comments"] },
];

const emptyLookups = { existing: new Set<string>(), ids: new Map<string, number>() };

/** Kept as a file plus parsed rows. Nothing is written into suppliers, parts, or claims. */
export const retailerReportEntity: AnyImportEntity = {
  key: "retailer_report",
  label: "Retailer report",
  description: "A customer or retailer spreadsheet. Columns are mapped once and reused. The original file and every row are kept.",
  fields: RETAILER_FIELDS,
  async prepare() {
    return emptyLookups;
  },
  validate(raw) {
    return { errors: [], value: raw, identity: "" };
  },
  async insert() {
    throw new Error("Retailer reports are stored with the imported file.");
  },
  identityOf() {
    return "";
  },
};

export const RETAILER_IMPORTS = [
  {
    key: "oreilly_reports",
    label: "O'Reilly's Reports",
    description: "An O'Reilly customer or retailer report (CSV or Excel). Map the columns once. Next month's file uses that map when the headers match.",
  },
  {
    key: "napa_reports",
    label: "NAPA Reports",
    description: "A NAPA customer or retailer report (CSV or Excel). Map the columns once. Next month's file uses that map when the headers match.",
  },
] as const;

export function retailerFieldLabel(key: string): string {
  return RETAILER_FIELDS.find((field) => field.key === key)?.label ?? key;
}
