import { pgTable, serial, text, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tenants } from "./tenants.js";

export const ERP_PRESET_VENDORS = ["sap", "oracle", "netsuite", "epicor", "dynamics", "custom"] as const;
export type ErpPresetVendor = (typeof ERP_PRESET_VENDORS)[number];

// Deliberately a superset of ErpSyncSettings.modulesEnabled (settings.erpSync.ts):
// inventory/suppliers/purchaseOrders/workOrders are the ERP-native modules a
// sync can actually enable today; ncr/capa/training/audits/documentControl are
// QMS modules a tenant may want to push into an ERP's own quality/HR module
// (e.g. SAP QM) — a preset can target any of these, but the mapping engine
// (erpMappingEngine.ts) only has real per-record data wired for suppliers and
// purchaseOrders in this pass; the rest are explicitly deferred, not silently
// ignored (see erpMappingEngine.ts's own comment).
export const ERP_PRESET_MODULES = [
  "inventory",
  "suppliers",
  "purchaseOrders",
  "workOrders",
  "ncr",
  "capa",
  "training",
  "audits",
  "documentControl",
] as const;
export type ErpPresetModule = (typeof ERP_PRESET_MODULES)[number];

export type ErpTransformRule =
  | { kind: "dateFormat"; from: string; to: string }
  | { kind: "statusMap"; map: Record<string, string>; default?: string }
  | { kind: "codeMap"; map: Record<string, string>; default?: string }
  | { kind: "stringCase"; case: "upper" | "lower" | "title" }
  | { kind: "staticValue"; value: string }
  // Plain "{{field}}" substitution against the source record only — never
  // evaluated as code. See erpMappingEngine.ts's applyTemplate for the one
  // regex this supports.
  | { kind: "template"; template: string }
  // Fixed, enumerable arithmetic — never a real expression evaluator, same
  // "closed operator set" convention as workflow-engine.ts's evaluateCondition.
  | { kind: "numeric"; op: "round" | "multiply" | "divide" | "add"; value?: number }
  | { kind: "boolean"; op: "invert" | "toYesNo" | "toTrueFalseString" };

export interface ErpFieldMapping {
  source: string;
  target: string;
  direction?: "push" | "pull" | "both";
  transform?: ErpTransformRule;
  required?: boolean;
}

export interface ErpTriggerRule {
  on: "create" | "update" | "statusChange" | "workflowEvent";
  statusValues?: string[];
}

export interface ErpValidationRule {
  field: string;
  required?: boolean;
  type?: "string" | "number" | "date" | "boolean";
  allowedValues?: string[];
  /** A plain RegExp source (no flags) run against the field's string value — e.g. "^[A-Z]{2}\\d{4}$". */
  pattern?: string;
  /** Cross-field check: this field's value must equal `equalsField`'s current value on the same record. */
  equalsField?: string;
}

export interface ErpPresetMappingConfig {
  fieldMappings: ErpFieldMapping[];
  triggers: ErpTriggerRule[];
  validationRules: ErpValidationRule[];
}

export interface ErpPresetVersionEntry {
  version: number;
  mappingConfig: ErpPresetMappingConfig;
  updatedAt: string;
  updatedBy: number | null;
}

const EMPTY_MAPPING_CONFIG: ErpPresetMappingConfig = { fieldMappings: [], triggers: [], validationRules: [] };

/**
 * A tenant-selectable (or AccuQual-provided, tenantId null) ERP integration
 * preset: which vendor, which AccuQual module, and the field mappings/
 * transforms/triggers/validation rules `erpMappingEngine.ts` applies when
 * building an outbound sync payload for that module. Exactly one preset can
 * be `isActive` per (tenantId, module) pair — enforced in application code
 * (erpPresets.service.ts's activatePreset, one transaction), same "no DB
 * constraint, app-enforced" convention `workflowDefinitions.isActive`
 * already uses for its own per-module activation.
 *
 * No existing table combines soft-delete + version/versionHistory + a jsonb
 * config column in one place — this establishes that combination fresh,
 * deliberately following three separate existing precedents at once:
 * `isDeleted` from ncr.ts/documents.ts, `version`/`versionHistory` (bump
 * only on a real mappingConfig change, 20-entry cap — see
 * workflow.controller.ts's updateHandler) from workflowDefinitions, and
 * jsonb-config-per-row from tenants.erpSyncSettings.
 */
export const erpConnectorPresets = pgTable("erp_connector_presets", {
  id: serial("id").primaryKey(),
  // null = a global, AccuQual-provided preset (seedErpPresets.ts) — visible
  // to every tenant but not directly editable; "Customize" clones it into a
  // real tenant-owned row instead.
  tenantId: integer("tenant_id").references(() => tenants.id),
  vendor: text("vendor").notNull(),
  module: text("module").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  direction: text("direction").notNull().default("push"), // push | pull | bidirectional — same vocabulary as ErpSyncSettings.direction
  mappingConfig: jsonb("mapping_config").$type<ErpPresetMappingConfig>().notNull().default(EMPTY_MAPPING_CONFIG),
  version: integer("version").notNull().default(1),
  versionHistory: jsonb("version_history").$type<ErpPresetVersionEntry[]>().default([]),
  isActive: boolean("is_active").notNull().default(false),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type ErpConnectorPreset = typeof erpConnectorPresets.$inferSelect;
export type NewErpConnectorPreset = typeof erpConnectorPresets.$inferInsert;
