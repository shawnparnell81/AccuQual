import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/** Filled copies of the ISO blank forms. `data.cells` holds the typed fields. Quarantine photos live in `data.photos`. */
export const ISO_FORM_TYPES = [
  "internal_audit",
  "ncr_report",
  "quarantine_notice",
  "concession",
  "competency_training",
  "cross_training",
  "psw",
  "turtle_diagram",
  "quality_alert",
  "first_article",
  "customer_scorecard",
  "failure_effectiveness",
  "audit_summary",
  "visitor_log",
  "monthly_engineering",
  "salt_spray",
  "volume_water",
  "volume_heptane",
  "prototype_strut",
  "dev_csa",
  "dev_fuel_pump",
  "dev_gas_lift",
  "dev_coil",
  "dev_air_spring",
  "dev_air_compressor",
  "dev_fuel_injector",
  "dev_electric_lift",
  "dev_air_strut",
  "dev_brake_wear",
  "dev_electronic_shock",
  "dev_electronic_csa",
  "dev_shock",
  "engineering_change",
  "scar_request",
] as const;
export type IsoFormType = (typeof ISO_FORM_TYPES)[number];

export const isoQualityForms = pgTable("iso_quality_forms", {
  id: serial("id").primaryKey(),
  formType: text("form_type").$type<IsoFormType>().notNull(),
  data: jsonb("data")
    .$type<{
      cells?: Record<string, string | number | boolean | null>;
      photos?: string;
      lines?: Array<Record<string, string | number | null | undefined>>;
      customers?: Array<Record<string, string | number | null | undefined>>;
      problems?: Array<Record<string, unknown>>;
      months?: string[];
      leadAuditorSignature?: string;
      managementSignature?: string;
      auditeeSignature1?: string;
      auditeeSignature2?: string;
      auditeeSignature3?: string;
      auditeeSignature4?: string;
      testedSignature?: string;
      approvedSignature?: string;
      engineeringSignoffSignature?: string;
      managerSignature?: string;
      supplierRepSignature?: string;
    }>()
    .default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type IsoQualityForm = typeof isoQualityForms.$inferSelect;
export type NewIsoQualityForm = typeof isoQualityForms.$inferInsert;
