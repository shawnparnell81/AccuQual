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
