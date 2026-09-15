import { pgTable, serial, text, integer, timestamp, numeric } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tenants } from "./tenants.js";

/**
 * The Risk Register — general risk tracking (severity x probability), distinct
 * from the FMEA line items below. `sourceType`/`sourceId` are a deliberately
 * unconstrained polymorphic reference (no FK — sourceType can be "NCR",
 * "Supplier", "Receiving", "WorkOrder", or "Manual", so a single FK column
 * can't target all of them; same precedent as complaints.linkedNcrId being a
 * plain integer). `department` is who owns/raised the risk, separate from
 * `ownerId` (the specific person responsible for driving it to closure).
 *
 * Two other real "risk" concepts exist elsewhere in AccuQual and are
 * deliberately NOT merged into this table (see the Risk Management module
 * review): `POST /ai/risk-score` is a standalone LLM-based supplier-risk
 * scorer (AI Insights page), and the Digital Twin's simulation risk heatmap
 * scores twin nodes, not real-world risk records. All three are labeled
 * distinctly in their own UI so they're never confused for one another.
 */
export const riskAssessments = pgTable("risk_assessments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category"), // supplier | process | product | safety | regulatory | other
  sourceType: text("source_type"), // NCR | Supplier | Receiving | WorkOrder | Manual
  sourceId: integer("source_id"),
  severity: integer("severity"), // 1-5
  probability: integer("probability"), // 1-5
  riskScore: integer("risk_score"), // severity * probability, computed server-side
  riskLevel: text("risk_level"), // low | medium | high | critical, derived from riskScore
  processArea: text("process_area"),
  department: text("department"),
  ownerId: integer("owner_id").references(() => users.id),
  status: text("status").notNull().default("open"), // open -> mitigation -> monitoring -> closed
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
  closedAt: timestamp("closed_at"),
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

/**
 * A concrete mitigation action against a risk — many per risk. Kept as its
 * own table (not jsonb on riskAssessments) since each has its own status
 * lifecycle and owner, the same reasoning eightD/capa's own sub-entities use.
 */
export const riskMitigations = pgTable("risk_mitigations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  riskAssessmentId: integer("risk_assessment_id").references(() => riskAssessments.id).notNull(),
  action: text("action").notNull(),
  dueDate: timestamp("due_date"),
  ownerId: integer("owner_id").references(() => users.id),
  status: text("status").notNull().default("planned"), // planned | in_progress | completed
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type RiskAssessment = typeof riskAssessments.$inferSelect;
export type FmeaItem = typeof fmeaItems.$inferSelect;
export type RiskMitigation = typeof riskMitigations.$inferSelect;
