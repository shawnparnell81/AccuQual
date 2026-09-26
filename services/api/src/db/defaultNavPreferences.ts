/**
 * Phase 1 nav cleanup: three System-menu items ("Workflow Builder",
 * "AI Insights", "Digital Twin") are real code but not yet usable the way
 * an ordinary quality-team user would expect — see each one's own comment
 * in apps/web/src/components/layout/navConfig.ts, whose `section:
 * "advanced"` tag on these exact three leaves is the source of truth this
 * list must stay in sync with (that file can't import this one — separate
 * deployables, no shared package).
 *
 * Same two-consumer seed pattern db/defaultPermissions.ts already
 * established for department_permissions:
 *   1. db/backfillNavPreferences.ts — hides these for every EXISTING company.
 *   2. platform.service.ts's createCompany() — hides these for a brand-new
 *      company at creation time.
 * A company admin can still turn any of them back on from Settings >
 * Navigation at any time — this only changes the starting default, using
 * the exact same nav_hidden_items mechanism every other nav toggle already
 * uses (scope "item:system:<key>", see navPreferences.ts's own comment).
 */
export const DEFAULT_HIDDEN_SYSTEM_ITEM_KEYS = ["workflow", "ai", "digital_twin"] as const;

export function defaultHiddenNavScopes(): string[] {
  return DEFAULT_HIDDEN_SYSTEM_ITEM_KEYS.map((key) => `item:system:${key}`);
}
