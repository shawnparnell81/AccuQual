import { pgTable, serial, integer, text, timestamp, jsonb, unique } from "drizzle-orm/pg-core";
import { users } from "./users.js";

// Extra fields `users` does not have. Department, role, and account status stay on `users`.
// Assignments are read from each module's assignee column, same as the calendar. See getWorkerActivity.

export const EMPLOYMENT_STATUSES = ["active", "on_leave", "terminated"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const workerProfiles = pgTable(
  "worker_profiles",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id).notNull(),
    jobTitle: text("job_title"),
    // Free text rather than an enum: shift naming (day/evening/night, or a
    // named crew like "A shift") varies enough between manufacturers that
    // an enum would just get worked around with "other" anyway.
    shift: text("shift"),
    hireDate: timestamp("hire_date"),
    // Lightweight tags (e.g. ["forklift certified", "CNC setup"]) — NOT a
    // formal qualification record. Training & Competency already owns
    // that (courses, evaluations, computed qualification status); this is
    // just a quick "what should I know about this person" field a
    // manager can jot down, with no workflow or expiry attached to it.
    skills: jsonb("skills").$type<string[]>().default([]),
    employmentStatus: text("employment_status").notNull().default("active"),
    notes: text("notes"),
    updatedAt: timestamp("updated_at").defaultNow(),
    updatedBy: integer("updated_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    userUnique: unique("worker_profiles_user_unique").on(table.userId),
  })
);

export type WorkerProfile = typeof workerProfiles.$inferSelect;
export type NewWorkerProfile = typeof workerProfiles.$inferInsert;
