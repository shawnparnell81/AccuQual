/**
 * Spreadsheet import targets. v1 is two templates that already exist in AccuQual.
 * Add another by appending a FormImportTemplate whose `key` is a real
 * controlled_form_templates.form_key and whose field keys are the keys that
 * template already saves. Do not invent FRM- or LST- numbers here.
 */

export type FormImportValueType = "text" | "number" | "date" | "boolean" | "cell";

export interface FormImportField {
  /** Stored key on the filled record. Cell addresses for CSA; column keys for the master list. */
  key: string;
  label: string;
  group: string;
  aliases: string[];
  required?: boolean;
  valueType: FormImportValueType;
  /**
   * Identifies a row that already exists. Never written as a new form number.
   * `document` matches DOC-{id} drafts and skips FRM-/LST- template numbers.
   */
  identity?: "document";
}

export interface FormImportTemplate {
  /** controlled_form_templates.form_key */
  key: string;
  /** Number already printed on this template. Shown in the wizard. Not assigned to imported rows. */
  printedId: string;
  title: string;
  /** Page the filled record opens on. `{id}` is the new record. */
  openPath: string;
  /** List page for this template, when the record itself is not the only place it shows up. */
  listPath: string;
  shape: "table" | "sheet";
  persist:
    | { kind: "document" }
    | { kind: "validation_report"; formType: "csa"; formKey: "frm-val-001"; stampKey: "validation:csa" };
  fields: FormImportField[];
}

const REGISTER = "Register";

function textField(key: string, label: string, aliases: string[], extra?: Partial<FormImportField>): FormImportField {
  return { key, label, group: REGISTER, aliases: [key, label, ...aliases], valueType: "text", ...extra };
}

const MASTER_DOCUMENT_LIST: FormImportTemplate = {
  key: "lst-gen-001",
  printedId: "LST-GEN-001",
  title: "Master Document List",
  openPath: "/documents/{id}",
  listPath: "/documents/master-list",
  shape: "table",
  persist: { kind: "document" },
  fields: [
    textField("title", "Document Title", ["title", "document name", "name", "doc title"], { required: true }),
    textField("documentId", "Document ID", ["document id", "doc id", "document number", "doc no"], { identity: "document" }),
    textField("revision", "Current Rev", ["current rev", "revision", "rev", "revision code"]),
    textField("location", "Location / Folder", ["location", "folder", "location folder", "category"]),
    textField("notes", "Rev History / Notes", ["rev history", "notes", "history", "change notes", "rev history notes"]),
  ],
};

const PART = "Part & inspection";
const STRUT = "Strut physicals";
const DAMPER = "Damper performance";
const COIL = "Coil spring";
const MOUNTS = "Mounts & bump stops";
const FINAL = "Final conclusion";

function cellField(key: string, label: string, group: string, aliases: string[], valueType: FormImportValueType = "text"): FormImportField {
  return { key, label, group, aliases: [key, label, ...aliases], valueType };
}

/** Input cells on the CSA sheet. Formula cells and gray cells are omitted; the sheet calculates those. */
function measure(group: string, row: number, criteria: string, cols: string): FormImportField[] {
  const role: Record<string, string> = { B: "Nominal", C: "Tolerance", D: "Sample 1", E: "Sample 2" };
  return cols.split("").map((col) => {
    const name = role[col] ?? col;
    const key = `${col}${row}`;
    return cellField(key, `${criteria} — ${name}`, group, [`${criteria} / ${name}`, `${criteria} ${name}`, `${name} ${criteria}`, `${criteria} - ${name}`], "cell");
  });
}

function checkField(key: string, label: string, aliases: string[]): FormImportField {
  return cellField(key, label, FINAL, aliases, "boolean");
}

