import { pgTable, serial, text, integer, timestamp, numeric } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tenants } from "./tenants.js";

export const riskAssessments = pgTable("risk_assessments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  title: text("title").notNull(),
  processArea: text("process_area"),
  status: text("status").notNull().default("open"),
  ownerId: integer("owner_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

/** FMEA line items: Severity x Occurrence x Detection = RPN */
export const fmeaItems = pgTable("fmea_items", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  riskAssessmentId: integer("risk_assessment_id").references(() => riskAssessments.id).notNull(),
  failureMode: text("failure_mode").notNull(),
  effect: text("effect"),
  cause: text("cause"),
  severity: integer("severity").notNull(),
  occurrence: integer("occurrence").notNull(),
  detection: integer("detection").notNull(),
  rpn: numeric("rpn"),
  recommendedAction: text("recommended_action"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type RiskAssessment = typeof riskAssessments.$inferSelect;
export type FmeaItem = typeof fmeaItems.$inferSelect;
