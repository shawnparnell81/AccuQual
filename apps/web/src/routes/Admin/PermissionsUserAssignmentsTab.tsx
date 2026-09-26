import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { DEPARTMENTS } from "../../components/layout/navConfig";
import type { PermissionRole, CompanyUser, UserEffectivePermissions, UserPermissionRoleAssignment } from "../../api/types";

/**
 * Which department each user belongs to (PATCH /users/:id — a pre-existing
 * endpoint, not new), which custom permission-roles they hold on top of
 * that, and a live breakdown of exactly what that adds up to. Department
 * reassignment here is baked into the JWT at login like every other field
 * on `users` (see auth.service.ts) — takes effect on that user's next
 * login/token refresh, same pre-existing behavior as today, not something
 * this module changes.
 */
export function PermissionsUserAssignmentsTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);

  const { data: companyUsers = [], isLoading } = useQuery<CompanyUser[]>({
    queryKey: ["permissions", "company-users"],
    queryFn: async () => (await apiClient.get("/users")).data,
  });
  const { data: roles = [] } = useQuery<PermissionRole[]>({
    queryKey: ["permissions", "roles"],
    queryFn: async () => (await apiClient.get("/permissions/roles")).data,
  });
  const { data: assignments = [] } = useQuery<UserPermissionRoleAssignment[]>({
    queryKey: ["permissions", "user-roles"],
    queryFn: async () => (await apiClient.get("/permissions/user-roles")).data,
  });

  const invalidateAssignments = () => {
    queryClient.invalidateQueries({ queryKey: ["permissions", "user-roles"] });
    queryClient.invalidateQueries({ queryKey: ["permissions", "roles"] });
    queryClient.invalidateQueries({ queryKey: ["permissions", "effective"] });
  };

  const setDepartment = useMutation({
    mutationFn: async ({ userId, department }: { userId: number; department: string }) => (await apiClient.patch(`/users/${userId}`, { department: department || null })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissions", "company-users"] });
      toast.success("Department updated — takes effect the next time they sign in.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update that user's department.")),
  });

  const assignRole = useMutation({
    mutationFn: async ({ userId, roleId }: { userId: number; roleId: number }) => (await apiClient.post("/permissions/user-roles", { userId, roleId })).data,
    onSuccess: invalidateAssignments,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't assign that role.")),
  });

  const unassignRole = useMutation({
    mutationFn: async (assignmentId: number) => apiClient.delete(`/permissions/user-roles/${assignmentId}`),
    onSuccess: invalidateAssignments,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't remove that role.")),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-3">
      {companyUsers.map((u) => {
        const userAssignments = assignments.filter((a) => a.userId === u.id);
        const assignedRoleIds = new Set(userAssignments.map((a) => a.roleId));
        const availableRoles = roles.filter((r) => !assignedRoleIds.has(r.id));
        const expanded = expandedUserId === u.id;

        return (
          <div key={u.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.name || u.email}</p>
                <p className="truncate text-xs text-muted-foreground">{u.email}</p>
              </div>
              <select
                value={u.department ?? ""}
                onChange={(e) => setDepartment.mutate({ userId: u.id, department: e.target.value })}
                className="rounded-md border border-border bg-transparent px-2 py-1.5 text-xs"
              >
                <option value="">No department</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setExpandedUserId(expanded ? null : u.id)}
                className="rounded-md border border-border px-2 py-1.5 text-xs hover:bg-muted"
              >
                {expanded ? "Hide" : "View"} effective permissions
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {userAssignments.map((a) => (
                <span key={a.id} className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  {a.roleName}
                  <button onClick={() => unassignRole.mutate(a.id)} className="text-primary/70 hover:text-primary">
                    ×
                  </button>
                </span>
              ))}
              {availableRoles.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) assignRole.mutate({ userId: u.id, roleId: Number(e.target.value) });
                  }}
                  className="rounded-md border border-dashed border-border bg-transparent px-2 py-0.5 text-xs text-muted-foreground"
                >
                  <option value="">+ Assign role…</option>
                  {availableRoles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.roleName}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {expanded && <EffectivePermissionsPanel userId={u.id} />}
          </div>
        );
      })}
    </div>
  );
}

function EffectivePermissionsPanel({ userId }: { userId: number }) {
  const { data, isLoading } = useQuery<UserEffectivePermissions>({
    queryKey: ["permissions", "users", userId, "effective"],
    queryFn: async () => (await apiClient.get(`/permissions/users/${userId}/effective`)).data,
  });

  if (isLoading || !data) return <p className="mt-2 text-xs text-muted-foreground">Loading…</p>;
  const nonNone = data.breakdown.filter((b) => b.effectiveLevel !== "none");

  return (
    <div className="mt-3 border-t border-border pt-3">
      {nonNone.length === 0 ? (
        <p className="text-xs text-muted-foreground">No module access at all — assign a department or a role above.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="pb-1">Module</th>
              <th className="pb-1">From Department</th>
              <th className="pb-1">Effective</th>
            </tr>
          </thead>
          <tbody>
            {nonNone.map((b) => (
              <tr key={b.moduleName} className="border-t border-border">
                <td className="py-1">{b.label}</td>
                <td className="py-1 capitalize text-muted-foreground">{b.departmentLevel}</td>
                <td className="py-1 font-medium capitalize">{b.effectiveLevel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