const CSA_VALIDATION: FormImportTemplate = {
  key: "frm-val-001",
  printedId: "FRM-VAL-001",
  title: "CSA VALIDATION REPORT",
  openPath: "/validation-reports/{id}",
  listPath: "/folders/validation-reports",
  shape: "sheet",
  persist: { kind: "validation_report", formType: "csa", formKey: "frm-val-001", stampKey: "validation:csa" },
  fields: [
    cellField("G2", "Approved By", PART, ["approver"]),
    cellField("B6", "DMA Part Number", PART, ["part number", "part no", "dma pn", "dma part no"]),
    cellField("F6", "Drawing Number", PART, ["drawing no", "drawing", "dwg"]),
    cellField("B7", "Supplier / Factory", PART, ["supplier", "factory", "supplier factory"]),
    cellField("F7", "Batch Number", PART, ["batch", "lot", "lot number"]),
    cellField("B8", "Inspected By", PART, ["inspector", "inspected by"]),
    cellField("F8", "Inspection Date", PART, ["date", "inspection date"], "date"),
    ...measure(STRUT, 12, "Hardwear Grade", "BCDE"),
    ...measure(STRUT, 13, "Max Length (Extended) (mm)", "BCDE"),
    ...measure(STRUT, 14, "Min Length (Compressed) (mm)", "CE"),
    ...measure(STRUT, 15, "Stroke (mm)", "BCDE"),
    ...measure(STRUT, 16, "Displacement at Ride Height Force (mm)", "BCDE"),
    ...measure(STRUT, 18, "Strut Paint Thickness (µm)", "BCDE"),
    ...measure(DAMPER, 22, "Piston Rod Diameter (mm)", "BCDE"),
    ...measure(DAMPER, 23, "Compression Force @ 1.0m/s (N)", "BDE"),
    ...measure(DAMPER, 24, "Compression Force @ 0.6m/s (N)", "BDE"),
    ...measure(DAMPER, 25, "Compression Force @ 0.3m/s (N)", "BCDE"),
    ...measure(DAMPER, 26, "Compression Force @ 0.1m/s (N)", "BDE"),
    ...measure(DAMPER, 27, "Compression Force @ 0.05m/s (N)", "BDE"),
    ...measure(DAMPER, 28, "Rebound Force @ 0.05m/s (N)", "BDE"),
    ...measure(DAMPER, 29, "Rebound Force @ 0.1m/s (N)", "BDE"),
    ...measure(DAMPER, 30, "Rebound Force @ 0.3m/s (N)", "BCDE"),
    ...measure(DAMPER, 31, "Rebound Force @ 0.6m/s (N)", "BDE"),
    ...measure(DAMPER, 32, "Rebound Force @ 1.0m/s (N)", "BDE"),
    ...measure(COIL, 36, "Max Length (Free Height) (mm)", "BCDE"),
    ...measure(COIL, 37, "Outer Diameter (mm)", "BCDE"),
    ...measure(COIL, 38, "Coil Count (Total)", "BDE"),
    ...measure(COIL, 39, "Wire Thickness (mm)", "BCDE"),
    ...measure(COIL, 40, "Spring Rate (N/mm)", "BCDE"),
    ...measure(COIL, 41, "Spring Paint Thickness (µm)", "BCDE"),
    ...measure(MOUNTS, 45, "Mount Paint Thickness (µm)", "BCDE"),
    ...measure(MOUNTS, 46, "Bump Stop Length (mm)", "BCDE"),
    checkField("B49", "Sample 1 Pass", ["overall disposition sample 1 pass", "overall disposition sample 1 / pass", "sample 1 pass"]),
    checkField("D49", "Sample 1 Fail", ["overall disposition sample 1 fail", "overall disposition sample 1 / fail", "sample 1 fail"]),
    checkField("F49", "Sample 1 Conditional Pass", ["overall disposition sample 1 conditional pass", "overall disposition sample 1 / conditional pass", "sample 1 conditional pass"]),
    checkField("B50", "Sample 2 Pass", ["overall disposition sample 2 pass", "overall disposition sample 2 / pass", "sample 2 pass"]),
    checkField("D50", "Sample 2 Fail", ["overall disposition sample 2 fail", "overall disposition sample 2 / fail", "sample 2 fail"]),
    checkField("F50", "Sample 2 Conditional Pass", ["overall disposition sample 2 conditional pass", "overall disposition sample 2 / conditional pass", "sample 2 conditional pass"]),
    checkField("B51", "Overall Pass", ["overall disposition pass", "overall disposition / pass"]),
    checkField("D51", "Overall Fail", ["overall disposition fail", "overall disposition / fail"]),
    checkField("F51", "Overall Conditional Pass", ["overall disposition conditional pass", "overall disposition / conditional pass"]),
    cellField("B52", "Notes", FINAL, ["comments", "comment"]),
    cellField("G52", "Engineer who Approved Conditional Pass", FINAL, ["conditional pass engineer", "engineer"]),
  ],
};

export const FORM_IMPORT_TEMPLATES: FormImportTemplate[] = [MASTER_DOCUMENT_LIST, CSA_VALIDATION];

export function getFormImportTemplate(key: string): FormImportTemplate | undefined {
  return FORM_IMPORT_TEMPLATES.find((template) => template.key === key);
}
