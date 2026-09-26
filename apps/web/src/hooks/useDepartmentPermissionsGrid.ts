import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import type { DepartmentPermissionCell } from "../api/types";
import type { AccessLevel, Department } from "../components/layout/navConfig";

/**
 * The full department x module grid (GET /permissions/department-permissions,
 * admin only). Used by TopNav.tsx so an admin's nav preview of
 * OTHER departments' dropdowns (they see every department's group, not just
 * their own) reflects live grants too — the viewer's OWN department instead
 * reads useEffectivePermissions, which already covers custom-role grants a
 * department-level grid can't.
 *
 * Same queryKey as PermissionsDepartmentAccessTab.tsx's own fetch of this
 * endpoint — its save/reset mutations invalidate exactly this key, so a
 * grant made in the admin UI shows up in the nav immediately, not just after
 * this query's own 30s staleTime lapses.
 */
export function useDepartmentPermissionsGrid(enabled: boolean) {
  const { data } = useQuery({
    queryKey: ["permissions", "department-permissions"],
    queryFn: async () => (await apiClient.get<DepartmentPermissionCell[]>("/permissions/department-permissions")).data,
    enabled,
    staleTime: 30_000,
  });

  return useMemo(() => {
    const byDepartment = new Map<Department, Map<string, AccessLevel>>();
    for (const row of data ?? []) {
      const department = row.departmentName as Department;
      if (!byDepartment.has(department)) byDepartment.set(department, new Map());
      byDepartment.get(department)!.set(row.moduleName, row.accessLevel);
    }
    return byDepartment;
  }, [data]);
}
