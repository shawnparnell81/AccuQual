import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tenants } from "./tenants.js";

export const trainingCourses = pgTable("training_courses", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  requiredForRoleId: integer("required_for_role_id"),
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
  createdAt: timestamp("created_at").defaultNow(),
});

export type TrainingCourse = typeof trainingCourses.$inferSelect;
export type TrainingAssignment = typeof trainingAssignments.$inferSelect;
