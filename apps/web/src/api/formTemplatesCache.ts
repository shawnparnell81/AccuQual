/** Shared by every screen that reads blank-form templates. The value is always the templates array. */
export const FORM_TEMPLATES_QUERY_KEY = ["form-templates"] as const;

/** Same default the API uses when a template row has no pattern of its own. */
export const DEFAULT_FILE_NAME_PATTERN = "{formId}_{recordNumber}_{date}";

export interface FormTemplateStart {
  createPath: string;
  body: Record<string, unknown>;
  openPath: string;
}

export interface FormTemplateCacheRow {
  id?: number;
  formKey: string;
  formId: string;
  title: string;
  subjectRoute: string;
  folderId?: number | null;
  isoPath: string[];
  /** True when this template's folder is still under Blank Forms Templates. */
  onBlankShelf?: boolean;
  fileNamePattern: string;
  start: FormTemplateStart | null;
}

/**
 * GET /document-folders/form-templates returns `{ fileNamePattern, templates }`.
 * Each row already includes `fileNamePattern`, so the shared cache stores `templates` only.
 * Callers that used to keep the envelope made `.find` and `.filter` throw on the next screen.
 */
export function formTemplatesFromBody(body: unknown): FormTemplateCacheRow[] {
  if (Array.isArray(body)) return body as FormTemplateCacheRow[];
  if (body && typeof body === "object" && Array.isArray((body as { templates?: unknown }).templates)) {
    return (body as { templates: FormTemplateCacheRow[] }).templates;
  }
  return [];
}

/** File name for a filled record. Uses the row pattern, then the shared default. */
export function recordFileNamePattern(template: { fileNamePattern?: string } | null | undefined): string {
  return template?.fileNamePattern ?? DEFAULT_FILE_NAME_PATTERN;
}
