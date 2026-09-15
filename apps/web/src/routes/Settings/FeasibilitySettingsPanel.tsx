import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import type { FeasibilitySettings } from "../../api/types";
import { FeasibilityRiskLevelSelector } from "./FeasibilityRiskLevelSelector";
import { FeasibilityDocumentSelector } from "./FeasibilityDocumentSelector";

function useFeasibilitySettings() {
  return useQuery<FeasibilitySettings>({ queryKey: ["settings/feasibility"], queryFn: async () => (await apiClient.get("/settings/feasibility")).data });
}

/**
 * Settings → Feasibility Module integration. Read by feasibility.controller.ts
 * on create (defaultRiskLevel seeds every one of the 7 fixed assessment
 * areas, autoAssignOwner) and on finalize (requiredDocuments validation,
 * notificationsEnabled) — see that file's own comments for exactly where.
 * Quality + Engineering + Admin only (see settings.routes.ts).
 */
export function FeasibilitySettingsPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useFeasibilitySettings();
  const [form, setForm] = useState<FeasibilitySettings>({});

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async (body: FeasibilitySettings) => (await apiClient.post("/settings/feasibility", body)).data,
    onSuccess: (saved: FeasibilitySettings) => {
      setForm(saved);
      queryClient.invalidateQueries({ queryKey: ["settings/feasibility"] });
      toast.success("Feasibility settings saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save Feasibility settings.")),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-1 text-sm font-medium">New Review Defaults</h3>
        <p className="mb-3 text-xs text-muted-foreground">Applied when a new Feasibility Review is created — the risk level seeds all 7 fixed assessment areas; the field is otherwise left unset.</p>
        <div className="flex flex-col gap-4">
          <div className="max-w-xs">
            <FeasibilityRiskLevelSelector value={form.defaultRiskLevel} onChange={(v) => setForm({ ...form, defaultRiskLevel: v })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.autoAssignOwner ?? false} onChange={(e) => setForm({ ...form, autoAssignOwner: e.target.checked })} className="h-4 w-4 rounded border-form-field" />
            <span>Auto-assign the creating user as owner</span>
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <FeasibilityDocumentSelector value={form.requiredDocuments ?? []} onChange={(v) => setForm({ ...form, requiredDocuments: v })} />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">Notifications</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.notificationsEnabled ?? false} onChange={(e) => setForm({ ...form, notificationsEnabled: e.target.checked })} className="h-4 w-4 rounded border-form-field" />
          <span>Notify Quality when a review is finalized</span>
        </label>
      </div>

      <button
        onClick={() => save.mutate(form)}
        disabled={save.isPending}
        className="w-fit rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground disabled:opacity-60"
      >
        {save.isPending ? "Saving…" : "Save Feasibility Settings"}
      </button>
    </div>
  );
}
