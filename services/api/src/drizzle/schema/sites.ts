import { pgTable, serial, text, integer, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * A plant (site) inside one tenant. The tenant is the organization; plants
 * are where operational records happen. Controlled documents stay on the
 * tenant (documents.ts has no site id) — one catalog for every plant.
 *
 * `isDefault` is the plant migration attaches pre-existing records to, and
 * the plant a new user is assigned to until an admin says otherwise. Only
 * one default per tenant (partial unique index in the migration).
 */
export const sites = pgTable(
  "sites",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    status: text("status").notNull().default("active"), // active, inactive
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    codeUnique: uniqueIndex("sites_code_idx").on(table.code),
  })
);

/** Which plants a user may work in. Admins are not limited to these rows. */
export const userSites = pgTable(
  "user_sites",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id).notNull(),
    siteId: integer("site_id").references(() => sites.id).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    userSiteUnique: uniqueIndex("user_sites_user_site_idx").on(table.userId, table.siteId),
  })
);

export type Site = typeof sites.$inferSelect;
export type UserSite = typeof userSites.$inferSelect;
