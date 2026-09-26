import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import type { AiSuggestion, OnboardingChecklistItem, OnboardingProgressRow } from "../../api/types";

/**
 * No department gate at all — POST /onboarding/ai-generate works for any
 * user in any department (see onboarding.routes.ts), same reasoning as
 * /ai/assistant. The checklist itself is grounded on PERMISSION_MATRIX, not
 * a fabricated "enabled modules" concept — see onboarding.ai.ts.
 */
export function OnboardingPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: progress = [] } = useQuery({
    queryKey: ["onboarding-progress"],
    queryFn: async () => (await apiClient.get<OnboardingProgressRow[]>("/onboarding/progress")).data,
  });

  const { data: suggestion, isPending: generating, mutate: generate } = useMutation({
    mutationFn: async () => (await apiClient.post<AiSuggestion>("/onboarding/ai-generate")).data,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't generate your onboarding checklist.")),
  });

  const setStatus = useMutation({
    mutationFn: async ({ moduleKey, status }: { moduleKey: string; status: string }) => (await apiClient.patch(`/onboarding/progress/${moduleKey}`, { status })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onboarding-progress"] }),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save progress.")),
  });

  const progressByModule = new Map(progress.map((p) => [p.moduleKey, p.status]));
  const rawOutput = suggestion?.output as { checklist?: OnboardingChecklistItem[]; note?: string } | undefined;
  const checklist = Array.isArray(rawOutput?.checklist) ? rawOutput!.checklist! : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Onboarding</h1>
          <p className="text-sm text-muted-foreground">A checklist built from the modules your department actually has access to.</p>
        </div>
        <button onClick={() => generate()} disabled={generating} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {generating ? "Building your checklist…" : checklist.length > 0 ? "Regenerate" : "Get Started"}
        </button>
      </div>

      {suggestion && rawOutput?.note && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          {rawOutput.note} A real AI provider key isn't configured for this company yet (Admin → Company AI Config) — ask your admin to set one up for a real, personalized checklist.
        </div>
      )}

      {checklist.length === 0 && !generating && !suggestion && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Click "Get Started" to generate your onboarding checklist.</div>
      )}

      <div className="flex flex-col gap-3">
        {checklist.map((item) => {
          const status = progressByModule.get(item.moduleKey) ?? "not_started";
          return (
            <div key={item.moduleKey} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-medium">{item.moduleLabel}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{item.explanation}</p>
                  <p className="mt-2 text-sm">
                    <span className="font-medium">Try this: </span>
                    {item.firstAction}
                  </p>
                </div>
                <select
                  value={status}
                  onChange={(e) => setStatus.mutate({ moduleKey: item.moduleKey, status: e.target.value })}
                  className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs"
                >
                  <option value="not_started">Not started</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
