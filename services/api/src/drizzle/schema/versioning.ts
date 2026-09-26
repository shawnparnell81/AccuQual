import { pgTable, serial, text, integer, timestamp, jsonb, boolean, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.js";

export const VERSION_STATUSES = ["draft", "in_review", "published", "archived"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];
export const VERSION_SUBJECTS = ["workflow", "management_review", "context_of_organization", "document"] as const;
export type VersionSubject = (typeof VERSION_SUBJECTS)[number];

/**
 * One row per version of a controlled thing — a workflow definition, the
 * Management Review record, the Context of the Organization analysis. All three
 * share this table because they share the same lifecycle: draft -> in_review ->
 * published (-> archived when superseded), with rollback creating a new draft
 * from an old version rather than rewriting history.
 *
 * `payload` is what the version IS (a workflow graph, or a form's data). The
 * live record the rest of the app reads (workflow_definitions.definition,
 * form_data.data) is only ever written by publishing — so the engine, the
 * workers and every existing reader keep working unchanged.
 *
 * A database trigger (post-migrate/version-freeze.sql) makes published and
 * archived rows immutable: their payload can never change and they can never be
 * deleted, whatever code path tries.
 */
export const controlledVersions = pgTable(
  "controlled_versions",
  {
    id: serial("id").primaryKey(),
    subjectType: text("subject_type").$type<VersionSubject>().notNull(),
    // workflow_definitions.id for workflows; the form_data entity id (1, the company singleton) for the two documents.
    subjectId: integer("subject_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    status: text("status").$type<VersionStatus>().notNull().default("draft"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    // Small descriptive bag: change summary, etc.
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    // The published version this draft was started from, or the old version a rollback restores.
    basedOnVersion: integer("based_on_version"),
    isRollback: boolean("is_rollback").notNull().default(false),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedBy: integer("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at"),
    submittedBy: integer("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at"),
    reviewedBy: integer("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at"),
    reviewDecision: text("review_decision").$type<"approved" | "rejected">(),
    reviewNotes: text("review_notes"),
    publishedBy: integer("published_by").references(() => users.id),
    publishedAt: timestamp("published_at"),
  },
  (t) => ({
    uniqueNumber: unique("controlled_versions_subject_number_uq").on(t.subjectType, t.subjectId, t.versionNumber),
    // At most one open (draft or in-review) version per subject, so two people can't fork the same document.
    oneOpen: uniqueIndex("controlled_versions_one_open_uq")
      .on(t.subjectType, t.subjectId)
      .where(sql`status in ('draft', 'in_review')`),
  }),
);

export type ControlledVersion = typeof controlledVersions.$inferSelect;
