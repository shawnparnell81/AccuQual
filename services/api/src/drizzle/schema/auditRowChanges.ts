import { pgTable, serial, text, integer, timestamp, jsonb, bigint, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Field-level before/after history, written ONLY by the audit_row_change()
 * database trigger (see post-migrate/audit-triggers.sql) — never by app code,
 * so no code path can skip it and the app role has no INSERT,
 * UPDATE or DELETE privilege on it at all (read-only).
 *
 * `changes` is { column: { from, to } } for an UPDATE, { column: { to } } for
 * an INSERT and { column: { from } } for a DELETE. Secret-looking columns
 * (password/secret/token/key/encrypted/hash...) are stored as "[redacted]",
 * never their values, and very large values are replaced by a size marker.
 *
 * `txid` is the Postgres transaction id: the request's audit_trail entry
 * (which has the same column) and its row changes share it, which is how
 * the history screens attach "field: old -> new" to the right entry.
 *
 * company_id is deliberately NOT a foreign key: this is an append-only log
 * whose retention must not depend on the company row's lifecycle.
 */
export const auditRowChanges = pgTable(
  "audit_row_changes",
  {
    id: serial("id").primaryKey(),
    tableName: text("table_name").notNull(),
    rowId: integer("row_id"),
    op: text("op").notNull(), // INSERT | UPDATE | DELETE
    changes: jsonb("changes").$type<Record<string, { from?: unknown; to?: unknown }>>().notNull(),
    actorUserId: integer("actor_user_id"),
    txid: bigint("txid", { mode: "number" }).default(sql`txid_current()`),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("audit_row_changes_row_idx").on(table.tableName, table.rowId), index("audit_row_changes_tx_idx").on(table.txid)]
);

export type AuditRowChange = typeof auditRowChanges.$inferSelect;
