import { CheckCircle2, Circle, X } from "lucide-react";
import { useCurrentUser } from "../../hooks/useAuth";
import { useOnboardingChecklist } from "../../hooks/useOnboardingChecklist";

// Mirrors services/api/src/db/defaultOnboardingChecklist.ts's ONBOARDING_CHECKLIST_ITEMS exactly — separate
// deployables, no shared package (same constraint defaultNavPreferences.ts's own comment already notes for its
// System-menu item keys), so keep both lists in sync by hand if an item is ever added/changed.
const CHECKLIST_ITEMS = [
  { key: "invite_users", label: "Invite your team", description: "Add the people who'll use AccuQual — Admin Console > Users." },
  { key: "review_departments", label: "Review departments", description: "Confirm who's in which department — that's what controls who sees what." },
  { key: "review_nav", label: "Review your menu", description: "A few advanced tools (Workflow Builder, AI Insights, Digital Twin) are hidden by default — turn any of them on from Settings > Navigation." },
  { key: "open_a_form", label: "Open a QMS form", description: "Browse the QMS Forms catalog to see your form library." },
] as const;

/**
 * First-run guided checklist for a brand-new tenant's first admin — shown
 * on the home dashboard until dismissed or every item is checked off.
 * Admin-only (the server-side PATCH already enforces this; gating the
 * whole component the same way here means a non-admin never sees a
 * checklist they have no way to act on).
 */
export function OnboardingChecklist() {
  const user = useCurrentUser();
  const { progress, markComplete, dismiss } = useOnboardingChecklist();

  if (user?.roleName !== "admin" || progress.dismissed) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">Get started with AccuQual</h2>
        <button onClick={dismiss} title="Dismiss" className="text-muted-foreground hover:text-foreground">
          <X size={15} />
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {CHECKLIST_ITEMS.map((item) => {
          const done = progress.completedItems.includes(item.key);
          return (
            <li key={item.key} className="flex items-start gap-2">
              <button onClick={() => markComplete(item.key)} disabled={done} className="mt-0.5 flex-none text-muted-foreground disabled:text-success">
                {done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
              </button>
              <div>
                <p className={done ? "text-sm text-muted-foreground line-through" : "text-sm font-medium"}>{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
