import { eq, and } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import type { ErpConnectorPreset, ErpFieldMapping, ErpTransformRule, ErpTriggerRule, ErpValidationRule } from "../../drizzle/schema/erpPresets.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { erpPurchaseOrders } from "../../drizzle/schema/erp.js";
import { logger } from "../../utils/logger.js";

// A tenant may manually trigger a sync at any time (see settings.erpSync.ts's
// own "no background scheduler exists" comment) — there's no reliable "since
// last sync" cursor to filter on (suppliers has no updatedAt column at all),
// so this caps how many current, non-deleted records get mapped per trigger
// rather than attempting incremental sync.
const MAX_RECORDS_PER_SYNC = 200;

export interface MappedRecord {
  sourceId: number;
  fields: Record<string, unknown>;
}

export interface ValidationError {
  sourceId: number;
  field: string;
  message: string;
}

export interface ErpPayloadResult {
  module: string;
  records: MappedRecord[];
  errors: ValidationError[];
}

function resolveSourceValue(record: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), record);
}

/** Plain "{{field}}" substitution against the source record — never evaluated as code, matching this app's existing "safe DSL, not eval" convention (see workflow-engine.ts's evaluateCondition). */
function applyTemplate(template: string, record: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const value = resolveSourceValue(record, path);
    return value == null ? "" : String(value);
  });
}

function formatDate(value: unknown, toFormat: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const parts: Record<string, string> = {
    YYYY: String(date.getUTCFullYear()),
    MM: pad(date.getUTCMonth() + 1),
    DD: pad(date.getUTCDate()),
  };
  return toFormat.replace(/YYYY|MM|DD/g, (token) => parts[token] ?? token);
}

function applyStringCase(value: string, kind: "upper" | "lower" | "title"): string {
  if (kind === "upper") return value.toUpperCase();
  if (kind === "lower") return value.toLowerCase();
  return value.replace(/\w\S*/g, (word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase());
}

function applyNumeric(rawValue: unknown, op: "round" | "multiply" | "divide" | "add", operand?: number): unknown {
  const n = typeof rawValue === "number" ? rawValue : Number(rawValue);
  if (isNaN(n)) return rawValue;
  switch (op) {
    case "round":
      return Math.round(n);
    case "multiply":
      return n * (operand ?? 1);
    case "divide":
      return operand ? n / operand : n;
    case "add":
      return n + (operand ?? 0);
  }
}

function applyBoolean(rawValue: unknown, op: "invert" | "toYesNo" | "toTrueFalseString"): unknown {
  const b = typeof rawValue === "boolean" ? rawValue : rawValue === "true" || rawValue === true;
  switch (op) {
    case "invert":
      return !b;
    case "toYesNo":
      return b ? "Yes" : "No";
    case "toTrueFalseString":
      return b ? "true" : "false";
  }
}

function applyTransform(rawValue: unknown, transform: ErpTransformRule, record: Record<string, unknown>): unknown {
  switch (transform.kind) {
    case "dateFormat":
      return formatDate(rawValue, transform.to);
    case "statusMap":
      return transform.map[String(rawValue)] ?? transform.default ?? rawValue;
    case "codeMap":
      return transform.map[String(rawValue)] ?? transform.default ?? rawValue;
    case "stringCase":
      return typeof rawValue === "string" ? applyStringCase(rawValue, transform.case) : rawValue;
    case "staticValue":
      return transform.value;
    case "template":
      return applyTemplate(transform.template, record);
    case "numeric":
      return applyNumeric(rawValue, transform.op, transform.value);
    case "boolean":
      return applyBoolean(rawValue, transform.op);
  }
}

/**
 * The reverse of applyTransform, for mapInboundRecord — only meaningful for
 * transforms that are actually invertible. statusMap/codeMap reverse via a
 * lookup on their own map (first key whose value matches); numeric "add"/
 * "multiply" invert arithmetically. Everything else (staticValue, template,
 * dateFormat, stringCase, numeric round/divide, boolean) is lossy by nature
 * — one AccuQual value can't always be recovered from its transformed ERP
 * value — so those pass the raw ERP value through unchanged rather than
 * guessing, and the caller is told via `invertible: false` in the result.
 */
function reverseTransform(erpValue: unknown, transform: ErpTransformRule): { value: unknown; invertible: boolean } {
  switch (transform.kind) {
    case "statusMap":
    case "codeMap": {
      const entry = Object.entries(transform.map).find(([, erp]) => erp === String(erpValue));
      return entry ? { value: entry[0], invertible: true } : { value: erpValue, invertible: false };
    }
    case "numeric":
      if (transform.op === "add") return { value: applyNumeric(erpValue, "add", -(transform.value ?? 0)), invertible: true };
      if (transform.op === "multiply" && transform.value) return { value: applyNumeric(erpValue, "divide", transform.value), invertible: true };
      return { value: erpValue, invertible: false };
    case "boolean":
      if (transform.op === "invert") return { value: applyBoolean(erpValue, "invert"), invertible: true };
      return { value: erpValue, invertible: false };
    default:
      return { value: erpValue, invertible: false };
  }
}

/** Maps + transforms one source record according to a preset's field mappings. Pure function, no I/O — safe to unit-test and to preview client-side. */
export function applyFieldMapping(record: Record<string, unknown>, fieldMappings: ErpFieldMapping[]): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const mapping of fieldMappings) {
    const rawValue = resolveSourceValue(record, mapping.source);
    mapped[mapping.target] = mapping.transform ? applyTransform(rawValue, mapping.transform, record) : rawValue;
  }
  return mapped;
}

