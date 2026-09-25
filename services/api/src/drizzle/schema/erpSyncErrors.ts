import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { erpConnectorPresets } from "./erpPresets.js";

export const ERP_ERROR_TYPES = ["mappingError", "validationError", "transformError", "triggerError", "erpApiError", "unexpectedError"] as const;
export type ErpErrorType = (typeof ERP_ERROR_TYPES)[number];

export interface ErpSyncErrorFailedField {
  field: string;
  value: unknown;
  reason: string;
}

/** Only the failing field(s) + the record's own id — never the whole mapped record. See erpSyncErrors.ts's own module comment for why. */
export interface ErpSyncErrorPayloadSnapshot {
  sourceId: number;
  failedFields: ErpSyncErrorFailedField[];
}

/**
 * A durable, admin-visible record of one ERP sync failure — closes the gap
 * left by erpMappingEngine.ts's buildErpPayload, which already computes
 * real per-record validation errors but never persisted them anywhere
 * (they only rode along inside the outbound webhook payload). Always
 * tenant-owned (no "global" concept, unlike erp_connector_presets) — a
 * standard RLS tenant table, no special nullable-tenantId policy needed.
 *
 * payloadSnapshot is deliberately narrow: the failing record's id plus only
 * the specific field(s) that actually failed, never the entire mapped
 * record. This app's business data (supplier names/emails) isn't a
 * credential-grade secret, but an error log has no reason to duplicate a
 * full customer record when only the failing field matters for diagnosis.
 */
export const erpSyncErrors = pgTable("erp_sync_errors", {
  id: serial("id").primaryKey(),
  module: text("module").notNull(),
  presetId: integer("preset_id").references(() => erpConnectorPresets.id),
  presetVersion: integer("preset_version"),
  direction: text("direction").notNull().default("outbound"),
  errorType: text("error_type").notNull(),
  message: text("message").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>(),
  payloadSnapshot: jsonb("payload_snapshot").$type<ErpSyncErrorPayloadSnapshot | null>(),
  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: integer("resolved_by").references(() => users.id),
});

export type ErpSyncErrorRow = typeof erpSyncErrors.$inferSelect;
export type NewErpSyncError = typeof erpSyncErrors.$inferInsert;
