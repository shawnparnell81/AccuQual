import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { canDeleteRecord, recordDeleteLabel } from "../../lib/recordDelete";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmDialog";

interface DeleteRecordButtonProps {
  /** REST path without the id, for example `ncr` or `warranty/claims`. */
  resource: string;
  id: number;
  kind: string;
  title?: string | null;
  /** User-entered record number. Blank stays blank. Never the database id. */
  number?: string | null;
  ownerIds?: Array<number | null | undefined>;
  /** Where to go after a successful delete. Omit on a list row so the page stays put. */
  navigateTo?: string;
  className?: string;
  /** Show the control for a master-list maintainer who is not the record owner. */
  allowed?: boolean;
  /** Button text. Defaults to Delete. */
  label?: string;
}

export function DeleteRecordButton({ resource, id, kind, title, number, ownerIds = [], navigateTo, className, allowed = false, label = "Delete" }: DeleteRecordButtonProps) {
  const user = useCurrentUser();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const remove = useMutation({
    mutationFn: async () => apiClient.delete(`/${resource}/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [resource] });
      void queryClient.invalidateQueries({ queryKey: ["audit-trail"] });
    },
  });

  if (!allowed && !canDeleteRecord(user?.roleName, user?.id, ownerIds)) return null;

  const recordName = recordDeleteLabel(kind, title, number);

  async function onClick() {
    const ok = await confirm({
      title: "Are you sure?",
      message: `Delete ${recordName}? This can't be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    setPending(true);
    try {
      await remove.mutateAsync();
      toast.success(`Deleted ${recordName}.`);
      if (navigateTo) navigate(navigateTo);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't delete this record."));
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={pending}
      className={className ?? "rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"}
    >
      {pending ? "Deleting…" : label}
    </button>
  );
}
