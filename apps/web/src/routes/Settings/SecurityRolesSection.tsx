import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import { useCurrentUser } from "../../hooks/useAuth";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { TextField, SelectField } from "../../components/forms/Field";
import { Modal } from "../../components/modals/Modal";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { DEPARTMENTS } from "../../components/layout/navConfig";
import type { AppUser, AppRole } from "../../api/types";
import { useConfirm } from "../../components/shared/ConfirmDialog";
import { isFullAccessRole } from "../../lib/fullAccess";

const userHooks = createResourceHooks<AppUser>("users");
const roleHooks = createResourceHooks<AppRole>("roles");

function roleLabel(role: AppRole): string {
  return role.displayName || role.name;
}

function personOptionLabel(person: AppUser): string {
  const base = person.name?.trim() || person.email;
  return person.isActive ? base : `${base} (inactive)`;
}

function managerLabel(people: AppUser[], managerId: number | null | undefined): string {
  const manager = people.find((person) => person.id === managerId);
  return manager ? personOptionLabel(manager) : "—";
}

function countPhrase(count: number, label: string): string {
  const singular: Record<string, string> = {
    "open NCRs": "open NCR",
    "open CAPAs": "open CAPA",
    "open 8D reports": "open 8D report",
    "documents in draft or review": "document in draft or review",
    "reviews waiting on them": "review waiting on them",
    "people who report to them": "person who reports to them",
    "open complaints": "open complaint",
    "open investigations": "open investigation",
    "training assignments": "training assignment",
    "open risks": "open risk",
    "risk actions": "risk action",
    "open audits": "open audit",
    "feasibility reviews": "feasibility review",
    "PPAP packages": "PPAP package",
    "competency evaluations": "competency evaluation",
  };
  return `${count} ${count === 1 ? (singular[label] ?? label) : label}`;
}

interface OpenWorkGroup {
  key: string;
  label: string;
  count: number;
  items: { id: number; title: string }[];
}

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
  const fullAccess = isFullAccessRole(user?.roleName);
  const canManage = fullAccess || user?.roleName === "quality_manager";

  if (!canManage) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        User and role management is limited to Owner, Admin, and Quality Manager accounts. Ask an administrator if you need a change here.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <UsersPanel isAdmin={fullAccess} currentUserId={user?.id} />
      <RolesPanel isAdmin={fullAccess} />
    </div>
  );
}