export interface InboundMappingResult {
  fields: Record<string, unknown>;
  /** Field mappings whose transform couldn't be reversed — the ERP value was passed through unchanged rather than guessed. Surfaced so a caller can decide whether that's acceptable for this field. */
  unmappableFields: string[];
}

/**
 * ERP → AccuQual direction: the reverse of applyFieldMapping, translating an
 * ERP-shaped payload back into AccuQual field names using the SAME preset's
 * field mappings (mapping.target is the ERP field, mapping.source becomes
 * the AccuQual field being written to). A pure function only — there is no
 * inbound HTTP receiver in this app yet (no third-party ERP can push data in
 * today); this exists so that capability can be added later without
 * redesigning the mapping logic, and so the translation itself is tested
 * now rather than written untested alongside a future endpoint.
 */
export function mapInboundRecord(erpRecord: Record<string, unknown>, fieldMappings: ErpFieldMapping[]): InboundMappingResult {
  const fields: Record<string, unknown> = {};
  const unmappableFields: string[] = [];
  for (const mapping of fieldMappings) {
    if (mapping.direction === "push") continue; // push-only mappings don't participate in an inbound sync
    const erpValue = resolveSourceValue(erpRecord, mapping.target);
    if (!mapping.transform) {
      fields[mapping.source] = erpValue;
      continue;
    }
    const { value, invertible } = reverseTransform(erpValue, mapping.transform);
    fields[mapping.source] = value;
    if (!invertible) unmappableFields.push(mapping.source);
  }
  return { fields, unmappableFields };
}

/**
 * Does a real event match one of a preset's trigger rules? Used by
 * settings.erpSync.ts's manual trigger endpoint to decide which enabled
 * modules actually need mapping this run when the caller supplies an
 * `event` — omitting `event` (today's default "Trigger Sync Now" button)
 * skips this check entirely and syncs every enabled module, unchanged from
 * before triggers existed.
 */
export function evaluateTrigger(triggers: ErpTriggerRule[], event: { on: ErpTriggerRule["on"]; statusValue?: string }): boolean {
  if (triggers.length === 0) return true; // no trigger rules configured — a preset with none is always eligible, same as before this existed
  return triggers.some((rule) => {
    if (rule.on !== event.on) return false;
    if (rule.on === "statusChange" && rule.statusValues && rule.statusValues.length > 0) {
      return event.statusValue !== undefined && rule.statusValues.includes(event.statusValue);
    }
    return true;
  });
}

