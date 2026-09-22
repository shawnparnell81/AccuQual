import { pgTable, serial, integer, text, timestamp, jsonb, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

// Worker Runtime (the last of the four "Workforce & Operations Layer"
// modules — see accuqual-workforce-operations-layer.md): deliberately
// small, and built ON TOP of `users` rather than duplicating it. This
// table holds only what `users` doesn't already have (job title, shift,
// hire date, notes, a lightweight tags field) — department, role, and
// account status all already live on `users` itself. Assignment/activity
// is NOT stored here: it's a read-side aggregation over the same
// per-module `assignedTo`/`ownerId` columns the existing self-service
// Calendar (`modules/calendar`) already reads, reused rather than
// duplicated — see `modules/worker/worker.controller.ts`'s
// `getWorkerActivity`.

export const EMPLOYMENT_STATUSES = ["active", "on_leave", "terminated"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const workerProfiles = pgTable(
  "worker_profiles",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
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
    tenantUserUnique: unique("worker_profiles_tenant_user_unique").on(table.tenantId, table.userId),
  })
);

export type WorkerProfile = typeof workerProfiles.$inferSelect;
export type NewWorkerProfile = typeof workerProfiles.$inferInsert;
