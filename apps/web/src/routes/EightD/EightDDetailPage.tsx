import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { TextAreaField } from "../../components/forms/Field";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { PrintFormButton } from "../../components/forms/PrintFormButton";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";

interface EightDReport {
  id: number;
  ncrId: number | null;
  currentStep: number;
  data: Record<string, string>;
}

const STEPS = [
  { key: "d1_team", label: "D1 — Establish the Team" },
  { key: "d2_problem", label: "D2 — Describe the Problem" },
  { key: "d3_containment", label: "D3 — Interim Containment Action" },
  { key: "d4_rootCause", label: "D4 — Root Cause Analysis" },
  { key: "d5_correctiveAction", label: "D5 — Permanent Corrective Action" },
  { key: "d6_implementation", label: "D6 — Implement & Validate" },
  { key: "d7_prevention", label: "D7 — Prevent Recurrence" },
  { key: "d8_closure", label: "D8 — Congratulate the Team / Closure" },
] as const;

const eightDHooks = createResourceHooks<EightDReport>("8d");

export function EightDDetailPage() {
  const { id } = useParams();
  const reportId = Number(id);
  const { data: report, isLoading } = eightDHooks.useOne(reportId);
  const queryClient = useQueryClient();
  const completeStep = useMutation({
    mutationFn: async ({ step, data }: { step: number; data: unknown }) =>
      (await apiClient.post(`/8d/${reportId}/complete-step/${step}`, { data })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["8d", reportId] }),
  });
  const [draftByStep, setDraftByStep] = useState<Record<string, string>>({});

  if (isLoading || !report) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          8D Report #{report.id} {report.ncrId && <span className="text-muted-foreground">— NCR #{report.ncrId}</span>}
        </h1>
        <OpenFormButton formType="eight_d" entityId={report.id} title={`8D Report #${report.id} Form`} />
        <PrintFormButton formType="eight_d" entityId={report.id} />
      </div>

      <div className="flex flex-col gap-3">
        {STEPS.map((step, index) => {
          const stepNumber = index + 1;
          const isCurrent = stepNumber === report.currentStep;
          const isDone = stepNumber < report.currentStep;

          return (
            <div key={step.key} className={`rounded-lg border p-4 ${isCurrent ? "border-primary" : "border-border"} bg-card`}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium">{step.label}</h2>
                {isDone && <span className="text-xs text-emerald-600">Complete</span>}
              </div>
              <TextAreaField
                label=""
                defaultValue={report.data?.[step.key] ?? ""}
                onChange={(e) => setDraftByStep((d) => ({ ...d, [step.key]: e.target.value }))}
              />
              <button
                onClick={() =>
                  completeStep.mutate({
                    step: stepNumber,
                    data: draftByStep[step.key] ?? report.data?.[step.key] ?? "",
                  })
                }
                className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
              >
                Save step
              </button>
            </div>
          );
        })}
      </div>

      <AttachmentsPanel entityType="eight_d" entityId={report.id} />
    </div>
  );
}
