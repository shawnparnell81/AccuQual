import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";

export interface QualityAutomationSettings {
  remindDaysBeforeDue: number;
  escalateAfterDaysOverdue: number;
  stuckDays: number;
  approvalStuckDays: number;
  repeatNcrWindowDays: number;
  repeatNcrThreshold: number;
}

const FIELDS: { key: keyof QualityAutomationSettings; label: string; hint: string }[] = [
  { key: "remindDaysBeforeDue", label: "Remind this many days before the due date", hint: "Also sends a notice on the due date. Default 3." },
  { key: "escalateAfterDaysOverdue", label: "Escalate when this many days overdue", hint: "Goes to the owner's manager, or a quality manager if none is set. Default 7." },
  { key: "stuckDays", label: "Treat a record as stuck after this many days without an update", hint: "Open NCRs, CAPAs, and 8Ds. Default 14." },
  { key: "approvalStuckDays", label: "Remind when an approval has been waiting this many days", hint: "Document reviews and validation sign-offs. Default 3." },
  { key: "repeatNcrWindowDays", label: "Repeat-NCR window (days)", hint: "How far back to look for a similar NCR. Default 90." },
  { key: "repeatNcrThreshold", label: "Repeat-NCR count", hint: "How many similar NCRs suggest a CAPA. Default 3." },
];

export function QualityAutomationSettingsPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<QualityAutomationSettings>({
    queryKey: ["settings/quality-automation"],
    queryFn: async () => (await apiClient.get("/settings/quality-automation")).data,
  });
  const [form, setForm] = useState<QualityAutomationSettings | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async (body: QualityAutomationSettings) => (await apiClient.post<QualityAutomationSettings>("/settings/quality-automation", body)).data,
    onSuccess: (saved) => {
      setForm(saved);
      queryClient.setQueryData(["settings/quality-automation"], saved);
      toast.success("Reminder settings saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save reminder settings.")),
  });

  if (isLoading || !form) return <LoadingPlaceholder />;
  if (isError) return <p className="text-sm text-destructive">Couldn't load reminder settings.</p>;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-medium">Due dates, escalation, and repeat NCRs</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        The server checks about every six hours. People who turned email off in Settings do not get these messages. The daily digest is a separate switch on Email Alerts.
      </p>
      <div className="flex flex-col gap-3">
        {FIELDS.map((field) => (
          <label key={field.key} className="flex flex-col gap-1 text-sm">
            <span>{field.label}</span>
            <input
              type="number"
              min={0}
              value={form[field.key]}
              onChange={(e) => setForm({ ...form, [field.key]: Number(e.target.value) })}
              className="w-28 rounded-md border border-border bg-background px-2 py-1"
            />
            <span className="text-xs text-muted-foreground">{field.hint}</span>
          </label>
        ))}
      </div>
      <button type="button" onClick={() => save.mutate(form)} disabled={save.isPending} className="mt-4 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
        Save reminder settings
      </button>
    </section>
  );
}
