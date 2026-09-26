import { useMemo } from "react";
import { useCurrentUser } from "../../hooks/useAuth";
import { departmentScope, itemScope, useHiddenNavScopes } from "../../hooks/useNavPreferences";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { useDepartmentPermissionsGrid } from "../../hooks/useDepartmentPermissionsGrid";
import { ALL_MODULE_LEAVES, NAV_STRUCTURE, type AccessLevel, type Department, type NavGroup, type NavLeaf } from "./navConfig";

/**
 * Any module NOT already in this department's static `items` array that the
 * viewer can currently see is live-granted to that department — the "fully
 * dynamic nav registry" follow-up: a department gains a real dropdown entry
 * for a module the moment an admin grants it, without a navConfig.ts edit.
 *
 * For the viewer's OWN department, `myEffective` (GET /permissions/effective)
 * is authoritative — it already folds in custom permission-role grants a
 * department-level grid can't see. For any OTHER department being previewed
 * (only admin ever see more than their own), the admin-only
 * department x module grid is the only live source available.
 *
 * Extracted verbatim from TopNav.tsx (moved, not duplicated) so both TopNav's
 * dropdowns and the command palette compute "what can this viewer actually
 * jump to right now" from the exact same function — TopNav.tsx still imports
 * this for its own per-group dropdown rendering.
 */
export function extraGrantedLeaves(
  group: NavGroup,
  isOwnDepartment: boolean,
  myEffective: Partial<Record<string, AccessLevel>> | undefined,
  grid: Map<Department, Map<string, AccessLevel>>
): NavLeaf[] {
  if (!group.department) return [];
  const staticKeys = new Set(group.items.map((i) => i.key));
  const levelFor = isOwnDepartment ? (key: string) => myEffective?.[key] : (key: string) => grid.get(group.department!)?.get(key);
  return ALL_MODULE_LEAVES.filter((leaf) => {
    if (staticKeys.has(leaf.key)) return false;
    const level = levelFor(leaf.key);
    return level !== undefined && level !== "none";
  });
}

/**
 * The real, complete, live, permission-filtered nav — extracted verbatim
 * from TopNav.tsx's own inline `visibleGroups`/`allVisibleLeaves` computation
 * (moved, not duplicated) so the command palette (CommandPalette.tsx) and
 * TopNav's dropdowns can never disagree about "what can this viewer actually
 * see right now." `navConfig.ts`'s own `ALL_MODULE_LEAVES` is NOT this list —
 * it deliberately excludes the whole ungated System group (Document Control,
 * Training, Workflow Builder, ...), which this DOES include once a group
 * passes the same admin/own-department/not-hidden checks TopNav's dropdowns
 * already apply.
 */
export function useNavVisibility() {
  const user = useCurrentUser();
  const isAdmin = user?.roleName === "admin";
  const userDept = user?.department as Department | null | undefined;
  const { effective: myEffective } = useEffectivePermissions();
  const departmentPermissionsGrid = useDepartmentPermissionsGrid(isAdmin);

  const hiddenScopes = useHiddenNavScopes();
  const hidden = useMemo(() => new Set(hiddenScopes), [hiddenScopes]);

  const visibleGroups = useMemo(() => {
    return NAV_STRUCTURE.filter((g) => g.department === null || isAdmin || g.department === userDept)
      .filter((g) => !hidden.has(departmentScope(g.department ?? "system")))
      .map((g) => ({
        ...g,
        items: g.items.filter((item) => !hidden.has(itemScope(g.department ?? "system", item.key))),
      }));
  }, [isAdmin, userDept, hidden]);

  const allVisibleLeaves = useMemo(() => {
    const seen = new Set<string>();
    const out: NavLeaf[] = [];
    for (const g of visibleGroups) {
      const isOwnDept = g.department === userDept;
      const extra = extraGrantedLeaves(g, isOwnDept, myEffective, departmentPermissionsGrid);
      for (const item of [...g.items, ...extra]) {
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        out.push(item);
      }
    }
    return out;
  }, [visibleGroups, userDept, myEffective, departmentPermissionsGrid]);

  return { visibleGroups, allVisibleLeaves };
}
