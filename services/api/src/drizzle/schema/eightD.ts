import { pgTable, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { ncr } from "./ncr.js";

/**
 * 8D report. `data` holds the D1-D8 step content as structured JSON:
 * { d1_team, d2_problem, d3_containment, d4_rootCause, d5_correctiveAction,
 *   d6_implementation, d7_prevention, d8_closure }
 */
export const eightD = pgTable("eight_d", {
  id: serial("id").primaryKey(),
  ncrId: integer("ncr_id").references(() => ncr.id),
  currentStep: integer("current_step").notNull().default(1),
  data: jsonb("data").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type EightD = typeof eightD.$inferSelect;
export type NewEightD = typeof eightD.$inferInsert;
