import { pgTable, serial, text, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tenants } from "./tenants.js";
import { documents } from "./documents.js";

export const SESSION_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const COMPETENCY_STATUSES = ["pending", "pass", "fail"] as const;
export type CompetencyStatus = (typeof COMPETENCY_STATUSES)[number];

/** What a course asks of the people it applies to. All optional; stored as JSON so an organization keeps its own criteria. */
export interface CourseRequirements {
  /** True when finishing the training is not enough: a passing competency evaluation is also needed. */
  evaluationRequired?: boolean;
  /** 0-100. A "pass" evaluation must reach it when the evaluation carries a score. */
  passingScore?: number;
  /** What the evaluator checks, offered as the evaluation form's rows. */
  criteria?: string[];
  instructions?: string;
}

export const trainingCourses = pgTable("training_courses", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  // Who the course is REQUIRED for: everyone with this role, and/or everyone in this department. Used to work out who is not yet
  // trained (training.service.ts) and to assign the course to them in one step.
  requiredForRoleId: integer("required_for_role_id"),
  requiredForDepartment: text("required_for_department"),
  requirements: jsonb("requirements").$type<CourseRequirements>().notNull().default({}),
  // How long a completed training / passed evaluation stays valid before it has to be repeated. Null = does not expire.
  validityMonths: integer("validity_months"),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at"),
  // Optional link to a fully version-controlled record in `documents` — a
  // course's material (SOP, work instruction, training form) reuses the
  // whole approval/revision/expiration/retention system built for Document
  // Control instead of a second copy of it. Same pattern as
  // document_folders.documentId. Null until a course's material is linked.
  documentId: integer("document_id").references(() => documents.id),
  createdAt: timestamp("created_at").defaultNow(),
});

/** A run of a course: when, where, who teaches it and who attended. Completing it records each attendee's training. */
export const trainingSessions = pgTable("training_sessions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  courseId: integer("course_id").references(() => trainingCourses.id).notNull(),
  title: text("title"),
  instructorId: integer("instructor_id").references(() => users.id),
  instructorName: text("instructor_name"),
  location: text("location"),
  capacity: integer("capacity"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  status: text("status").$type<SessionStatus>().notNull().default("scheduled"),
  completedAt: timestamp("completed_at"),
  /** [{ userId, status: "present" | "absent" | "excused", notes? }] */
  attendance: jsonb("attendance").$type<{ userId: number; status: "present" | "absent" | "excused"; notes?: string }[]>().notNull().default([]),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
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
  // The session whose attendance completed this assignment, when it came from one.
  sessionId: integer("session_id").references(() => trainingSessions.id),
  // The linked controlled document's released version when the training was completed. Null = not known (older records, or no document).
  // When the document has since been revised past this, the person needs retraining (training.service.ts).
  documentVersion: integer("document_version"),
  // When this completed training stops being valid (completed date + the course's validity), fixed at completion.
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * One evaluation of one person against one course. History, not state: a re-evaluation is a new row, and the person's CURRENT
 * competency is their latest evaluation that was decided (pass or fail). "pending" is an evaluation scheduled but not yet done.
 * workerId in the specification is the person: this app's people are its users.
 */
export const trainingCompetencies = pgTable("training_competencies", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  courseId: integer("course_id").references(() => trainingCourses.id).notNull(),
  sessionId: integer("session_id").references(() => trainingSessions.id),
  evaluatorId: integer("evaluator_id").references(() => users.id),
  /** { score?: number, criteria?: [{ name, result: "pass" | "fail" | "n/a", notes? }], notes? } */
  evaluation: jsonb("evaluation").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").$type<CompetencyStatus>().notNull().default("pending"),
  score: integer("score"),
  evaluatedAt: timestamp("evaluated_at"),
  expiresAt: timestamp("expires_at"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export type TrainingCourse = typeof trainingCourses.$inferSelect;
export type TrainingAssignment = typeof trainingAssignments.$inferSelect;
export type TrainingSession = typeof trainingSessions.$inferSelect;
export type TrainingCompetency = typeof trainingCompetencies.$inferSelect;
