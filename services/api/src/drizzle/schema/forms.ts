import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/** Registry of fillable PDF templates per form type (NCR, CAPA, 8D, ...). */
export const formTemplates = pgTable("form_templates", {
  id: serial("id").primaryKey(),
  formType: text("form_type").notNull(), // ncr, capa, eight_d, five_why, audit_checklist, audit_plan, di, supplier, training, change, calibration, complaint
  pdfPath: text("pdf_path").notNull(), // /forms/<formType>/template.pdf
  fieldMap: jsonb("field_map").$type<Record<string, string>>().notNull(),
  isDefault: text("is_default").notNull().default("true"), // "true" = AccuQual-provided, "false" = company-uploaded custom
  createdAt: timestamp("created_at").defaultNow(),
});

/** A filled-in form instance, attached to a QMS record (NCR, CAPA, ...) via entityType+entityId. */
export const formData = pgTable("form_data", {
  id: serial("id").primaryKey(),
  formType: text("form_type").notNull(),
  entityType: text("entity_type"), // ncr, capa, eight_d, audits, ...
  entityId: integer("entity_id"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  version: integer("version").notNull().default(1),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/** Immutable version history for a form_data row — one row per save. */
export const formVersions = pgTable("form_versions", {
  id: serial("id").primaryKey(),
  formId: integer("form_id").references(() => formData.id).notNull(),
  version: integer("version").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export type FormTemplate = typeof formTemplates.$inferSelect;
export type FormData = typeof formData.$inferSelect;
export type FormVersion = typeof formVersions.$inferSelect;