function UsersPanel({ isAdmin, currentUserId }: { isAdmin: boolean; currentUserId?: number }) {
  const confirm = useConfirm();
  const { data: users = [] } = userHooks.useList();
  const { data: roles = [] } = roleHooks.useList();
  const toast = useToast();
  const roleNameById = new Map(roles.map((r) => [r.id, roleLabel(r)]));

  const createUser = userHooks.useCreate();
  const updateUser = userHooks.useUpdate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", roleId: "", department: "", managerId: "", isActive: true });

  async function adminAction(path: string, done: string) {
    try {
      await apiClient.post(path);
      toast.success(done);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      toast.error(extractErrorMessage(err, "That didn't work."));
    }
  }

  const [form, setForm] = useState({ email: "", password: "", name: "", roleId: "", department: "", managerId: "" });
  const [resetFor, setResetFor] = useState<AppUser | null>(null);
  const [tempPassword, setTempPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [removing, setRemoving] = useState<AppUser | null>(null);
  const [openWork, setOpenWork] = useState<OpenWorkGroup[]>([]);
  const [replacementId, setReplacementId] = useState("");
  const [removeReason, setRemoveReason] = useState("");
  const [removeBusy, setRemoveBusy] = useState(false);

  async function finishRemove(person: AppUser, replacementUserId?: number, reason?: string) {
    setRemoveBusy(true);
    try {
      const body: { replacementUserId?: number; reason?: string } = {};
      if (replacementUserId) body.replacementUserId = replacementUserId;
      const trimmed = reason?.trim();
      if (trimmed) body.reason = trimmed;
      const res = await apiClient.delete<{ outcome?: string; message?: string }>(`/users/${person.id}`, { data: body });
      const fallback = res.data.outcome === "deactivated" ? "This person was deactivated. They can no longer sign in." : "Removed.";
      toast.success(res.data.message || fallback);
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't remove that person."));
    } finally {
      setRemoveBusy(false);
    }
  }

  async function startRemove(person: AppUser) {
    try {
      const res = await apiClient.get<{ openWork: OpenWorkGroup[] }>(`/users/${person.id}/open-work`);
      setOpenWork(res.data.openWork ?? []);
      setReplacementId("");
      setRemoveReason("");
      setRemoving(person);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't check their open work."));
    }
  }

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
            <th className="pb-2">Manager</th>
            <th className="pb-2">Status</th>
            {isAdmin && <th className="pb-2">2-step</th>}
            {isAdmin && <th className="pb-2" />}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-border">
              <td className="py-1.5">{personOptionLabel(u)}</td>
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
                        {roleLabel(r)}
                      </option>
                    ))}
                  </select>
                ) : (
                  (u.roleId && roleNameById.get(u.roleId)) ?? "—"
                )}
              </td>
              <td className="py-1.5 capitalize">{u.department ?? "—"}</td>
              <td className="py-1.5">
                {isAdmin ? (
                  <select
                    aria-label={`Manager for ${u.name ?? u.email}`}
                    className="max-w-[10rem] rounded-md border border-border bg-background px-2 py-1 text-xs"
                    value={u.managerId ?? ""}
                    onChange={(e) => updateUser.mutate({ id: u.id, managerId: e.target.value ? Number(e.target.value) : null } as Partial<AppUser> & { id: number })}
                  >
                    <option value="">None</option>
                    {users
                      .filter((person) => person.id !== u.id)
                      .map((person) => (
                        <option key={person.id} value={person.id}>
                          {personOptionLabel(person)}
                        </option>
                      ))}
                  </select>
                ) : (
                  managerLabel(users, u.managerId)
                )}
              </td>
              <td className="py-1.5">
                <StatusBadge value={u.isActive ? "active" : "disqualified"} label={u.isActive ? "Active" : "Deactivated"} />
                {isAdmin && u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now() && <span className="ml-2 text-xs text-destructive">Locked</span>}
              </td>
              {isAdmin && <td className="py-1.5 text-xs text-muted-foreground">{u.mfaEnabled ? "On" : "Off"}</td>}
              {isAdmin && (
                <td className="space-x-3 py-1.5 text-right">
                  {u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now() && (
                    <button onClick={() => void adminAction(`/users/${u.id}/unlock`, "Account unlocked.")} className="text-xs text-primary hover:underline">
                      Unlock
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setResetFor(u);
                      setTempPassword("");
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    Temporary password
                  </button>
                  {u.mfaEnabled && (
                    <button
                      onClick={() => {
                        void confirm({
                          title: "Reset two-step sign-in?",
                          message: `${u.email} will be signed out and can set it up again.`,
                          confirmLabel: "Reset",
                        }).then((ok) => {
                          if (ok) void adminAction(`/users/${u.id}/mfa/reset`, "Two-step sign-in reset.");
                        });
                      }}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      Reset 2-step
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(u);
                      setEditForm({
                        name: u.name ?? "",
                        email: u.email,
                        roleId: u.roleId ? String(u.roleId) : "",
                        department: u.department ?? "",
                        managerId: u.managerId ? String(u.managerId) : "",
                        isActive: u.isActive,
                      });
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    Edit
                  </button>
                  {u.id !== currentUserId && (
                    <button type="button" onClick={() => void startRemove(u)} className="text-xs text-muted-foreground hover:text-destructive">
                      Remove
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
          autoComplete="off"
          className="relative grid gap-2 border-t border-border pt-3 md:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            // Read the fields from the form itself. A password manager can fill the boxes without updating React state, and submitting that empty state was refused as a validation error.
            const data = new FormData(e.currentTarget);
            const email = String(data.get("new-user-email") ?? "").trim();
            const password = String(data.get("new-user-password") ?? "");
            const name = String(data.get("name") ?? "").trim();
            const roleId = String(data.get("roleId") ?? "");
            const department = String(data.get("department") ?? "");
            const managerId = String(data.get("managerId") ?? "");
            createUser.mutate(
              { email, password, name: name || undefined, roleId: roleId ? Number(roleId) : undefined, department: department || undefined, managerId: managerId ? Number(managerId) : null } as Partial<AppUser> & { password: string },
              {
                onSuccess: () => {
                  toast.success("User created. They'll be asked to choose their own password the first time they sign in.");
                  setForm({ email: "", password: "", name: "", roleId: "", department: "", managerId: "" });
                },
                onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create user.")),
              }
            );
          }}
        >
          {/* Decoys sit off-screen so the browser drops the signed-in admin's saved login here instead of into the new person's email and temporary password. The real boxes are not named email/password, which is what triggers that fill. */}
          <div aria-hidden="true" className="pointer-events-none absolute h-0 w-0 overflow-hidden">
            <input type="text" tabIndex={-1} autoComplete="username" name="username" defaultValue="" />
            <input type="password" tabIndex={-1} autoComplete="current-password" name="current-password" defaultValue="" />
          </div>
          <TextField label="Email" name="new-user-email" type="text" inputMode="email" required autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <TextField label="Temporary password" name="new-user-password" type="password" required minLength={12} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <TextField label="Name" name="name" autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <SelectField label="Role" name="roleId" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
            <option value="">Choose a role</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {roleLabel(r)}
              </option>
            ))}
          </SelectField>
          <SelectField label="Manager" name="managerId" value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })}>
            <option value="">None</option>
            {users
              .filter((person) => person.isActive)
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {personOptionLabel(person)}
                </option>
              ))}
          </SelectField>
          <SelectField label="Department" name="department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
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

      <Modal title={editing ? `Edit ${editing.email}` : "Edit person"} isOpen={editing !== null} onClose={() => setEditing(null)}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!editing) return;
            updateUser.mutate(
              {
                id: editing.id,
                name: editForm.name,
                email: editForm.email,
                roleId: editForm.roleId ? Number(editForm.roleId) : null,
                department: editForm.department || null,
                managerId: editForm.managerId ? Number(editForm.managerId) : null,
                isActive: editForm.isActive,
              } as Partial<AppUser> & { id: number },
              {
                onSuccess: () => {
                  if (editing.isActive && !editForm.isActive) toast.success("This person was deactivated. They can no longer sign in.");
                  else toast.success("Saved.");
                  setEditing(null);
                },
                onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save those changes.")),
              }
            );
          }}
        >
          <TextField label="Name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          <TextField label="Email" type="email" required value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
          <SelectField label="Role" value={editForm.roleId} onChange={(e) => setEditForm({ ...editForm, roleId: e.target.value })}>
            <option value="">No role</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {roleLabel(r)}
              </option>
            ))}
          </SelectField>
          <SelectField label="Department" value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}>
            <option value="">None</option>
            {DEPARTMENTS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Manager" value={editForm.managerId} onChange={(e) => setEditForm({ ...editForm, managerId: e.target.value })}>
            <option value="">None</option>
            {users
              .filter((person) => person.id !== editing?.id)
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {personOptionLabel(person)}
                </option>
              ))}
          </SelectField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editForm.isActive} onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })} />
            Active — they can sign in
          </label>
          <button type="submit" disabled={updateUser.isPending} className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            {updateUser.isPending ? "Saving…" : "Save"}
          </button>
        </form>
      </Modal>

      <Modal title={resetFor ? `Temporary password for ${resetFor.email}` : "Temporary password"} isOpen={resetFor !== null} onClose={() => setResetFor(null)}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!resetFor) return;
            setResetBusy(true);
            void apiClient
              .post(`/users/${resetFor.id}/temporary-password`, { password: tempPassword })
              .then(() => {
                toast.success("Saved. They'll be asked to choose a new password the next time they sign in, and their other sessions have ended.");
                setResetFor(null);
                setTempPassword("");
              })
              .catch((err) => toast.error(extractErrorMessage(err, "Couldn't set that temporary password.")))
              .finally(() => setResetBusy(false));
          }}
        >
          <p className="text-sm text-muted-foreground">Hand this to them once. They have to pick their own password before they can open anything else.</p>
          <TextField label="Temporary password" type="password" required minLength={12} autoComplete="new-password" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} />
          <p className="text-xs text-muted-foreground">At least 12 characters. Common passwords are refused.</p>
          <button type="submit" disabled={resetBusy} className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            {resetBusy ? "Saving…" : "Save temporary password"}
          </button>
        </form>
      </Modal>

      <Modal title={removing ? `Remove ${removing.name?.trim() || removing.email}` : "Remove this person"} isOpen={removing !== null} onClose={() => { if (!removeBusy) setRemoving(null); }}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!removing) return;
            if (openWork.length > 0 && !replacementId) return;
            void finishRemove(removing, replacementId ? Number(replacementId) : undefined, removeReason);
          }}
        >
          <p className="text-sm text-muted-foreground">
            {openWork.length > 0
              ? "They still have open work. Choose who should take it. Records they already created or signed stay as they are, stay editable, and keep their name."
              : "If they have quality records, the account is turned off instead and their name stays on those records as inactive. Records they created or signed stay editable. They won't be able to sign in."}
          </p>
          {openWork.length > 0 && (
          <ul className="flex max-h-52 flex-col gap-2 overflow-auto text-sm">
            {openWork.map((group) => (
              <li key={group.key}>
                <span className="font-medium">
                  {countPhrase(group.count, group.label)}
                </span>
                <ul className="ml-4 list-disc text-muted-foreground">
                  {group.items.map((item) => (
                    <li key={item.id}>{item.title}</li>
                  ))}
                  {group.count > group.items.length && <li>and {group.count - group.items.length} more</li>}
                </ul>
              </li>
            ))}
          </ul>
          )}
          {openWork.length > 0 && (
          <SelectField label="Give this work to" required value={replacementId} onChange={(e) => setReplacementId(e.target.value)}>
            <option value="">Choose a person</option>
            {users
              .filter((person) => person.id !== removing?.id && person.isActive)
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {personOptionLabel(person)}
                </option>
              ))}
          </SelectField>
          )}
          <TextField label="Reason (optional)" maxLength={500} value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} />
          <button type="submit" disabled={(openWork.length > 0 && !replacementId) || removeBusy} className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            {removeBusy ? "Removing…" : openWork.length > 0 ? "Move work and remove" : "Remove"}
          </button>
        </form>
      </Modal>
    </div>
  );
}

