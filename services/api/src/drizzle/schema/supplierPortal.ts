import { pgTable, serial, text, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { suppliers } from "./supplier.js";
import { ncr } from "./ncr.js";
import { capa } from "./capa.js";
import { eightD } from "./eightD.js";

/** A file the supplier or internal staff attached — kept self-contained (real path/mime/size columns) the same way documentFolders' own attachment columns are, rather than a join into the generic `attachments` table: several of these rows (PPAP, CAR, 8D) hold MULTIPLE named files per record (see the `documents`/`supportingDocuments` jsonb fields below), which the single-file-per-row generic table can't express. */
export interface StoredFile {
  fileName: string;
  filePath: string;
  mimeType: string | null;
  fileSize: number | null;
  uploadedAt: string;
}

export type ReviewStatus = "submitted" | "under_review" | "approved" | "rejected";

/**
 * One row per onboarding document type per supplier (W-9, NDA, Quality
 * Manual, Process Flow, Control Plan, FMEA, Org Chart, ISO/IATF/AS9100
 * certifications, Questionnaire, Agreement — see
 * supplierPortal.validation.ts's ONBOARDING_DOCUMENT_TYPES). Resubmission
 * inserts a new row rather than overwriting — GET /onboarding/status reads
 * the latest row per documentType, so history of prior rejected attempts
 * is never lost.
 */
export const supplierOnboardingDocuments = pgTable("supplier_onboarding_documents", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").references(() => suppliers.id).notNull(),
  documentType: text("document_type").notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  status: text("status").notNull().default("submitted"), // submitted | approved | rejected
  reviewNotes: text("review_notes"),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/**
 * Ongoing document management (post-onboarding) — ISO certs renewals,
 * updated procedures, whatever the supplier needs on file. No approval
 * workflow (unlike onboarding docs): this is a library, not a gate.
 */
export const supplierDocuments = pgTable("supplier_documents", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").references(() => suppliers.id).notNull(),
  name: text("name").notNull(),
  category: text("category"),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * `documents` holds the real named PPAP elements (PSW/DFMEA/PFMEA/Control
 * Plan/Process Flow/Dimensional Results/Material Results/Initial Process
 * Studies/Appearance Approval Report/Sample Parts/Packaging Specs — see
 * supplierPortal.validation.ts's PPAP_DOCUMENT_TYPES) as a
 * documentType -> StoredFile map — a submission is inherently multi-file,
 * unlike a single-attachment record, so jsonb here (mirroring eight_d.data's
 * own jsonb-for-structured-content convention) beats a child table nobody
 * else needs to join against.
 */
export const supplierPpapSubmissions = pgTable("supplier_ppap_submissions", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").references(() => suppliers.id).notNull(),
  level: integer("level").notNull(), // 1-5
  partNumber: text("part_number"),
  description: text("description"),
  status: text("status").notNull().default("submitted"), // submitted | under_review | approved | rejected
  documents: jsonb("documents").$type<Record<string, StoredFile>>().default({}),
  reviewNotes: text("review_notes"),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  submittedByUserId: integer("submitted_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/**
 * A supplier's own submitted Corrective Action response — optionally tied
 * to a real internal NCR/CAPA this responds to (Supplier NCR/CAPA
 * visibility), but a genuinely separate record from that internal one: the
 * internal capa/ncr rows are never mutated by a supplier submission (no
 * workflow changes to existing modules, per the brief). `data` mirrors
 * eight_d.data's jsonb-for-structured-narrative convention.
 */
export const supplierCorrectiveActions = pgTable("supplier_corrective_actions", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").references(() => suppliers.id).notNull(),
  linkedNcrId: integer("linked_ncr_id").references(() => ncr.id),
  linkedCapaId: integer("linked_capa_id").references(() => capa.id),
  status: text("status").notNull().default("submitted"), // submitted | under_review | accepted | rejected
  data: jsonb("data").$type<{
    problemDescription?: string;
    containment?: string;
    rootCause?: string;
    correctiveAction?: string;
    preventiveAction?: string;
    verification?: string;
  }>().default({}),
  supportingDocuments: jsonb("supporting_documents").$type<StoredFile[]>().default([]),
  reviewNotes: text("review_notes"),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  submittedByUserId: integer("submitted_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/**
 * A supplier's own submitted 8D response — same "separate from, optionally
 * linked to, the real internal record" relationship as
 * supplierCorrectiveActions above, this time against `eight_d`. `data`
 * keys deliberately match eight_d.data's own d1_team..d8_closure naming so
 * the two stay visually/structurally consistent wherever both are shown.
 */
export const supplier8dResponses = pgTable("supplier_8d_responses", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").references(() => suppliers.id).notNull(),
  linkedNcrId: integer("linked_ncr_id").references(() => ncr.id),
  linkedEightDId: integer("linked_eight_d_id").references(() => eightD.id),
  status: text("status").notNull().default("submitted"), // submitted | under_review | accepted | rejected
  data: jsonb("data").$type<{
    d1_team?: string;
    d2_problem?: string;
    d3_containment?: string;
    d4_rootCause?: string;
    d5_correctiveAction?: string;
    d6_validation?: string;
    d7_prevention?: string;
    d8_closure?: string;
  }>().default({}),
  supportingDocuments: jsonb("supporting_documents").$type<StoredFile[]>().default([]),
  reviewNotes: text("review_notes"),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  submittedByUserId: integer("submitted_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/**
 * Threaded messaging between internal staff and one supplier. `threadKey`
 * groups messages into named threads within that one supplier's inbox
 * (default "general") — there is no cross-supplier thread; a supplier
 * login can only ever see rows where supplierId is their own (enforced in
 * supplierPortal.controller.ts, never trusted from the client).
 */
export const supplierMessages = pgTable("supplier_messages", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").references(() => suppliers.id).notNull(),
  threadKey: text("thread_key").notNull().default("general"),
  senderRole: text("sender_role").notNull(), // internal | supplier
  senderUserId: integer("sender_user_id").references(() => users.id),
  body: text("body").notNull(),
  attachment: jsonb("attachment").$type<StoredFile | null>(),
  // Phase 7 — one lightweight tag on top of the plain chat-thread shape
  // above: `category` groups a message as a follow-up/request/response
  // (default "message" — an ordinary chat line, not one of those three);
  // `aiDrafted` is a client-asserted flag (only the composer knows whether
  // the text it's sending came from an accepted AI suggestion — see
  // SupplierMessagingPanel.tsx, which clears it the moment the user edits
  // the draft after accepting) recorded here so the thread can honestly
  // label which messages started as an AI draft, same "never silently
  // attribute AI content to a human, or vice versa" rule Phase 4/5 already
  // apply everywhere else.
  category: text("category").notNull().default("message"), // message | follow_up | request | response
  aiDrafted: boolean("ai_drafted").notNull().default(false),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type SupplierOnboardingDocument = typeof supplierOnboardingDocuments.$inferSelect;
export type SupplierDocument = typeof supplierDocuments.$inferSelect;
export type SupplierPpapSubmission = typeof supplierPpapSubmissions.$inferSelect;
export type SupplierCorrectiveAction = typeof supplierCorrectiveActions.$inferSelect;
export type Supplier8dResponse = typeof supplier8dResponses.$inferSelect;
export type SupplierMessage = typeof supplierMessages.$inferSelect;
