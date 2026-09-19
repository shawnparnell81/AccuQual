/**
 * Mirrors services/api/src/modules/forms/layouts/types.ts — no shared package
 * between web and api yet (see workers/README.md for the same tradeoff
 * elsewhere in this repo). Keep the two in sync when either changes.
 */

export interface SimpleField {
  kind: "text" | "date" | "select" | "number";
  name: string;
  label: string;
  hint?: string;
  options?: string[];
  /** Display-only even in an editable form — for values owned by the parent record's workflow (e.g. a status that only moves through guarded endpoints). */
  readOnly?: boolean;
}

export interface RowBlock {
  type: "row";
  fields: SimpleField[];
}

export interface TextareaBlock {
  type: "textarea";
  name: string;
  label: string;
  hint?: string;
}

export interface YesNoBlock {
  type: "yesno";
  name: string;
  label: string;
}

export interface TableColumn {
  key: string;
  label: string;
  kind: "text" | "textarea" | "date" | "checkboxGroup" | "number" | "computed" | "select";
  options?: string[]; // for checkboxGroup and select
  /**
   * For kind:"number" — bounds shown as a hint and enforced on input (e.g. FMEA's
   * 1-10 Severity/Occurrence/Detection ratings).
   */
  min?: number;
  max?: number;
  /**
   * For kind:"computed" — name of a formula in components/forms/formulas.ts,
   * evaluated client-side from other columns in the same row and re-saved into
   * the row on every edit (and once on load) so the stored `data` — and
   * therefore the PDF export and any dashboard reading it — always holds the
   * live derived value rather than requiring every reader to recompute it.
   */
  formula?: string;
}

export interface TableBlock {
  type: "table";
  name: string;
  columns: TableColumn[];
  addableRows?: boolean;
  minRows?: number;
  fixedRowLabels?: string[];
  labelColumnHeader?: string;
}

export type Block = RowBlock | TextareaBlock | YesNoBlock | TableBlock;

export interface FormSection {
  number: string;
  title: string;
  blocks: Block[];
}

export interface FormLayout {
  formType: string;
  title: string;
  sections: FormSection[];
}
