import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/** Filled copies of the ISO blank forms. `data.cells` holds the typed fields. Quarantine photos live in `data.photos`. */
export const ISO_FORM_TYPES = ["internal_audit", "ncr_report", "quarantine_notice", "concession", "competency_training", "cross_training"] as const;
export type IsoFormType = (typeof ISO_FORM_TYPES)[number];

export const isoQualityForms = pgTable("iso_quality_forms", {
  id: serial("id").primaryKey(),
  formType: text("form_type").$type<IsoFormType>().notNull(),
  data: jsonb("data").$type<{ cells?: Record<string, string | number | boolean | null>; photos?: string }>().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type IsoQualityForm = typeof isoQualityForms.$inferSelect;
export type NewIsoQualityForm = typeof isoQualityForms.$inferInsert;
