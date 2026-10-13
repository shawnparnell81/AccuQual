/** Same shelf Folder Explorer calls Blank Forms Templates. */
export const BLANK_FORMS_SHELF = "Blank Forms Templates";

export interface BlankTemplateRow {
  formKey: string;
  formId: string;
  title: string;
  isoPath: string[];
  /** True when this template's folder is still under Blank Forms Templates. */
  onBlankShelf?: boolean;
}

/**
 * Templates that live on the Blank Forms Templates shelf.
 * A moved or deleted shortcut stays off this list. Living lists are not on that shelf.
 */
export function templatesOnBlankShelf<T extends BlankTemplateRow>(templates: T[]): T[] {
  return templates
    .filter((row) => (row.onBlankShelf == null ? row.isoPath.includes(BLANK_FORMS_SHELF) : row.onBlankShelf))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.formKey.localeCompare(b.formKey));
}

/** Topic folder under the shelf, used as the section heading. */
export function blankTemplateTopic(isoPath: string[]): string {
  const topic = [...isoPath].reverse().find((name) => name !== BLANK_FORMS_SHELF && name.trim());
  return topic ?? "Blank Forms";
}

/** Explorer-style file name: "FRM-DEV-009 Air Compressor ..." when a number is set, else just the title. */
export function blankFormFileName(row: { formId?: string | null; title: string; displayTitle?: string | null }): string {
  const title = row.displayTitle?.trim() || row.title;
  const number = (row.formId ?? "").trim();
  return number ? `${number} ${title}` : title;
}

/** A to Z by the shown file name. */
export function blankFormsByName<T extends { formId?: string | null; title: string; displayTitle?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => blankFormFileName(a).localeCompare(blankFormFileName(b), undefined, { sensitivity: "base", numeric: true }));
}

/** Client-side rename check, mirroring the API: trimmed, not empty, not another blank's name. */
export function blankRenameProblem(rows: { formKey: string; formId?: string | null; title: string; displayTitle?: string | null }[], formKey: string, name: string): string | null {
  const next = name.trim().replace(/\s+/g, " ");
  if (!next) return "Name is required";
  const target = rows.find((row) => row.formKey === formKey);
  if (!target) return "Blank form not found";
  const wanted = blankFormFileName({ formId: target.formId, title: next }).toLowerCase();
  const clash = rows.some((row) => row.formKey !== formKey && (blankFormFileName(row).toLowerCase() === wanted || (row.displayTitle?.trim() || row.title).toLowerCase() === next.toLowerCase()));
  return clash ? "Another blank form already has that name" : null;
}

/** Blank templates that belong to one Folders entry (a folder can group several form keys). Pinned above the saved copies. */
export function blankTemplatesForFolder<T extends { formKey: string; formId?: string | null; title: string; displayTitle?: string | null }>(templates: T[], formKeys: readonly string[]): T[] {
  const keys = new Set(formKeys);
  return blankFormsByName(templates.filter((template) => keys.has(template.formKey)));
}
