import { sql, type SQL } from "drizzle-orm";
import { company } from "../../drizzle/schema/company.js";

/** Shown on AI Settings when ciphertext is stored but this process cannot decrypt it. */
export const KEY_UNREADABLE_MESSAGE = "Key saved but can't be read: server encryption key changed";

const KEY_COLUMNS = ["apiKeyEncrypted", "apiKeySetAt", "apiKeySetByName", "apiKeySetByUserId"] as const;

/**
 * True when the client did not supply a new provider key. A blank box, a
 * password-manager echo of the masked display, and the "[redacted]" audit
 * placeholder all land here. None of them may replace the stored ciphertext.
 */
export function ignorableApiKey(value: unknown): boolean {
  if (typeof value !== "string") return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/redacted/i.test(trimmed)) return true;
  if (/^[•*·.…]{2,}/.test(trimmed)) return true;
  if (/^[•*·.\s…]+$/.test(trimmed)) return true;
  if (/^leave blank/i.test(trimmed)) return true;
  if (trimmed === "sk-…" || trimmed === "sk-...") return true;
  return false;
}

/** The AI Settings line. Date is UTC so the same stored instant reads the same on every server. */
export function keyOnFileSentence(last4: string, savedBy: string | null, savedAt: Date | null): string {
  const base = `Key on file (ends in …${last4})`;
  if (!savedBy || !savedAt || Number.isNaN(savedAt.getTime())) return base;
  const date = savedAt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  return `${base}, saved by ${savedBy} on ${date}`;
}

export function keyColumnDrops(): string[] {
  return [...KEY_COLUMNS];
}

/**
 * Merges `patch` onto the company row's current ai_config inside the UPDATE.
 * The stored key is whatever the row holds at write time, unless `drop`
 * removes those columns or `patch` contains a new apiKeyEncrypted. Callers
 * must not pass a previously read copy of the ciphertext in `patch` just to
 * keep it — leaving it out is what keeps it.
 */
export function aiConfigAssignment(patch: Record<string, unknown>, drop: string[]): SQL {
  let base = sql`COALESCE(${company.aiConfig}, '{}'::jsonb)`;
  for (const key of drop) base = sql`${base} - CAST(${key} AS text)`;
  return sql`(${base}) || CAST(${JSON.stringify(patch)} AS jsonb)`;
}
