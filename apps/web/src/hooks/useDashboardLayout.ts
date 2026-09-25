import { useCallback, useEffect, useState } from "react";
import { useCurrentUser } from "./useAuth";

export const DASHBOARD_SECTIONS = ["status", "kpis", "trend", "attention", "detail"] as const;
export type DashboardSectionId = (typeof DASHBOARD_SECTIONS)[number];

export const DASHBOARD_SECTION_LABELS: Record<DashboardSectionId, string> = {
  status: "Status lights",
  kpis: "Key numbers",
  trend: "Trend and live activity",
  attention: "Needs attention",
  detail: "Details by area",
};

/** Keeps only sections that still exist, in the saved order, and appends any new ones at the end. */
function sanitize(saved: unknown): DashboardSectionId[] {
  const known = new Set<string>(DASHBOARD_SECTIONS);
  const kept = Array.isArray(saved) ? saved.filter((id): id is DashboardSectionId => typeof id === "string" && known.has(id)) : [];
  const unique = [...new Set(kept)];
  return [...unique, ...DASHBOARD_SECTIONS.filter((id) => !unique.includes(id))];
}

/** Each person's own arrangement of dashboard sections, remembered on this browser. */
export function useDashboardLayout() {
  const user = useCurrentUser();
  const key = user ? `accuqual-dashboard-layout-${user.id}` : null;
  const [order, setOrder] = useState<DashboardSectionId[]>([...DASHBOARD_SECTIONS]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      setOrder(sanitize(raw ? JSON.parse(raw) : null));
    } catch {
      setOrder([...DASHBOARD_SECTIONS]);
    }
  }, [key]);

  const persist = useCallback(
    (next: DashboardSectionId[]) => {
      setOrder(next);
      if (!key) return;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage blocked: the arrangement lasts for this visit only.
      }
    },
    [key]
  );

  /** Puts `moving` where `target` is now. */
  const move = useCallback(
    (moving: DashboardSectionId, target: DashboardSectionId) => {
      if (moving === target) return;
      const without = order.filter((id) => id !== moving);
      without.splice(without.indexOf(target), 0, moving);
      persist(without);
    },
    [order, persist]
  );

  const reset = useCallback(() => {
    persist([...DASHBOARD_SECTIONS]);
  }, [persist]);

  return { order, move, reset, editing, setEditing };
}
