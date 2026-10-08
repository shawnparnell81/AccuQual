import { sql } from "drizzle-orm";
import { pgTable, serial, text, integer, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * A plant (site) inside one company. The company is the organization; plants
 * are where operational records happen. Controlled documents stay on the
 * company (documents.ts has no site id) — one catalog for every plant.
 *
 * `isDefault` is the plant migration attaches pre-existing records to, and
 * the plant a new user is assigned to until an admin says otherwise. Only
 * one default per company (partial unique index in the migration).
 *
 * Deleting a plant does not remove the row. `deletedAt` hides it from every
 * list, and `nameSnapshot` is the name records keep showing. The code unique
 * index ignores deleted and inactive plants so the same code can be used again.
 */
export const sites = pgTable(
  "sites",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    status: text("status").notNull().default("active"), // active, inactive
    isDefault: boolean("is_default").notNull().default(false),
    /** Set when the plant is deleted. The row stays so foreign keys on records do not break. */
    deletedAt: timestamp("deleted_at"),
    /** Name at the moment of deletion. Historical records show this, even if `name` later changes. */
    nameSnapshot: text("name_snapshot"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    codeUnique: uniqueIndex("sites_code_idx").on(table.code).where(sql`${table.deletedAt} IS NULL AND ${table.status} = 'active'`),
    nameUnique: uniqueIndex("sites_name_active_idx").on(sql`lower(${table.name})`).where(sql`${table.deletedAt} IS NULL AND ${table.status} = 'active'`),
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
