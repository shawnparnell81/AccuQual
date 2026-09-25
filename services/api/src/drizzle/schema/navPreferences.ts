import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Which of the app's built-in nav items a tenant has hidden. Unlike
 * document_folders (arbitrary, user-created content, so it needs a real
 * "library pool" to round-trip through), the main nav's catalog is fixed and
 * known at build time (navConfig.ts) — so "remove a tab, add it back later"
 * only needs a hidden/shown flag per known item, not a second copy of the
 * data anywhere.
 *
 * `scope` is one of:
 *   "department:<departmentKey>"          — hides an entire department dropdown
 *   "item:<departmentKey>:<itemKey>"       — hides one item within a dropdown
 */
export const navHiddenItems = pgTable(
  "nav_hidden_items",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    scopeUnique: uniqueIndex("nav_hidden_items_scope_idx").on(table.scope),
  })
);

export type NavHiddenItem = typeof navHiddenItems.$inferSelect;
