import { pgTable, serial, text, integer, timestamp, numeric } from "drizzle-orm/pg-core";

export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contactEmail: text("contact_email"),
  status: text("status").notNull().default("active"), // active, probation, disqualified
  riskLevel: text("risk_level").default("unrated"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const supplierScorecards = pgTable("supplier_scorecards", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").references(() => suppliers.id).notNull(),
  period: text("period"), // e.g. "2026-Q1"
  qualityScore: numeric("quality_score"),
  deliveryScore: numeric("delivery_score"),
  overallScore: numeric("overall_score"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Supplier = typeof suppliers.$inferSelect;
export type SupplierScorecard = typeof supplierScorecards.$inferSelect;
