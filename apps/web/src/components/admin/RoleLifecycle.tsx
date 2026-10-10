import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import type { AppRole } from "../../api/types";
import { SelectField, TextField } from "../forms/Field";
import { Modal } from "../modals/Modal";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

export function roleManagesRoles(role: AppRole | undefined): boolean {
  return (role?.permissions ?? []).includes("roles.manage");
}

function roleLabel(role: AppRole): string {
  return role.displayName || role.name;
}

export function RoleDeleteButton({ role, roles }: { role: AppRole; roles: AppRole[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [replacementId, setReplacementId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const assigned = role.userCount ?? 0;
  const label = roleLabel(role);

  async function remove() {
    if (assigned > 0 && !replacementId) return;
    setBusy(true);
    try {
      await apiClient.delete(`/roles/${role.id}`, {
        data: {
          ...(replacementId ? { replacementRoleId: Number(replacementId) } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      });
      toast.success(`${label} was removed. You can restore it.`);
      setOpen(false);
      setReplacementId("");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["roles"] });
      void queryClient.invalidateQueries({ queryKey: ["roles", "deleted"] });
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't remove that role."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-muted-foreground hover:text-destructive">
        Delete
      </button>
      <Modal title={`Delete ${label}?`} isOpen={open} onClose={() => { if (!busy) setOpen(false); }}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void remove();
          }}
        >
          <p className="text-sm text-muted-foreground">
            {assigned > 0
              ? `${assigned === 1 ? "1 person is" : `${assigned} people are`} assigned to ${label}. Choose who they should become, then ${label} is removed.`
              : `${label} will be removed from the role list. You can restore it later.`}
          </p>
          {assigned > 0 && (
            <SelectField label="Reassign users to…" required value={replacementId} onChange={(event) => setReplacementId(event.target.value)}>
              <option value="">Choose a role</option>
              {roles
                .filter((candidate) => candidate.id !== role.id)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {roleLabel(candidate)}
                  </option>
                ))}
            </SelectField>
          )}
          <TextField label="Reason (optional)" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
          <button type="submit" disabled={busy || (assigned > 0 && !replacementId)} className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            {busy ? "Removing…" : `Delete ${label}`}
          </button>
        </form>
      </Modal>
    </>
  );
}

interface DeletedRole extends AppRole {
  deletedAt?: string | null;
  reason?: string | null;
}

export function RestoreDeletedRoles() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: deleted = [] } = useQuery<DeletedRole[]>({
    queryKey: ["roles", "deleted"],
    queryFn: async () => (await apiClient.get<DeletedRole[]>("/roles/deleted")).data,
    enabled: open,
  });

  async function restore(role: DeletedRole) {
    try {
      await apiClient.post(`/roles/${role.id}/restore`);
      toast.success(`${roleLabel(role)} is back.`);
      void queryClient.invalidateQueries({ queryKey: ["roles"] });
      void queryClient.invalidateQueries({ queryKey: ["roles", "deleted"] });
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't restore that role."));
    }
  }

  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((value) => !value)} className="text-xs text-primary hover:underline">
        {open ? "Hide deleted roles" : "Restore deleted roles"}
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {deleted.length === 0 ? <li className="text-xs text-muted-foreground">No deleted roles.</li> : null}
          {deleted.map((role) => (
            <li key={role.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{roleLabel(role)}</span>
                {role.reason ? <span className="ml-2 text-xs text-muted-foreground">{role.reason}</span> : null}
              </span>
              <button type="button" onClick={() => void restore(role)} className="text-xs text-primary hover:underline">
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
