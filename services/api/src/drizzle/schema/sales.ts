import { pgTable, serial, text, integer, timestamp, date } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tenants } from "./tenants.js";
import { documents } from "./documents.js";

/**
 * Sales & Marketing — real CRM-lite records (Accounts, Activities, Quotes,
 * Contracts). Deliberately does NOT include a new folder/file system —
 * the module's own "mandatory folder tree" turned out to be a byte-for-byte
 * match for the real, already-built, already-seeded Document Folders
 * "Sales and Marketing" department branch (document_folders,
 * defaultDocumentFolders.ts) — building sales_folders/sales_files would
 * have fragmented document storage into two competing systems for the
 * exact same content. The module links into that existing tree instead
 * (see SalesAccountDetailPage.tsx's "Documents" button).
 */
export const salesAccounts = pgTable("sales_accounts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  customerName: text("customer_name").notNull(),
  industry: text("industry"),
  primaryContactName: text("primary_contact_name"),
  primaryContactEmail: text("primary_contact_email"),
  primaryContactPhone: text("primary_contact_phone"),
  status: text("status").notNull().default("prospect"), // prospect -> active -> dormant
  ownerId: integer("owner_id").references(() => users.id),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/**
 * Also how a "Link to Sales Account" button on NCR/PPAP/Change Management/
 * Work Orders/Requisitions/PO/RMA works — it creates a real activity here
 * (activityType "note") with relatedSourceType/relatedSourceId set, rather
 * than a separate join table. Gives the account a real visible trail of
 * everywhere it's been referenced from.
 */
export const salesActivities = pgTable("sales_activities", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  accountId: integer("account_id").references(() => salesAccounts.id).notNull(),
  activityType: text("activity_type").notNull(), // call | meeting | email | demo | follow_up | note
  notes: text("notes"),
  nextSteps: text("next_steps"),
  dueDate: date("due_date"),
  ownerId: integer("owner_id").references(() => users.id),
  relatedSourceType: text("related_source_type"), // NCR | PPAP | ChangeRequest | WorkOrder | Requisition | PO | RMA
  relatedSourceId: integer("related_source_id"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const salesQuotes = pgTable("sales_quotes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  accountId: integer("account_id").references(() => salesAccounts.id).notNull(),
  quoteNumber: text("quote_number").notNull(),
  revision: integer("revision").notNull().default(1),
  status: text("status").notNull().default("draft"), // draft -> submitted -> accepted -> archived, or -> rejected
  // Real link to Document Control (the actual pricing sheet PDF the user
  // uploads there), not a new file column — same reasoning as
  // customers.ndaDocumentId.
  pricingSheetDocumentId: integer("pricing_sheet_document_id").references(() => documents.id),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const salesContracts = pgTable("sales_contracts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  accountId: integer("account_id").references(() => salesAccounts.id).notNull(),
  contractType: text("contract_type").notNull(), // customer | service | pricing | renewal
  effectiveDate: date("effective_date"),
  expirationDate: date("expiration_date"),
  status: text("status").notNull().default("draft"), // draft -> active -> expired -> archived
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type SalesAccount = typeof salesAccounts.$inferSelect;
export type SalesActivity = typeof salesActivities.$inferSelect;
export type SalesQuote = typeof salesQuotes.$inferSelect;
export type SalesContract = typeof salesContracts.$inferSelect;
