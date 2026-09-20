import { useState } from "react";
import { createResourceHooks } from "../../api/resourceHooks";
import { useCurrentUser } from "../../hooks/useAuth";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { TextField, SelectField } from "../../components/forms/Field";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { DEPARTMENTS } from "../../components/layout/navConfig";
import type { AppUser, AppRole } from "../../api/types";

const userHooks = createResourceHooks<AppUser>("users");
const roleHooks = createResourceHooks<AppRole>("roles");

/**
 * Real functionality, not a mockup: GET/POST/PATCH/DELETE /users and
 * GET/POST/PATCH /roles already exist (roles.controller.ts, users.
 * controller.ts) — this is the first UI ever built for them, no new
 * endpoint. GET /users itself is admin/quality_manager-only on the backend
 * (requireRole), so a user outside those roles sees an explicit "no access"
 * message here instead of a query that would just 403 silently.
 */
export function SecurityRolesSection() {
  const user = useCurrentUser();
  const canManage = user?.roleName === "admin" || user?.roleName === "quality_manager";

  if (!canManage) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        User and role management is limited to Admin and Quality Manager accounts. Ask a tenant admin if you need a change here.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <UsersPanel isAdmin={user?.roleName === "admin"} />
      <RolesPanel isAdmin={user?.roleName === "admin"} />
    </div>
  );
}

function UsersPanel({ isAdmin }: { isAdmin: boolean }) {
  const { data: users = [] } = userHooks.useList();
  const { data: roles = [] } = roleHooks.useList();
  const toast = useToast();
  const roleNameById = new Map(roles.map((r) => [r.id, r.name]));

  const createUser = userHooks.useCreate();
  const updateUser = userHooks.useUpdate();
  const removeUser = userHooks.useDelete();

  const [form, setForm] = useState({ email: "", password: "", name: "", roleId: "", department: "" });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">Users</h3>
      <table className="mb-4 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pb-2">Name</th>
            <th className="pb-2">Email</th>
            <th className="pb-2">Role</th>
            <th className="pb-2">Department</th>
            <th className="pb-2">Status</th>
            {isAdmin && <th className="pb-2" />}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-border">
              <td className="py-1.5">{u.name ?? "—"}</td>
              <td className="py-1.5 text-muted-foreground">{u.email}</td>
              <td className="py-1.5">
                {isAdmin ? (
                  <select
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                    value={u.roleId ?? ""}
                    onChange={(e) => updateUser.mutate({ id: u.id, roleId: e.target.value ? Number(e.target.value) : null } as Partial<AppUser> & { id: number })}
                  >
                    <option value="">No role</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  (u.roleId && roleNameById.get(u.roleId)) ?? "—"
                )}
              </td>
              <td className="py-1.5 capitalize">{u.department ?? "—"}</td>
              <td className="py-1.5">
                <StatusBadge value={u.isActive ? "active" : "disqualified"} label={u.isActive ? "Active" : "Deactivated"} />
              </td>
              {isAdmin && (
                <td className="py-1.5 text-right">
                  {u.isActive && (
                    <button
                      onClick={() => removeUser.mutate(u.id)}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {isAdmin && (
        <form
          className="grid gap-2 border-t border-border pt-3 md:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            createUser.mutate(
              { email: form.email, password: form.password, name: form.name || undefined, roleId: form.roleId ? Number(form.roleId) : undefined, department: form.department || undefined } as Partial<AppUser> & { password: string },
              {
                onSuccess: () => {
                  toast.success("User created.");
                  setForm({ email: "", password: "", name: "", roleId: "", department: "" });
                },
                onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create user.")),
              }
            );
          }}
        >
          <TextField label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <TextField label="Temporary password" type="password" required minLength={12} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <SelectField label="Role" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
            <option value="">No role</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
            <option value="">None</option>
            {DEPARTMENTS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </SelectField>
          <button type="submit" disabled={createUser.isPending} className="col-span-full w-fit rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            {createUser.isPending ? "Creating…" : "Add User"}
          </button>
        </form>
      )}
    </div>
  );
}

function RolesPanel({ isAdmin }: { isAdmin: boolean }) {
  const { data: roles = [] } = roleHooks.useList();
  const createRole = roleHooks.useCreate();
  const toast = useToast();
  const [form, setForm] = useState({ name: "", description: "" });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">Roles</h3>
      <ul className="mb-4 flex flex-col gap-2 text-sm">
        {roles.map((r) => (
          <li key={r.id} className="flex items-center justify-between border-b border-border pb-1.5 last:border-0">
            <span className="font-medium">{r.name}</span>
            <span className="text-xs text-muted-foreground">{r.description ?? "—"}</span>
          </li>
        ))}
      </ul>
      {isAdmin && (
        <form
          className="grid gap-2 border-t border-border pt-3 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            createRole.mutate(
              { name: form.name, description: form.description || undefined },
              {
                onSuccess: () => {
                  toast.success("Role created.");
                  setForm({ name: "", description: "" });
                },
                onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create role.")),
              }
            );
          }}
        >
          <TextField label="Role name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <button type="submit" disabled={createRole.isPending} className="w-fit self-end rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            {createRole.isPending ? "Creating…" : "Add Role"}
          </button>
        </form>
      )}
    </div>
  );
}
