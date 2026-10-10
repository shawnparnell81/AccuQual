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
 * A company admin can still turn Workflow Builder or AI Insights back on
 * from Settings > Navigation. Digital Twin stays in this hidden seed, and
 * the live menu also drops it unless company.profile.digitalTwinEnabled is
 * true (see digitalTwinFlag.ts), including when a saved menu still names it.
 */
export const DEFAULT_HIDDEN_SYSTEM_ITEM_KEYS = ["workflow", "ai", "digital_twin"] as const;

export function defaultHiddenNavScopes(): string[] {
  return DEFAULT_HIDDEN_SYSTEM_ITEM_KEYS.map((key) => `item:system:${key}`);
}
