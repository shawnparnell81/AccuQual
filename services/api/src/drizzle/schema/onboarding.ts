import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Per-user onboarding checklist progress. Keyed by (userId,
 * moduleKey) rather than a single row: onboarding is naturally
 * per-user (same grain as trainingAssignments — two users at the same
 * company are at different points), and moduleKey is one of
 * departmentAccess.ts's real ResourceKey values, not a fabricated
 * "enabled module" concept (no such toggle exists anywhere in
 * this schema — see the AI Onboarding review).
 *
 * status: not_started | in_progress | completed
 */
export const onboardingProgress = pgTable("onboarding_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  moduleKey: text("module_key").notNull(),
  status: text("status").notNull().default("not_started"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type OnboardingProgress = typeof onboardingProgress.$inferSelect;
export type NewOnboardingProgress = typeof onboardingProgress.$inferInsert;
