import { pgTable, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { ncr } from "./ncr.js";

/**
 * 8D report. `data` holds the Blank 8D sheet (customer, part, D1–D8 boxes,
 * dates, and the document-review checkboxes) plus the older step keys
 * d1_team … d8_closure. Older text that matches a box is copied forward.
 * Text that does not match stays on the row for the Previous fields area.
 */
export const eightD = pgTable("eight_d", {
  id: serial("id").primaryKey(),
  ncrId: integer("ncr_id").references(() => ncr.id),
  currentStep: integer("current_step").notNull().default(1),
  data: jsonb("data").$type<Record<string, unknown>>().default({}),
  /** Problem Description D2 sheet. Cell addresses (E9, F9, …) hold what the user typed. */
  problemDescriptionD2: jsonb("problem_description_d2").$type<Record<string, string>>().notNull().default({}),
  /** Problem Solving Worksheet D4 sheet. */
  problemSolvingWorksheetD4: jsonb("problem_solving_worksheet_d4").$type<Record<string, string>>().notNull().default({}),
  /** Testing Possible Causes D4 sheet. */
  testingPossibleCausesD4: jsonb("testing_possible_causes_d4").$type<Record<string, string>>().notNull().default({}),
  /** Decision Making (D3 & D5) sheet. */
  decisionMaking: jsonb("decision_making").$type<Record<string, string>>().notNull().default({}),
  /** Risk Analysis sheet. */
  riskAnalysis: jsonb("risk_analysis").$type<Record<string, string>>().notNull().default({}),
  /** Plan & Problem Prevention sheet. */
  planProblemPrevention: jsonb("plan_problem_prevention").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type EightD = typeof eightD.$inferSelect;
export type NewEightD = typeof eightD.$inferInsert;
