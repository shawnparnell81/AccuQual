import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { sites } from "./sites.js";

/**
 * FAI & Inspection module (Phase 3: emails/charts/reports). New table only — same
 * convention as Phases 1-2 (not re-exported from schema/index.ts; hand-written
 * additive migration, the drizzle-kit snapshot has been stale since migration 0077).
 */

export interface FaiDistributionMember {
  /** An existing user (looked up for their current email at send time) or a typed-in address. */
  type: "user" | "email";
  userId?: number;
  email?: string;
}

/**
 * One distribution list. A list only hears about events that match ALL of the filters
 * it has set — an unset filter (null / empty array) matches everything on that axis.
 * eventTypes narrows which of the 5 event kinds this list wants; empty = all of them.
 */
export const faiDistributionLists = pgTable("fai_distribution_lists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  members: jsonb("members").$type<FaiDistributionMember[]>().notNull().default([]),
  matchSiteId: integer("match_site_id").references(() => sites.id),
  matchProductFamily: text("match_product_family"),
  matchTriggerReason: text("match_trigger_reason"),
  matchEventTypes: jsonb("match_event_types").$type<string[]>().notNull().default([]),
  mondaySummary: boolean("monday_summary").notNull().default(false), // opts into the 7am Monday digest
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type FaiDistributionList = typeof faiDistributionLists.$inferSelect;
