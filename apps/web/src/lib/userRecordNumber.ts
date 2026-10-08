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
