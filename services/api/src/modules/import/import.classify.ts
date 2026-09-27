export type DuplicateMode = "skip" | "update" | "create_only";
export type BadRowMode = "skip" | "fail";

export interface ClassifiedRow {
  action: "create" | "update" | "skip" | "invalid";
  messages: string[];
}

/**
 * Decide what to do with one spreadsheet row.
 * A repeat inside the file is always a problem. A row that is already in the
 * database is skipped, updated, or rejected depending on the option chosen.
 */
export function classifyImportRow(args: {
  rowNumber: number;
  label: string;
  identity?: string;
  fieldErrors: string[];
  existing: Set<string>;
  seen: Map<string, number>;
  duplicateMode: DuplicateMode;
}): ClassifiedRow {
  const messages = [...args.fieldErrors];
  if (args.identity) {
    const first = args.seen.get(args.identity);
    if (first != null) {
      messages.push(`${args.label} appears more than once in the file (first on row ${first}).`);
      return { action: "invalid", messages };
    }
    args.seen.set(args.identity, args.rowNumber);
  }
  if (messages.length > 0) return { action: "invalid", messages };
  if (args.identity && args.existing.has(args.identity)) {
    if (args.duplicateMode === "update") return { action: "update", messages };
    if (args.duplicateMode === "skip") return { action: "skip", messages };
    messages.push(`${args.label} already exists.`);
    return { action: "invalid", messages };
  }
  return { action: "create", messages };
}
