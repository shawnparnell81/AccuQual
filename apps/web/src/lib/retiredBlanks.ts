/**
 * First Article Inspection Report had two blanks. The QMS one (first_article_inspection) was retired with the
 * First Article module (migration 0114) and only bounced back to Blank Forms. The ISO blank FRM-FAI-001 is the one kept.
 */
export const KEPT_FAI_BLANK = "frm-fai-001";
export const KEPT_FAI_START = `/blank-forms/start/${KEPT_FAI_BLANK}`;
export const HIDDEN_BLANK_KEYS: ReadonlySet<string> = new Set(["first_article_inspection"]);

/** True for a folder link that opens the retired duplicate blank. */
export function isHiddenBlankLink(linkedPath: string | null | undefined): boolean {
  const path = (linkedPath ?? "").split("?")[0]?.split("#")[0] ?? "";
  for (const key of HIDDEN_BLANK_KEYS) {
    if (path === `/blank-forms/start/${key}` || path === `/qms-forms/${key}` || path.startsWith(`/qms-forms/${key}/`)) return true;
  }
  return false;
}

/** Form keys with no Folders entry on the API (RETIRED_FORM_FOLDER_KEYS). /blank-forms/:key for them only errors. */
export const NO_FOLDER_BLANK_KEYS: ReadonlySet<string> = new Set([KEPT_FAI_BLANK, ...HIDDEN_BLANK_KEYS]);

/** Where opening a blank from Blank Forms goes: its saved-copies folder, or straight to a new copy when it has none. */
export function blankOpenPath(formKey: string): string {
  if (HIDDEN_BLANK_KEYS.has(formKey)) return KEPT_FAI_START;
  if (NO_FOLDER_BLANK_KEYS.has(formKey)) return `/blank-forms/start/${encodeURIComponent(formKey)}`;
  return `/blank-forms/${encodeURIComponent(formKey)}`;
}
