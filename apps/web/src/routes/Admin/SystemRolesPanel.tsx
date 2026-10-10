import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import type { AppRole } from "../../api/types";
import { RolePermissionFields } from "../../components/admin/RolePermissionFields";
import { RestoreDeletedRoles, RoleDeleteButton, roleManagesRoles } from "../../components/admin/RoleLifecycle";
import { useCurrentUser } from "../../hooks/useAuth";
import { useToast } from "../../components/shared/ToastProvider";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { allRolePermissionKeys, rolePermissionLabel } from "../../lib/rolePermissionSelection";

const KNOWN = new Set(allRolePermissionKeys());

function roleLabel(role: AppRole): string {
  return role.displayName || role.name;
}

function grantedLabels(role: AppRole): string[] {
  return (role.permissions ?? []).filter((key) => KNOWN.has(key)).map((key) => rolePermissionLabel(key));
}

/**
 * System roles live in the roles table (Owner, Administrator, Executive, and
 * the rest). Permissions are the jsonb list on that row. An administrator
 * edits the list here. A role name does not grant a permission by itself.
 */
export function SystemRolesPanel() {
  const currentUser = useCurrentUser();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<string[]>([]);

  const { data: roles = [], isLoading, isError } = useQuery<AppRole[]>({
    queryKey: ["roles"],
    queryFn: async () => (await apiClient.get<AppRole[]>("/roles")).data,
  });

  const save = useMutation({
    mutationFn: async (input: { id: number; permissions: string[] }) =>
      (await apiClient.patch<AppRole>(`/roles/${input.id}`, { permissions: input.permissions })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["roles"] });
      setEditingId(null);
      toast.success("Permissions saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save those permissions.")),
  });

  function startEdit(role: AppRole) {
    setEditingId(role.id);
    setDraft([...(role.permissions ?? [])]);
  }

  const canManageRoles = roleManagesRoles(roles.find((role) => role.name === currentUser?.roleName));

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium">System roles</h2>
        <p className="text-xs text-muted-foreground">
          Includes Executive. Built-in names stay fixed. The permissions below are stored on the role, and an administrator can change them.
        </p>
      </div>
      {isLoading ? (
        <LoadingPlaceholder />
      ) : isError ? (
        <p className="text-sm text-destructive">Couldn't load system roles.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {roles.map((role) => {
            const labels = grantedLabels(role);
            const editing = editingId === role.id;
            return (
              <article key={role.id} data-testid={`system-role-${role.name}`} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-medium">
                      {roleLabel(role)}
                      {role.isProtected ? <span className="ml-2 text-xs font-normal text-muted-foreground">Built-in</span> : null}
                    </h3>
                    {role.description ? <p className="text-xs text-muted-foreground">{role.description}</p> : null}
                  </div>
                  <div className="flex items-center gap-3">
                    {canManageRoles ? <RoleDeleteButton role={role} roles={roles} /> : null}
                    {editing ? (
                      <button type="button" onClick={() => setEditingId(null)} className="text-xs text-muted-foreground hover:underline">
                        Cancel
                      </button>
                    ) : (
                      <button type="button" onClick={() => startEdit(role)} className="text-xs text-primary hover:underline">
                        Edit permissions
                      </button>
                    )}
                  </div>
                </div>
                {editing ? (
                  <form
                    className="mt-3 flex flex-col gap-2 border-t border-border pt-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const extras = draft.filter((key) => !KNOWN.has(key));
                      const checked = allRolePermissionKeys().filter((key) => draft.includes(key));
                      save.mutate({ id: role.id, permissions: [...extras, ...checked] });
                    }}
                  >
                    <RolePermissionFields selected={draft} onChange={setDraft} />
                    <button type="submit" disabled={save.isPending} className="mt-1 w-fit rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
                      {save.isPending ? "Saving…" : "Save"}
                    </button>
                  </form>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">{labels.length > 0 ? labels.join(" · ") : "No extra permissions."}</p>
                )}
              </article>
            );
          })}
        </div>
      )}
      {canManageRoles ? <RestoreDeletedRoles /> : null}
    </section>
  );
}
