import { integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { ncr } from "./ncr.js";
import { sites } from "./sites.js";
import { warrantyClaims } from "./warranty.js";

/**
 * Labor Claims. The claim number is typed by the person who opens the
 * record. Nothing in this module assigns the next number.
 *
 * status: open | pending | approved | denied | closed
 */
export const laborClaims = pgTable("labor_claims", {
  id: serial("id").primaryKey(),
  claimNumber: text("claim_number"),
  claimDate: timestamp("claim_date"),
  customerName: text("customer_name"),
  partName: text("part_name"),
  laborHours: numeric("labor_hours"),
  laborRate: numeric("labor_rate"),
  totalLaborCost: numeric("total_labor_cost"),
  warrantyClaimId: integer("warranty_claim_id").references(() => warrantyClaims.id),
  ncrId: integer("ncr_id").references(() => ncr.id),
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  siteId: integer("site_id").references(() => sites.id),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type LaborClaim = typeof laborClaims.$inferSelect;
export type NewLaborClaim = typeof laborClaims.$inferInsert;
