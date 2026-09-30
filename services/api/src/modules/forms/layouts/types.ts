/**
 * A form layout schema: describes a real document (pasted by the user, e.g.
 * CAPA_Fillable_Template.pdf) as numbered sections of typed blocks, so ONE
 * renderer can reproduce it — on screen (apps/web) and on export (pdf-lib
 * here) — instead of hand-building a bespoke component per form type.
 *
 * This file is intentionally duplicated in apps/web/src/components/forms/layouts
 * (no shared package between the two yet, see workers/README.md for the same
 * tradeoff) — keep the two in sync when either changes.
 */

export interface FieldOption {
  value: string;
  label: string;
}

/** A single label+value field, rendered as one cell in a `row` block. */
export interface SimpleField {
  kind: "text" | "date" | "select" | "number" | "signature";
  name: string;
  label: string;
  hint?: string;
  options?: string[];
  /** Certification sentence shown with the PIN when kind is signature. */
  certify?: string;
  /** Display-only even in an editable form — for values owned by the parent record's workflow (e.g. a status that only moves through guarded endpoints). */
  readOnly?: boolean;
}

/** N fields laid out side by side (e.g. "CAPA Number" | "Date Initiated"). */
export interface RowBlock {
  type: "row";
  fields: SimpleField[];
}

/** One label + optional italic hint + a large free-text box. */
export interface TextareaBlock {
  type: "textarea";
  name: string;
  label: string;
  hint?: string;
}

/** A single Yes/No question. */
export interface YesNoBlock {
  type: "yesno";
  name: string;
  label: string;
}

export interface TableColumn {
  key: string;
  label: string;
  kind: "text" | "textarea" | "date" | "checkboxGroup" | "number" | "computed" | "select" | "signature";
  options?: string[]; // for checkboxGroup and select
  /** Certification sentence shown next to the PIN when kind is signature. */
  certify?: string;
  /** Checkboxes drawn beside one option. They stay disabled until that option is checked, and only one of them can be on. */
  beside?: { option: string; choices: string[] };
  min?: number; // for number — e.g. FMEA's 1-10 Severity/Occurrence/Detection ratings
  max?: number;
  /** Shown inside an empty text cell, for example "±0.10" on a tolerance column. */
  placeholder?: string;
  /**
   * For kind:"computed" — name of the client-side formula (apps/web's
   * formulas.ts) that derived this value. The server never evaluates it: the
   * client computes and saves the derived value into `data` on every edit, so
   * this renderer just prints whatever is stored, same as any other column.
   */
  formula?: string;
}

/**
 * A table block. `fixedRowLabels` (e.g. ["QA / Compliance Reviewer", "Approving
 * Manager"]) renders one non-addable row per label with that label locked into
 * the first column — for sign-off blocks. Omit it for a normal addable table
 * (e.g. an action-item list) and set `addableRows` instead.
 */
export interface TableBlock {
  type: "table";
  name: string;
  columns: TableColumn[];
  addableRows?: boolean;
  minRows?: number;
  fixedRowLabels?: string[];
  /** Header text for the locked label column when `fixedRowLabels` is set (e.g. "Role"). */
  labelColumnHeader?: string;
  /** Short note drawn under the table (FMEA R.P.N. / Action Priority legend). */
  legend?: string;
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
