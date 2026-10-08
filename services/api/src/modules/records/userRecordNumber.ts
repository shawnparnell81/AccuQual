import { z } from "zod";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { AppError } from "../../utils/appError.js";

/** Optional on create and update. Blank is stored as null by claimRecordNumber. */
export const recordNumberSchema = z.string().trim().max(120).nullable().optional();

/** Shown on the field and in the audit line when another record of this type already uses the number. */
export const DUPLICATE_RECORD_NUMBER = "That number is already used on another record of this type.";

const IDENT = /^[a-z_][a-z0-9_]*$/;

export interface RecordNumberSpec {
  table: string;
  column: string;
  /** Drizzle/API field name on the request body. */
  field: string;
  label: string;
  /** Uniqueness is within this column (for example form_type), not the whole table. */
  typeColumn?: string;
  typeField?: string;
  /** JSON text when the type lives inside a document (validation_reports.data.formType). */
  jsonType?: { column: string; path: string; fallback: string };
}

/** Blank, missing, and non-text values are stored as null. A number is optional. */
export function cleanRecordNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Case- and space-insensitive key. "NCR 1" and "ncr1" are the same number. */
export function recordNumberKey(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

/** What to print. Never substitutes the database id. */
export function showRecordNumber(value: unknown): string {
  return cleanRecordNumber(value) ?? "";
}

export function numberEdit(label: string, from: unknown, to: unknown): { label: string; from: string; to: string } | null {
  const before = showRecordNumber(from);
  const after = showRecordNumber(to);
  if (before === after) return null;
  return { label, from: before, to: after };
}

function quoteIdent(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Refusing identifier ${name}`);
  return `"${name}"`;
}

/**
 * Stores a user-typed number, or null when they left it blank.
 * Rejects a duplicate inside the same record type. The same text may be used on a different type.
 */
export async function claimRecordNumber(
  db: Db,
  spec: RecordNumberSpec,
  value: unknown,
  options?: { excludeId?: number; typeValue?: string | number | null },
): Promise<string | null> {
  const cleaned = cleanRecordNumber(value);
  if (!cleaned) return null;
  const key = recordNumberKey(cleaned);
  const column = sql.raw(quoteIdent(spec.column));
  const filters: SQL[] = [
    sql`${column} IS NOT NULL`,
    sql`btrim(${column}) <> ''`,
    sql`lower(regexp_replace(${column}, '[[:space:]]+', '', 'g')) = ${key}`,
  ];
  if (options?.excludeId != null) filters.push(sql`id <> ${options.excludeId}`);
  if (spec.typeColumn) {
    filters.push(sql`${sql.raw(quoteIdent(spec.typeColumn))} = ${options?.typeValue ?? null}`);
  }
  if (spec.jsonType) {
    const source = sql.raw(quoteIdent(spec.jsonType.column));
    filters.push(sql`COALESCE(${source}->>${spec.jsonType.path}, ${spec.jsonType.fallback}) = ${String(options?.typeValue ?? spec.jsonType.fallback)}`);
  }
  const where = sql.join(filters, sql` AND `);
  const found = await db.execute(sql`SELECT id FROM ${sql.raw(quoteIdent(spec.table))} WHERE ${where} LIMIT 1`);
  if ((found.rows ?? []).length > 0) throw AppError.badRequest(DUPLICATE_RECORD_NUMBER);
  return cleaned;
}

function jsonTypeOf(spec: RecordNumberSpec, source: Record<string, unknown> | undefined): string | null {
  if (!spec.jsonType || !source) return spec.jsonType?.fallback ?? null;
  const data = source.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return spec.jsonType.fallback;
  const value = (data as Record<string, unknown>)[spec.jsonType.path];
  return typeof value === "string" && value.trim() ? value : spec.jsonType.fallback;
}

export function recordTypeValue(spec: RecordNumberSpec, source: Record<string, unknown> | undefined): string | number | null {
  if (spec.jsonType) return jsonTypeOf(spec, source);
  if (!spec.typeField || !source) return null;
  const value = source[spec.typeField];
  return typeof value === "string" || typeof value === "number" ? value : null;
}

/** Audit payload that keeps the field edit and adds the old/new number pair. */
export function changesWithNumberEdit(
  body: Record<string, unknown>,
  change: { numberEdit: { label: string; from: string; to: string } } | null,
): Record<string, unknown> {
  if (!change) return body;
  return { ...body, numberEdit: change.numberEdit };
}

/** Writes the cleaned number back onto a request body and reports an audit pair when it changed. */
export async function applyRecordNumber(
  db: Db,
  body: Record<string, unknown>,
  spec: RecordNumberSpec,
  existing?: { id: number; current: unknown; row?: Record<string, unknown> },
): Promise<{ numberEdit: { label: string; from: string; to: string } } | null> {
  if (existing && !(spec.field in body)) return null;
  const typeSource = {
    ...(existing?.row ?? {}),
    ...body,
    data: body.data ?? existing?.row?.data,
  };
  const typeValue = recordTypeValue(spec, typeSource);
  const next = await claimRecordNumber(db, spec, spec.field in body ? body[spec.field] : null, {
    excludeId: existing?.id,
    typeValue,
  });
  if (spec.field in body || !existing) body[spec.field] = next;
  if (!existing) return null;
  const edit = numberEdit(spec.label, existing.current, next);
  return edit ? { numberEdit: edit } : null;
}
