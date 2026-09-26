import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { TextField } from "../../components/forms/Field";
import type { ModuleAccessLevel, PermissionModuleInfo, PermissionRole } from "../../api/types";

const LEVELS: ModuleAccessLevel[] = ["read", "edit"];

/**
 * Custom, company-defined roles (e.g. "Line Lead") — additive on top of a
 * user's department baseline, never subtractive (see permissions.ts's own
 * schema comment). Create a role, grant it access to specific modules, then
 * assign it to users on the User Assignments tab.
 */
export function PermissionsRolesTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");

  const { data: modules = [] } = useQuery<PermissionModuleInfo[]>({
    queryKey: ["permissions", "modules"],
    queryFn: async () => (await apiClient.get("/permissions/modules")).data,
  });
  const { data: roles = [], isLoading } = useQuery<PermissionRole[]>({
    queryKey: ["permissions", "roles"],
    queryFn: async () => (await apiClient.get("/permissions/roles")).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["permissions", "roles"] });

  const createRole = useMutation({
    mutationFn: async () => (await apiClient.post("/permissions/roles", { roleName: newRoleName, description: newRoleDescription || undefined })).data,
    onSuccess: () => {
      invalidate();
      setNewRoleName("");
      setNewRoleDescription("");
      toast.success("Role created.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create that role.")),
  });

  const deleteRole = useMutation({
    mutationFn: async (id: number) => apiClient.delete(`/permissions/roles/${id}`),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["permissions", "effective"] });
      queryClient.invalidateQueries({ queryKey: ["permissions", "user-roles"] });
      toast.success("Role deleted.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't delete that role.")),
  });

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (newRoleName.trim()) createRole.mutate();
        }}
      >
        <div className="w-56">
          <TextField label="New Role Name" value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="e.g. Line Lead" required />
        </div>
        <div className="flex-1 min-w-[12rem]">
          <TextField label="Description (optional)" value={newRoleDescription} onChange={(e) => setNewRoleDescription(e.target.value)} />
        </div>
        <button
          type="submit"
          disabled={!newRoleName.trim() || createRole.isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createRole.isPending ? "Creating…" : "+ New Role"}
        </button>
      </form>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : roles.length === 0 ? (
        <p className="text-sm text-muted-foreground">No custom roles yet — everyone's access comes from their department alone.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {roles.map((role) => (
            <RoleCard key={role.id} role={role} modules={modules} onDelete={() => deleteRole.mutate(role.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function RoleCard({ role, modules, onDelete }: { role: PermissionRole; modules: PermissionModuleInfo[]; onDelete: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [addModule, setAddModule] = useState("");
  const [addLevel, setAddLevel] = useState<ModuleAccessLevel>("edit");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["permissions", "roles"] });
    queryClient.invalidateQueries({ queryKey: ["permissions", "effective"] });
  };

  const grantModule = useMutation({
    mutationFn: async () => (await apiClient.patch(`/permissions/roles/${role.id}/modules`, { moduleName: addModule, accessLevel: addLevel })).data,
    onSuccess: () => {
      invalidate();
      setAddModule("");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't add that module grant.")),
  });

  const removeModule = useMutation({
    mutationFn: async (moduleName: string) => apiClient.delete(`/permissions/roles/${role.id}/modules/${moduleName}`),
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't remove that module grant.")),
  });

  const grantedKeys = new Set(role.modules.map((m) => m.moduleName));
  const availableModules = modules.filter((m) => !grantedKeys.has(m.key));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{role.roleName}</h3>
          {role.description && <p className="text-xs text-muted-foreground">{role.description}</p>}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {role.memberCount} {role.memberCount === 1 ? "member" : "members"}
          </p>
        </div>
        <button onClick={onDelete} className="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10">
          Delete Role
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        {role.modules.length === 0 ? (
          <p className="text-xs text-muted-foreground">No module grants yet.</p>
        ) : (
          role.modules.map((m) => {
            const label = modules.find((mod) => mod.key === m.moduleName)?.label ?? m.moduleName;
            return (
              <div key={m.moduleName} className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1 text-xs">
                <span>
                  {label} — <span className="font-medium capitalize">{m.accessLevel}</span>
                </span>
                <button onClick={() => removeModule.mutate(m.moduleName)} className="text-muted-foreground hover:text-destructive">
                  Remove
                </button>
              </div>
            );
          })
        )}
      </div>

      {availableModules.length > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <select value={addModule} onChange={(e) => setAddModule(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1.5 text-xs">
            <option value="">Add module grant…</option>
            {availableModules.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <select value={addLevel} onChange={(e) => setAddLevel(e.target.value as ModuleAccessLevel)} className="rounded-md border border-border bg-transparent px-2 py-1.5 text-xs">
            {LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl === "edit" ? "Edit" : "Read"}
              </option>
            ))}
          </select>
          <button
            onClick={() => addModule && grantModule.mutate()}
            disabled={!addModule || grantModule.isPending}
            className="rounded-md border border-border px-2 py-1.5 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
