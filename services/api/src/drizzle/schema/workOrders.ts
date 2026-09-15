import { pgTable, serial, text, integer, timestamp, numeric, boolean } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";
import { inventoryItems } from "./inventory.js";
import { ncr } from "./ncr.js";

/**
 * A real, standalone production Work Order — the only "work order" that
 * existed anywhere in AccuQual before this was a printable PDF-style form
 * (`form_data`, formType "maintenance_work_order") for *equipment*
 * maintenance tickets: an unstructured jsonb blob meant for filling and
 * printing, not a queryable record. This table is the genuine production-
 * planning entity AI Work Order Planning needs to read and write against —
 * built because there was nothing real to build the AI feature on top of
 * (see the AI Work Order Planning / PR Justification / Onboarding / ERP
 * Automation review).
 *
 * status: planned | in_progress | completed | cancelled
 *
 * Completing a work order logs a real `inventory_movements` row
 * (movement_type "produce") via inventory.service.ts's existing movement
 * path, tagging referenceType="work_order"/referenceId=String(id) — both
 * are free-form text fields on that table already (see inventory.ts's own
 * comment on why they were left manual), not a new FK relationship.
 *
 * revision/firstPieceInspectionPassed/finalQcInspectionPassed/operator+inspector
 * signature fields back the real, pixel-specific shop-floor Production Work
 * Order traveler document (a bespoke standalone page, deliberately NOT built
 * through the shared FormLayout/GenericFormRenderer engine every other QMS
 * document uses — see the Work Order Traveler review) — quantityPlanned/
 * dueDate/linkedNcrId/notes/revision stay planning-stage-only edits (see
 * workOrders.controller.ts's updateWorkOrderHandler "planned" guard); the
 * quality gates/signatures/operations rows are real shop-floor execution
 * data and stay editable through "in_progress"/"completed" (only a
 * cancelled work order locks the traveler — see updateTravelerHandler).
 */
export const workOrders = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  itemId: integer("item_id").references(() => inventoryItems.id).notNull(),
  quantityPlanned: numeric("quantity_planned").notNull(),
  quantityCompleted: numeric("quantity_completed").notNull().default("0"),
  status: text("status").notNull().default("planned"),
  linkedNcrId: integer("linked_ncr_id").references(() => ncr.id),
  dueDate: timestamp("due_date"),
  notes: text("notes"),
  revision: text("revision"),
  firstPieceInspectionPassed: boolean("first_piece_inspection_passed").notNull().default(false),
  finalQcInspectionPassed: boolean("final_qc_inspection_passed").notNull().default(false),
  operatorSignature: text("operator_signature"),
  operatorSignedAt: timestamp("operator_signed_at"),
  inspectorSignature: text("inspector_signature"),
  inspectorSignedAt: timestamp("inspector_signed_at"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/**
 * The traveler's Operations Routing table (Op # / Description / Work
 * Center / Completed Qty / Sign-off + Date) — a real child table, not a
 * jsonb blob, so each operation row can be added/edited/signed off
 * independently as the job moves through the shop floor. signOffDate is
 * always server-stamped the moment signOff is first set (never
 * client-supplied) — same reasoning as every other real approval timestamp
 * in this app (decidedAt/activatedAt/etc.).
 */
export const workOrderOperations = pgTable("work_order_operations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: integer("work_order_id").references(() => workOrders.id).notNull(),
  opNumber: integer("op_number").notNull(),
  description: text("description").notNull(),
  workCenter: text("work_center"),
  completedQty: numeric("completed_qty"),
  signOff: text("sign_off"),
  signOffDate: timestamp("sign_off_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type WorkOrder = typeof workOrders.$inferSelect;
export type NewWorkOrder = typeof workOrders.$inferInsert;
export type WorkOrderOperation = typeof workOrderOperations.$inferSelect;
