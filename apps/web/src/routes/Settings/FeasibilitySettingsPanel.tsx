import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
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
 * on create (defaultRiskLevel/autoAssignOwner/customerRequirementMapping) and
 * on submit (requiredDocuments validation) and every workflow transition
 * (notificationsEnabled) — see that file's own comments for exactly where.
 * Quality + Engineering + Admin only (see settings.routes.ts).
 */
export function FeasibilitySettingsPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useFeasibilitySettings();
  const [form, setForm] = useState<FeasibilitySettings>({});
  const [mappingDraft, setMappingDraft] = useState({ key: "", value: "" });

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

  const mapping = form.customerRequirementMapping ?? {};

  function addMapping() {
    const key = mappingDraft.key.trim();
    const value = mappingDraft.value.trim();
    if (!key || !value) return;
    setForm({ ...form, customerRequirementMapping: { ...mapping, [key]: value } });
    setMappingDraft({ key: "", value: "" });
  }

  function removeMapping(key: string) {
    const next = { ...mapping };
    delete next[key];
    setForm({ ...form, customerRequirementMapping: next });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-1 text-sm font-medium">New Review Defaults</h3>
        <p className="mb-3 text-xs text-muted-foreground">Applied when a new Feasibility Review is created and the field is left unset.</p>
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
        <h3 className="mb-1 text-sm font-medium">Customer Requirement Mapping</h3>
        <p className="mb-3 text-xs text-muted-foreground">Maps a customer requirement code (e.g. "AS9100") to an internal category, applied automatically when a review names one.</p>
        <div className="flex flex-col gap-2">
          {Object.entries(mapping).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
              <span className="font-medium">{key}</span>
              <span className="text-muted-foreground">→</span>
              <span className="flex-1">{value}</span>
              <button type="button" onClick={() => removeMapping(key)} aria-label={`Remove mapping for ${key}`} className="text-muted-foreground hover:text-destructive">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {Object.keys(mapping).length === 0 && <p className="text-xs text-muted-foreground">No mappings configured — mappedRequirementCategory stays unset on every review.</p>}
          <div className="flex gap-2 pt-1">
            <input
              value={mappingDraft.key}
              onChange={(e) => setMappingDraft({ ...mappingDraft, key: e.target.value })}
              placeholder="Requirement code (e.g. AS9100)"
              className="w-full rounded-md border border-form-field bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            <input
              value={mappingDraft.value}
              onChange={(e) => setMappingDraft({ ...mappingDraft, value: e.target.value })}
              placeholder="Category (e.g. Aerospace)"
              className="w-full rounded-md border border-form-field bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            <button type="button" onClick={addMapping} className="shrink-0 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted">
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">Notifications</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.notificationsEnabled ?? false} onChange={(e) => setForm({ ...form, notificationsEnabled: e.target.checked })} className="h-4 w-4 rounded border-form-field" />
          <span>Notify Quality on every status change (submit, review, approve, reject)</span>
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
