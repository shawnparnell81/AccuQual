/**
 * First-run guided checklist for a brand-new tenant's first admin, shown on
 * the web dashboard until dismissed or completed — built alongside
 * db/defaultNavPreferences.ts's existing seed-at-creation pattern rather
 * than a generic onboarding framework. Same two-consumer shape that file
 * established for nav_hidden_items:
 *   1. db/backfillOnboardingChecklist.ts — marks this all-complete/dismissed
 *      for every EXISTING tenant, so nobody at a company that's been live
 *      for years suddenly sees a "new tenant" checklist.
 *   2. platform.service.ts's createTenant() — seeds a fresh, incomplete
 *      checklist for a genuinely new tenant.
 *
 * Each item's `key` is stored in `tenants.onboardingProgress.completedItems`
 * — add a new item here by appending a key; removing one is safe too (a
 * stale completed key some tenant already has just becomes inert).
 */
export const ONBOARDING_CHECKLIST_ITEMS = [
  { key: "invite_users", label: "Invite your team", description: "Add the people who'll use AccuQual — Admin Console > Users." },
  { key: "review_departments", label: "Review departments", description: "Confirm who's in which department — that's what controls who sees what." },
  { key: "review_nav", label: "Review your menu", description: "A few advanced tools (Workflow Builder, AI Insights, Digital Twin) are hidden by default — turn any of them on from Settings > Navigation." },
  { key: "open_a_form", label: "Open a QMS form", description: "Browse the QMS Forms catalog to see your form library." },
] as const;

export type OnboardingItemKey = (typeof ONBOARDING_CHECKLIST_ITEMS)[number]["key"];
