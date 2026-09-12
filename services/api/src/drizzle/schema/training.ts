import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tenants } from "./tenants.js";
import { documents } from "./documents.js";

export const trainingCourses = pgTable("training_courses", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  requiredForRoleId: integer("required_for_role_id"),
  // Optional link to a fully version-controlled record in `documents` — a
  // course's material (SOP, work instruction, training form) reuses the
  // whole approval/revision/expiration/retention system built for Document
  // Control instead of a second copy of it. Same pattern as
  // document_folders.documentId. Null until a course's material is linked.
  documentId: integer("document_id").references(() => documents.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const trainingAssignments = pgTable("training_assignments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  courseId: integer("course_id").references(() => trainingCourses.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  status: text("status").notNull().default("assigned"), // assigned, in_progress, completed, overdue
  dueAt: timestamp("due_at"),
  completedAt: timestamp("completed_at"),
  // Who assigned it (a real user, same convention as performedBy/approvedBy/
  // createdBy elsewhere) — createdAt already means "assigned at", so no
  // separate assignedAt column.
  assignedBy: integer("assigned_by").references(() => users.id),
  // trainerName stays free text (not a users FK) — the trainer is often an
  // outside vendor, not a system account, same reasoning as Calibration's
  // technicianName.
  trainerName: text("trainer_name"),
  notes: text("notes"),
  certificatePath: text("certificate_path"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type TrainingCourse = typeof trainingCourses.$inferSelect;
export type TrainingAssignment = typeof trainingAssignments.$inferSelect;
