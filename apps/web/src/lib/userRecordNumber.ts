/** A user-typed record number. Blank stays blank — the database id is only for the URL. */
export function showRecordNumber(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

/** List, header, search, and print label. Omits the number when the user has not entered one. */
export function recordHeading(kind: string, number: unknown): string {
  const shown = showRecordNumber(number);
  return shown ? `${kind} ${shown}` : kind;
}

/** Saved-copy file name. A blank number is left out, so the name is {formId}_{date}. */
export function copyFileName(pattern: string, formId: string, recordNumber: unknown, createdAt?: string | null): string {
  const date = (createdAt ?? "").slice(0, 10);
  const id = formId.trim();
  const token = showRecordNumber(recordNumber);
  let used = pattern;
  if (!id) used = used.replace(/\{formId\}_?/g, "");
  if (!token) used = used.replace(/\{recordNumber\}_?|_\{recordNumber\}/g, "");
  return used.replaceAll("{formId}", id).replaceAll("{recordNumber}", token).replaceAll("{date}", date).replace(/_+/g, "_").replace(/^_|_$/g, "");
}

/** Audit log subject. Uses a typed number from the change. Never prints the database id. */
export function auditSubject(entityType: string, changes: Record<string, unknown> | null | undefined): string {
  const record = changes && typeof changes === "object" ? changes : {};
  const direct = showRecordNumber(record.recordNumber);
  const edit = record.numberEdit && typeof record.numberEdit === "object" ? (record.numberEdit as Record<string, unknown>) : null;
  const edited = showRecordNumber(edit?.to);
  const shown = direct || edited;
  return shown ? `${entityType} ${shown}` : entityType;
}
