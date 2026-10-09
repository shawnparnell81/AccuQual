import { and, desc, eq, inArray } from "drizzle-orm";
import { formData } from "../../drizzle/schema/forms.js";
import type { Db } from "../../lib/requestDb.js";
import { mapSeverityToClassification } from "./ncr.formSync.js";

export type NcrClassification = "Minor" | "Major" | "Critical";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

/** The checked words in a form checkbox group, in option order when that order is known. */
export function checkedOptions(value: unknown, order?: readonly string[]): string[] {
  const selected = new Set<string>();
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  for (const row of rows) {
    const record = asRecord(row) ?? {};
    const groups = Object.values(record);
    const candidates = groups.length > 0 ? groups : [row];
    for (const candidate of candidates) {
      const checks = asRecord(candidate);
      if (!checks) continue;
      for (const [name, on] of Object.entries(checks)) {
        if (on === true) selected.add(name);
      }
    }
  }
  if (order) return order.filter((name) => selected.has(name));
  return [...selected];
}

export function classificationFromForm(data: unknown): NcrClassification | null {
  const record = asRecord(data);
  const picked = checkedOptions(record?.ncrClassification, ["Minor", "Major", "Critical"]);
  const match = picked.find((name): name is NcrClassification => name === "Minor" || name === "Major" || name === "Critical");
  return match ?? null;
}

export function classificationLabel(data: unknown, severity: string | null | undefined): NcrClassification | null {
  return classificationFromForm(data) ?? mapSeverityToClassification(severity ?? null) ?? null;
}

/** What the list should show: the description's first line, then the record description, then the title. */
export function whatHappened(title: string, description: string | null | undefined, data: unknown): string {
  const record = asRecord(data);
  const fromForm = typeof record?.nonconformanceDescription === "string" ? firstLine(record.nonconformanceDescription) : "";
  if (fromForm) return fromForm;
  const fromRecord = description ? firstLine(description) : "";
  if (fromRecord) return fromRecord;
  return title;
}

/** Adds the form classification and the description's first line onto list rows. No new number is invented. */
export async function enrichNcrList(db: Db, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  const ids = rows.map((row) => row.id).filter((id): id is number => typeof id === "number");
  const forms = ids.length
    ? await db
        .select({ entityId: formData.entityId, data: formData.data })
        .from(formData)
        .where(and(eq(formData.formType, "ncr"), inArray(formData.entityId, ids)))
        .orderBy(desc(formData.id))
    : [];
  const byId = new Map<number, unknown>();
  for (const form of forms) {
    if (form.entityId != null && !byId.has(form.entityId)) byId.set(form.entityId, form.data);
  }
  return rows.map((row) => {
    const data = typeof row.id === "number" ? byId.get(row.id) : undefined;
    const severity = typeof row.severity === "string" ? row.severity : null;
    const title = typeof row.title === "string" ? row.title : "";
    const description = typeof row.description === "string" ? row.description : null;
    return {
      ...row,
      classification: classificationLabel(data, severity),
      whatHappened: whatHappened(title, description, data),
    };
  });
}