function RolesPanel({ isAdmin }: { isAdmin: boolean }) {
  const { data: roles = [] } = roleHooks.useList();
  const createRole = roleHooks.useCreate();
  const updateRole = roleHooks.useUpdate();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", description: "" });
  const [editing, setEditing] = useState<AppRole | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "", hierarchyLevel: "80", canImport: false });
  const [replacing, setReplacing] = useState<AppRole | null>(null);
  const [replacementId, setReplacementId] = useState("");

  async function move(role: AppRole, direction: "up" | "down") {
    try {
      await apiClient.post(`/roles/${role.id}/move`, { direction });
      void queryClient.invalidateQueries({ queryKey: ["roles"] });
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't change that rank."));
    }
  }

  async function removeRole(role: AppRole, replacementRoleId?: number) {
    try {
      await apiClient.delete(`/roles/${role.id}`, { data: replacementRoleId ? { replacementRoleId } : {} });
      toast.success("Role removed.");
      setReplacing(null);
      void queryClient.invalidateQueries({ queryKey: ["roles"] });
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      const message = extractErrorMessage(err, "Couldn't remove that role.");
      if ((role.userCount ?? 0) > 0) {
        setReplacing(role);
        setReplacementId("");
      }
      toast.error(message);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-medium">Roles</h3>
      <p className="mb-3 text-xs text-muted-foreground">Listed from the top of the organization down. A smaller rank number is higher.</p>
      <ul className="mb-4 flex flex-col gap-2 text-sm">
        {roles.map((r, index) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1.5 last:border-0">
            <span>
              <span className="font-medium">{roleLabel(r)}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                Rank {r.hierarchyLevel ?? "—"}
                {r.userCount ? ` · ${r.userCount} ${r.userCount === 1 ? "person" : "people"}` : ""}
              </span>
              {r.description && <span className="mt-0.5 block text-xs text-muted-foreground">{r.description}</span>}
            </span>
            {isAdmin && (
              <span className="flex items-center gap-2 text-xs">
                <button type="button" disabled={index === 0} onClick={() => void move(r, "up")} className="text-primary hover:underline disabled:opacity-40">
                  Up
                </button>
                <button type="button" disabled={index === roles.length - 1} onClick={() => void move(r, "down")} className="text-primary hover:underline disabled:opacity-40">
                  Down
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(r);
                    setEditForm({
                      name: r.name,
                      description: r.description ?? "",
                      hierarchyLevel: String(r.hierarchyLevel ?? 80),
                      canImport: (r.permissions ?? []).includes("import_data"),
                    });
                  }}
                  className="text-primary hover:underline"
                >
                  Edit
                </button>
                {!r.isProtected && (
                  <button
                    type="button"
                    onClick={() => {
                      if ((r.userCount ?? 0) > 0) {
                        setReplacing(r);
                        setReplacementId("");
                        return;
                      }
                      void confirm({ title: "Delete this role?", message: `${roleLabel(r)} will be removed. This can't be undone.`, confirmLabel: "Delete" }).then((ok) => {
                        if (ok) void removeRole(r);
                      });
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    Delete
                  </button>
                )}
              </span>
            )}
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

      <Modal title={editing ? `Edit ${roleLabel(editing)}` : "Edit role"} isOpen={editing !== null} onClose={() => setEditing(null)}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!editing) return;
            const permissions = new Set(editing.permissions ?? []);
            if (editForm.canImport) permissions.add("import_data");
            else permissions.delete("import_data");
            updateRole.mutate(
              {
                id: editing.id,
                name: editing.isProtected ? editing.name : editForm.name,
                description: editForm.description || null,
                hierarchyLevel: Number(editForm.hierarchyLevel),
                permissions: [...permissions],
              } as Partial<AppRole> & { id: number },
              {
                onSuccess: () => {
                  toast.success("Role saved.");
                  setEditing(null);
                },
                onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save that role.")),
              }
            );
          }}
        >
          <TextField label="Name" required disabled={editing?.isProtected} value={editing?.isProtected ? roleLabel(editing) : editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          {editing?.isProtected && <p className="text-xs text-muted-foreground">This role's name is built in and can't be changed.</p>}
          <TextField label="Description" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
          <TextField label="Rank" type="number" required min={1} max={1000} value={editForm.hierarchyLevel} onChange={(e) => setEditForm({ ...editForm, hierarchyLevel: e.target.value })} />
          <p className="text-xs text-muted-foreground">A smaller number is listed higher. Owner is 10. Staff is 80.</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editForm.canImport} onChange={(e) => setEditForm({ ...editForm, canImport: e.target.checked })} />
            Can import data
          </label>
          <p className="text-xs text-muted-foreground">Owner and Administrator can always import, even if this is turned off.</p>
          <button type="submit" disabled={updateRole.isPending} className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            {updateRole.isPending ? "Saving…" : "Save"}
          </button>
        </form>
      </Modal>

      <Modal title={replacing ? `Delete ${replacing.name}` : "Delete role"} isOpen={replacing !== null} onClose={() => setReplacing(null)}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!replacing || !replacementId) return;
            void removeRole(replacing, Number(replacementId));
          }}
        >
          <p className="text-sm text-muted-foreground">
            {replacing?.userCount ?? 0} {(replacing?.userCount ?? 0) === 1 ? "person has" : "people have"} this role. Choose another role for them first.
          </p>
          <SelectField label="Move them to" required value={replacementId} onChange={(e) => setReplacementId(e.target.value)}>
            <option value="">Choose a role</option>
            {roles
              .filter((role) => role.id !== replacing?.id)
              .map((role) => (
                <option key={role.id} value={role.id}>
                  {roleLabel(role)}
                </option>
              ))}
          </SelectField>
          <button type="submit" disabled={!replacementId} className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            Move people and delete
          </button>
        </form>
      </Modal>
    </div>
  );
}
