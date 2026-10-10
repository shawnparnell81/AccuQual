import { IMPORT_ENTITIES, type AnyImportEntity } from "./import.entities.js";
import { QUALITY_IMPORT_ENTITIES } from "./import.quality.js";
import { RETAILER_IMPORTS, retailerReportEntity } from "./import.retailer.js";

export interface ImportCatalogEntry {
  key: string;
  label: string;
  description: string;
  entity: AnyImportEntity;
  /** People can be emailed a one-time password. Off unless the admin asks. */
  supportsInvites?: boolean;
  /** Keep the file and parsed rows. Do not write suppliers, parts, or other records. */
  archiveOnly?: boolean;
}

/** Record types an administrator can load from a spreadsheet. Only tables that already exist. */
export const IMPORT_CATALOG: ImportCatalogEntry[] = [
  { key: "suppliers", label: "Suppliers", description: IMPORT_ENTITIES.suppliers.description, entity: IMPORT_ENTITIES.suppliers },
  { key: "customers", label: "Customer contacts", description: QUALITY_IMPORT_ENTITIES.customers.description, entity: QUALITY_IMPORT_ENTITIES.customers },
  { key: "parts", label: "Parts", description: "Part numbers. Stock counts aren't imported here; they're recorded as movements.", entity: IMPORT_ENTITIES.inventory_items },
  { key: "supplier_scorecards", label: "Supplier scorecards", description: QUALITY_IMPORT_ENTITIES.supplier_scorecards.description, entity: QUALITY_IMPORT_ENTITIES.supplier_scorecards },
  { key: "supplier_certifications", label: "Supplier certifications", description: QUALITY_IMPORT_ENTITIES.supplier_certifications.description, entity: QUALITY_IMPORT_ENTITIES.supplier_certifications },
  { key: "inspection_results", label: "Inspection results", description: QUALITY_IMPORT_ENTITIES.inspection_results.description, entity: QUALITY_IMPORT_ENTITIES.inspection_results },
  { key: "lots", label: "Lots and batches", description: QUALITY_IMPORT_ENTITIES.lots.description, entity: QUALITY_IMPORT_ENTITIES.lots },
  { key: "equipment", label: "Calibration equipment", description: QUALITY_IMPORT_ENTITIES.equipment.description, entity: QUALITY_IMPORT_ENTITIES.equipment },
  { key: "users", label: "Users", description: "User accounts. Nobody is emailed unless you tick that option. Owner and Administrator accounts can't be created this way.", entity: IMPORT_ENTITIES.people, supportsInvites: true },
  ...RETAILER_IMPORTS.map((entry) => ({ ...entry, entity: retailerReportEntity, archiveOnly: true })),
];

export function getCatalogEntry(key: string): ImportCatalogEntry | undefined {
  return IMPORT_CATALOG.find((entry) => entry.key === key);
}

export function rowIdentity(entity: AnyImportEntity, raw: Record<string, string>): string {
  if (entity.identityOf) return entity.identityOf(raw);
  const key = entity.fields[0]?.key ?? "";
  return (raw[key] ?? "").trim().toLowerCase();
}

export function rawFromMapping(entity: AnyImportEntity, mapping: Record<string, number | null>, cells: string[]): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const field of entity.fields) {
    const column = mapping[field.key];
    raw[field.key] = column == null ? "" : (cells[column] ?? "");
  }
  return raw;
}