/** Checked against the ORIGINAL source record (not the mapped output) — a validation rule names an AccuQual field, same as a field mapping's own `source`. */
export function applyValidation(record: Record<string, unknown>, validationRules: ErpValidationRule[]): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];
  for (const rule of validationRules) {
    const value = resolveSourceValue(record, rule.field);
    if (rule.required && (value === undefined || value === null || value === "")) {
      errors.push({ field: rule.field, message: `${rule.field} is required` });
      continue;
    }
    if (value == null) continue;
    if (rule.type === "number" && typeof value !== "number") errors.push({ field: rule.field, message: `${rule.field} must be a number` });
    if (rule.type === "boolean" && typeof value !== "boolean") errors.push({ field: rule.field, message: `${rule.field} must be a boolean` });
    if (rule.type === "date" && isNaN(new Date(String(value)).getTime())) errors.push({ field: rule.field, message: `${rule.field} must be a valid date` });
    if (rule.allowedValues && !rule.allowedValues.includes(String(value))) errors.push({ field: rule.field, message: `${rule.field} must be one of: ${rule.allowedValues.join(", ")}` });
    if (rule.pattern && !new RegExp(rule.pattern).test(String(value))) errors.push({ field: rule.field, message: `${rule.field} does not match the required pattern` });
    if (rule.equalsField) {
      const otherValue = resolveSourceValue(record, rule.equalsField);
      if (String(value) !== String(otherValue)) errors.push({ field: rule.field, message: `${rule.field} must equal ${rule.equalsField}` });
    }
  }
  return errors;
}

async function loadSupplierRecords(db: TenantDb, tenantId: number): Promise<Record<string, unknown>[]> {
  const rows = await db.select().from(suppliers).where(eq(suppliers.tenantId, tenantId)).limit(MAX_RECORDS_PER_SYNC);
  return rows as unknown as Record<string, unknown>[];
}

async function loadPurchaseOrderRecords(db: TenantDb, tenantId: number): Promise<Record<string, unknown>[]> {
  const rows = await db.select().from(erpPurchaseOrders).where(and(eq(erpPurchaseOrders.tenantId, tenantId))).limit(MAX_RECORDS_PER_SYNC);
  return rows as unknown as Record<string, unknown>[];
}

/**
 * Wired to real per-record data for "suppliers" and "purchaseOrders" only —
 * the two ERP-native modules a vendor system natively has fields for. Every
 * other module (ncr/capa/training/audits/documentControl) is explicitly
 * deferred: this returns null with a logged reason rather than silently
 * producing an empty/misleading payload, so a tenant enabling one of those
 * modules on a sync gets an honest signal instead of a false "synced".
 */
export async function buildErpPayload(db: TenantDb, tenantId: number, module: string, preset: ErpConnectorPreset): Promise<ErpPayloadResult | null> {
  let sourceRecords: Record<string, unknown>[];
  if (module === "suppliers") {
    sourceRecords = await loadSupplierRecords(db, tenantId);
  } else if (module === "purchaseOrders") {
    sourceRecords = await loadPurchaseOrderRecords(db, tenantId);
  } else {
    logger.info(`ERP preset mapping engine has no wired record source for module "${module}" yet — skipping`, { tenantId, module });
    return null;
  }

  const records: MappedRecord[] = [];
  const errors: ValidationError[] = [];
  for (const record of sourceRecords) {
    const validationErrors = applyValidation(record, preset.mappingConfig.validationRules);
    if (validationErrors.length > 0) {
      for (const err of validationErrors) errors.push({ sourceId: record.id as number, ...err });
      continue;
    }
    records.push({ sourceId: record.id as number, fields: applyFieldMapping(record, preset.mappingConfig.fieldMappings) });
  }
  // Structured, multi-tenant-safe summary — counts and preset identity only,
  // never field values (a mapped record can carry a customer/vendor name,
  // email, or address; this app's own logging convention, confirmed earlier
  // this session against every logger.* call site, never logs raw record
  // content, only IDs/counts/metadata).
  logger.info("ERP preset mapping run complete", {
    tenantId,
    module,
    presetId: preset.id,
    presetVersion: preset.version,
    recordsMapped: records.length,
    recordsRejected: errors.length,
  });
  return { module, records, errors };
}
